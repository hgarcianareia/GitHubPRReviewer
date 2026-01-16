/**
 * Feedback Store
 *
 * Handles persistent storage of AI review feedback data.
 * Stores feedback history as a JSON file in the repository.
 *
 * The store follows an append-only pattern - events are never modified,
 * only new events are added.
 */

import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_HISTORY_PATH = '.ai-review/feedback-history.json';
const GIT_TIMEOUT = 30000;

/**
 * @typedef {Object} CommentFeedback
 * @property {string} file - File path
 * @property {number} line - Line number
 * @property {string} severity - Comment severity (critical, warning, suggestion, nitpick)
 * @property {string} category - Review area category
 * @property {string} comment - Comment text (without code suggestions)
 * @property {number} positive - Positive reaction count
 * @property {number} negative - Negative reaction count
 */

/**
 * @typedef {Object} FeedbackEvent
 * @property {string} id - Unique event ID
 * @property {string} timestamp - ISO timestamp
 * @property {number} prNumber - PR number
 * @property {string} prTitle - PR title
 * @property {string} prAuthor - PR author username
 * @property {string} headSha - Commit SHA
 * @property {string} reviewEvent - Review event type (APPROVE, REQUEST_CHANGES, COMMENT)
 * @property {string} platform - Platform (github, bitbucket)
 * @property {Object} summary - Review summary metrics
 * @property {Object} findings - Findings by severity
 * @property {Object} commentsByCategory - Comments by review area
 * @property {Object} feedback - Aggregate feedback counts
 * @property {CommentFeedback[]} topComments - Top comments with feedback
 */

/**
 * @typedef {Object} FeedbackHistory
 * @property {string} version - Schema version
 * @property {string} repository - Repository identifier (owner/repo)
 * @property {FeedbackEvent[]} events - Array of feedback events
 * @property {Object} metadata - History metadata
 */

export class FeedbackStore {
  /**
   * @param {string} repoPath - Repository root path
   * @param {string} historyPath - Path to history file relative to repo
   */
  constructor(repoPath = process.cwd(), historyPath = DEFAULT_HISTORY_PATH) {
    this.repoPath = repoPath;
    this.historyPath = path.join(repoPath, historyPath);
    this.history = null;
  }

  /**
   * Ensures the .ai-review directory exists
   * @private
   */
  async _ensureDirectory() {
    const dir = path.dirname(this.historyPath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Creates an empty history structure
   * @param {string} repository - Repository identifier
   * @returns {FeedbackHistory}
   * @private
   */
  _createEmptyHistory(repository) {
    return {
      version: '1.0',
      repository,
      events: [],
      metadata: {
        lastUpdated: new Date().toISOString(),
        totalReviews: 0,
        overallApprovalRate: 0
      }
    };
  }

  /**
   * Loads feedback history from disk
   * @param {string} repository - Repository identifier for new history
   * @returns {Promise<FeedbackHistory>}
   */
  async loadHistory(repository = 'unknown/unknown') {
    try {
      const content = await fs.readFile(this.historyPath, 'utf-8');
      this.history = JSON.parse(content);

      // Validate schema version
      if (!this.history.version || this.history.version !== '1.0') {
        console.log('[WARN] Unknown history schema version, creating new history');
        this.history = this._createEmptyHistory(repository);
      }

      return this.history;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, create new history
        this.history = this._createEmptyHistory(repository);
        return this.history;
      }
      if (error instanceof SyntaxError) {
        console.log('[WARN] Malformed feedback history JSON, creating new history');
        this.history = this._createEmptyHistory(repository);
        return this.history;
      }
      throw error;
    }
  }

  /**
   * Saves feedback history to disk atomically
   * @returns {Promise<void>}
   */
  async saveHistory() {
    if (!this.history) {
      throw new Error('No history loaded. Call loadHistory() first.');
    }

    await this._ensureDirectory();

    // Update metadata
    this.history.metadata.lastUpdated = new Date().toISOString();
    this.history.metadata.totalReviews = this.history.events.length;

    // Calculate overall approval rate
    const totalFeedback = this.history.events.reduce(
      (acc, event) => ({
        positive: acc.positive + (event.feedback?.positive || 0),
        negative: acc.negative + (event.feedback?.negative || 0)
      }),
      { positive: 0, negative: 0 }
    );

    const total = totalFeedback.positive + totalFeedback.negative;
    this.history.metadata.overallApprovalRate = total > 0
      ? parseFloat(((totalFeedback.positive / total) * 100).toFixed(1))
      : 0;

    // Write atomically using temp file with unique name to prevent race conditions
    const tempPath = `${this.historyPath}.tmp.${process.pid}.${Date.now()}`;
    const content = JSON.stringify(this.history, null, 2);

    try {
      await fs.writeFile(tempPath, content, 'utf-8');
      await fs.rename(tempPath, this.historyPath);
    } catch (error) {
      // Clean up temp file on failure
      try {
        await fs.unlink(tempPath);
      } catch (unlinkError) {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Appends a new feedback event to history
   * @param {Object} eventData - Feedback event data
   * @returns {Promise<FeedbackEvent>}
   */
  async appendFeedback(eventData) {
    if (!this.history) {
      throw new Error('No history loaded. Call loadHistory() first.');
    }

    const event = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      ...eventData
    };

    this.history.events.push(event);
    await this.saveHistory();

    return event;
  }

  /**
   * Reads history with optional filtering
   * @param {Object} filters - Optional filters
   * @param {number} [filters.days] - Filter to last N days
   * @param {string} [filters.author] - Filter by PR author
   * @param {string} [filters.severity] - Filter by severity
   * @returns {FeedbackEvent[]}
   */
  getFilteredHistory(filters = {}) {
    if (!this.history) {
      return [];
    }

    let events = [...this.history.events];

    if (filters.days) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - filters.days);
      events = events.filter(e => new Date(e.timestamp) >= cutoff);
    }

    if (filters.author) {
      events = events.filter(e => e.prAuthor === filters.author);
    }

    if (filters.severity) {
      events = events.filter(e =>
        e.topComments?.some(c => c.severity === filters.severity)
      );
    }

    return events;
  }

  /**
   * Gets the full history object
   * @returns {FeedbackHistory|null}
   */
  getHistory() {
    return this.history;
  }

  /**
   * Sanitizes a string for safe use in shell commands
   * @param {string} str - String to sanitize
   * @returns {string} Sanitized string
   * @private
   */
  _sanitizeForShell(str) {
    // Escape characters that have special meaning in shell
    return str.replace(/["\\`$]/g, '\\$&');
  }

  /**
   * Detects the default branch (main or master)
   * @param {Object} gitExecOptions - Git exec options
   * @returns {string|null} The default branch name or null if not found
   * @private
   */
  _detectDefaultBranch(gitExecOptions) {
    // Try to get from remote HEAD
    try {
      const remoteHead = execSync('git symbolic-ref refs/remotes/origin/HEAD', gitExecOptions).trim();
      const branch = remoteHead.replace('refs/remotes/origin/', '');
      if (branch) return branch;
    } catch (e) {
      // Fallback: check if main or master exists
    }

    // Check if main exists
    try {
      execSync('git rev-parse --verify origin/main', gitExecOptions);
      return 'main';
    } catch (e) {
      // main doesn't exist
    }

    // Check if master exists
    try {
      execSync('git rev-parse --verify origin/master', gitExecOptions);
      return 'master';
    } catch (e) {
      // master doesn't exist
    }

    return null;
  }

  /**
   * Commits feedback history to git (always to main or master branch)
   * @param {string} message - Commit message
   * @param {string[]} additionalFiles - Additional files to add to the commit
   * @returns {Promise<boolean>} - True if commit succeeded
   */
  async commitToGit(message = 'chore: Update AI review feedback history', additionalFiles = []) {
    const gitExecOptions = {
      cwd: this.repoPath,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: GIT_TIMEOUT
    };

    try {
      // Configure git identity
      try {
        execSync('git config user.email "ai-review-bot@users.noreply.github.com"', gitExecOptions);
        execSync('git config user.name "AI Review Bot"', gitExecOptions);
      } catch (e) {
        console.log('[WARN] Could not configure git identity:', e.message);
      }

      // Detect and checkout the default branch (main or master)
      const defaultBranch = this._detectDefaultBranch(gitExecOptions);
      if (!defaultBranch) {
        console.log('[WARN] Could not detect default branch (main/master)');
        return false;
      }

      // Fetch latest and checkout default branch
      try {
        execSync('git fetch origin', gitExecOptions);
        execSync(`git checkout ${defaultBranch}`, gitExecOptions);
        execSync(`git pull origin ${defaultBranch}`, gitExecOptions);
      } catch (e) {
        console.log(`[WARN] Could not checkout ${defaultBranch}:`, e.message);
        return false;
      }

      // Add the feedback history file
      const relativePath = path.relative(this.repoPath, this.historyPath);
      execSync(`git add "${this._sanitizeForShell(relativePath)}"`, gitExecOptions);

      // Add any additional files (e.g., METRICS.md)
      for (const file of additionalFiles) {
        try {
          execSync(`git add "${this._sanitizeForShell(file)}"`, gitExecOptions);
        } catch (e) {
          console.log(`[WARN] Could not add file to git: ${file}`);
        }
      }

      // Check if there are changes to commit
      const status = execSync('git status --porcelain', gitExecOptions).trim();

      if (!status) {
        console.log('[INFO] No changes to feedback history to commit');
        return false;
      }

      // Commit with sanitized message to prevent command injection
      const sanitizedMessage = this._sanitizeForShell(message);
      execSync(`git commit -m "${sanitizedMessage}"`, gitExecOptions);

      // Push to default branch with extended timeout
      execSync(`git push origin ${defaultBranch}`, {
        ...gitExecOptions,
        timeout: GIT_TIMEOUT * 2
      });

      console.log(`[INFO] Committed and pushed feedback history to ${defaultBranch}`);
      return true;
    } catch (error) {
      console.log('[WARN] Failed to commit feedback history:', error.message);
      return false;
    }
  }
}
