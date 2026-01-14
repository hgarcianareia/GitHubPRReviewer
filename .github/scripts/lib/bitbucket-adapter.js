/**
 * Bitbucket Platform Adapter
 *
 * Implements the PlatformAdapter interface for Bitbucket Pipelines.
 * Uses Bitbucket Cloud REST API v2.0 for all operations.
 */

import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import {
  PlatformAdapter,
  AI_REVIEW_MARKER
} from './platform-adapter.js';
import {
  parsePRNumber,
  sanitizeBranchName
} from './utils.js';

// Rate limiting configuration
const RATE_LIMIT = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000
};

// Git command timeout configuration (in milliseconds)
const GIT_TIMEOUT = {
  local: 30000,    // 30s for local operations
  network: 120000  // 120s for network operations
};

// Bitbucket API base URL
const BITBUCKET_API_BASE = 'https://api.bitbucket.org/2.0';

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Exponential backoff retry wrapper
 */
async function withRetry(fn, operation) {
  let lastError;
  let delay = RATE_LIMIT.initialDelayMs;

  for (let attempt = 1; attempt <= RATE_LIMIT.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Handle rate limiting (HTTP 429)
      if (error.status === 429 || error.message?.includes('rate')) {
        console.log(`[WARN] Rate limited on ${operation}, attempt ${attempt}/${RATE_LIMIT.maxRetries}`);
        await sleep(delay);
        delay = Math.min(delay * 2, RATE_LIMIT.maxDelayMs);
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

/**
 * Bitbucket Platform Adapter Implementation
 */
export class BitbucketAdapter extends PlatformAdapter {
  /**
   * @param {Object} context - Platform context
   * @param {string} authHeader - Authorization header for API calls
   */
  constructor(context, authHeader) {
    super(context);
    this.authHeader = authHeader;
    this._prDetails = null; // Cached PR details
  }

  /**
   * Factory method to create a BitbucketAdapter instance
   * @returns {Promise<BitbucketAdapter>}
   */
  static async create() {
    // Validate required environment variables
    const username = process.env.BITBUCKET_USERNAME;
    const appPassword = process.env.BITBUCKET_APP_PASSWORD;

    if (!appPassword) {
      console.error('='.repeat(60));
      console.error('[FATAL] BITBUCKET_APP_PASSWORD is required');
      console.error('='.repeat(60));
      console.error('  Please add BITBUCKET_APP_PASSWORD to your repository variables.');
      console.error('  Create an App Password at: https://bitbucket.org/account/settings/app-passwords/');
      console.error('  Required permissions: repository:read, pullrequest:read, pullrequest:write');
      console.error('='.repeat(60));
      process.exit(1);
    }

    // Build authorization header
    const authUser = username || process.env.BITBUCKET_WORKSPACE;
    const authHeader = 'Basic ' + Buffer.from(`${authUser}:${appPassword}`).toString('base64');

    // Determine if this is a manual trigger
    const isManualTrigger = process.env.BITBUCKET_PIPELINE_TRIGGER_TYPE === 'manual';

    // Get PR number from various sources
    let prNumber = process.env.BITBUCKET_PR_ID;
    if (!prNumber && process.env.PR_NUMBER) {
      prNumber = process.env.PR_NUMBER; // Allow override for manual dispatch
    }

    if (!prNumber) {
      console.error('='.repeat(60));
      console.error('[FATAL] PR number not found');
      console.error('='.repeat(60));
      console.error('  BITBUCKET_PR_ID is not set. This pipeline must be triggered from a Pull Request.');
      console.error('  For manual triggers, set the PR_NUMBER environment variable.');
      console.error('='.repeat(60));
      process.exit(1);
    }

    // Build initial context from environment variables
    const context = {
      owner: process.env.BITBUCKET_WORKSPACE,
      repo: process.env.BITBUCKET_REPO_SLUG,
      prNumber: parseInt(prNumber, 10),
      prTitle: '',  // Will be fetched from API
      prBody: '',   // Will be fetched from API
      prAuthor: '',  // Will be fetched from API
      baseSha: process.env.BITBUCKET_PR_DESTINATION_COMMIT || '',
      headSha: process.env.BITBUCKET_COMMIT || '',
      eventName: process.env.BITBUCKET_PIPELINE_TRIGGER_TYPE || 'push',
      isManualTrigger: isManualTrigger
    };

    const adapter = new BitbucketAdapter(context, authHeader);

    // Fetch PR details to complete the context
    await adapter._loadPRDetails();

    return adapter;
  }

  /**
   * Make an authenticated API request to Bitbucket
   * @private
   */
  async _apiRequest(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${BITBUCKET_API_BASE}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`Bitbucket API error: ${response.status} ${response.statusText} - ${errorText}`);
      error.status = response.status;
      throw error;
    }

    // Handle empty responses
    const text = await response.text();
    if (!text) return null;

    // Handle non-JSON responses (like diff)
    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.includes('application/json')) {
      return text;
    }

    return JSON.parse(text);
  }

  /**
   * Load PR details from Bitbucket API
   * @private
   */
  async _loadPRDetails() {
    try {
      const prData = await this._apiRequest(
        `/repositories/${this.context.owner}/${this.context.repo}/pullrequests/${this.context.prNumber}`
      );

      this._prDetails = prData;

      // Update context with fetched data
      this.context.prTitle = prData.title || '';
      this.context.prBody = prData.description || '';
      this.context.prAuthor = prData.author?.display_name || prData.author?.nickname || '';
      this.context.baseSha = prData.destination?.commit?.hash || this.context.baseSha;
      this.context.headSha = prData.source?.commit?.hash || this.context.headSha;

      console.log('[INFO] Loaded PR details from Bitbucket API');
    } catch (error) {
      console.error('[ERROR] Failed to load PR details:', error.message);
      throw error;
    }
  }

  // =========================================================================
  // Interface Implementation
  // =========================================================================

  getPlatformType() {
    return 'bitbucket';
  }

  getCapabilities() {
    return {
      supportsReactions: false,     // Bitbucket doesn't have comment reactions
      supportsReviewStates: false,  // Bitbucket doesn't have APPROVE/REQUEST_CHANGES on reviews
      supportsAutoFixPR: true,      // Can create PRs via API
      supportsCaching: true         // Uses file-based caching
    };
  }

  // =========================================================================
  // PR Data Access
  // =========================================================================

  async getDiff() {
    try {
      // Bitbucket API: GET /2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pr_id}/diff
      const diff = await withRetry(
        () => this._apiRequest(
          `/repositories/${this.context.owner}/${this.context.repo}/pullrequests/${this.context.prNumber}/diff`
        ),
        'getDiff'
      );
      return diff;
    } catch (error) {
      console.error('[ERROR] Failed to get PR diff:', error.message);
      throw error;
    }
  }

  async getChangedFiles() {
    try {
      // Bitbucket API: GET /2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pr_id}/diffstat
      const diffstat = await withRetry(
        () => this._apiRequest(
          `/repositories/${this.context.owner}/${this.context.repo}/pullrequests/${this.context.prNumber}/diffstat`
        ),
        'getChangedFiles'
      );

      // Handle pagination if needed
      let files = diffstat.values || [];
      let nextUrl = diffstat.next;

      while (nextUrl) {
        const nextPage = await this._apiRequest(nextUrl);
        files = files.concat(nextPage.values || []);
        nextUrl = nextPage.next;
      }

      // Extract file paths
      return files.map(f => f.new?.path || f.old?.path).filter(Boolean);
    } catch (error) {
      console.error('[ERROR] Failed to get changed files:', error.message);
      throw error;
    }
  }

  async getExistingComments() {
    try {
      // Bitbucket API: GET /2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pr_id}/comments
      const response = await withRetry(
        () => this._apiRequest(
          `/repositories/${this.context.owner}/${this.context.repo}/pullrequests/${this.context.prNumber}/comments`
        ),
        'getExistingComments'
      );

      // Handle pagination
      let comments = response.values || [];
      let nextUrl = response.next;

      while (nextUrl) {
        const nextPage = await this._apiRequest(nextUrl);
        comments = comments.concat(nextPage.values || []);
        nextUrl = nextPage.next;
      }

      // Filter for AI review comments and normalize format
      return comments.filter(c =>
        c.content?.raw?.includes(AI_REVIEW_MARKER) ||
        c.content?.raw?.includes('🤖') ||
        c.content?.raw?.includes('AI Code Review')
      ).map(c => ({
        id: c.id,
        path: c.inline?.path || null,
        line: c.inline?.to || null,
        body: c.content?.raw || ''
      }));
    } catch (error) {
      console.log('[WARN] Could not load existing comments:', error.message);
      return [];
    }
  }

  async getExistingReviews() {
    // Bitbucket doesn't have a separate "reviews" concept like GitHub
    // Comments are the equivalent, so return empty array
    return [];
  }

  async getFileContent(filePath) {
    try {
      // Bitbucket API: GET /2.0/repositories/{workspace}/{repo_slug}/src/{commit}/{path}
      const content = await this._apiRequest(
        `/repositories/${this.context.owner}/${this.context.repo}/src/${this.context.headSha}/${encodeURIComponent(filePath)}`
      );
      return content;
    } catch (error) {
      // Try reading from local filesystem (if pipeline checked out the code)
      try {
        const fullPath = path.join(process.cwd(), filePath);
        return await fs.readFile(fullPath, 'utf-8');
      } catch (fsError) {
        console.log(`[WARN] Could not read file ${filePath}:`, error.message);
        throw error;
      }
    }
  }

  // =========================================================================
  // PR Interaction
  // =========================================================================

  async postReview(body, comments = [], event = 'COMMENT') {
    try {
      // Add marker to the body for identification
      const markedBody = `${AI_REVIEW_MARKER}\n${body}`;

      // Post the summary as a general PR comment
      await this._postGeneralComment(markedBody);

      // Post inline comments
      for (const comment of comments) {
        await this._postInlineComment(comment);
      }

      // Handle approval/request changes via separate API
      if (event === 'APPROVE') {
        await this._approvePR();
      } else if (event === 'REQUEST_CHANGES') {
        // Bitbucket doesn't have REQUEST_CHANGES, but we can unapprove
        // and let the summary comment convey the need for changes
        console.log('[INFO] REQUEST_CHANGES converted to summary comment (Bitbucket limitation)');
      }

      console.log(`[INFO] Posted review with ${comments.length} inline comments`);
    } catch (error) {
      console.error('[ERROR] Failed to post review:', error.message);
      throw error;
    }
  }

  /**
   * Post a general comment on the PR
   * @private
   */
  async _postGeneralComment(body) {
    await withRetry(
      () => this._apiRequest(
        `/repositories/${this.context.owner}/${this.context.repo}/pullrequests/${this.context.prNumber}/comments`,
        {
          method: 'POST',
          body: JSON.stringify({
            content: {
              raw: body
            }
          })
        }
      ),
      'postGeneralComment'
    );
  }

  /**
   * Post an inline comment on the PR
   * @private
   */
  async _postInlineComment(comment) {
    try {
      await withRetry(
        () => this._apiRequest(
          `/repositories/${this.context.owner}/${this.context.repo}/pullrequests/${this.context.prNumber}/comments`,
          {
            method: 'POST',
            body: JSON.stringify({
              content: {
                raw: comment.body
              },
              inline: {
                path: comment.path,
                to: comment.position  // Bitbucket uses actual line number
              }
            })
          }
        ),
        'postInlineComment'
      );
    } catch (error) {
      // Log but don't fail for individual comment errors
      console.log(`[WARN] Failed to post inline comment at ${comment.path}:${comment.position}:`, error.message);
    }
  }

  /**
   * Approve the PR
   * @private
   */
  async _approvePR() {
    try {
      await this._apiRequest(
        `/repositories/${this.context.owner}/${this.context.repo}/pullrequests/${this.context.prNumber}/approve`,
        { method: 'POST' }
      );
      console.log('[INFO] PR approved');
    } catch (error) {
      console.log('[WARN] Could not approve PR:', error.message);
    }
  }

  calculateCommentPosition(file, targetLine) {
    // Bitbucket uses actual line numbers, not diff positions
    // We just return the target line directly
    // However, we need to verify the line exists in the diff (is an addition or context line)

    for (const hunk of file.hunks || []) {
      for (const change of hunk.changes || []) {
        if ((change.type === 'add' || change.type === 'context') && change.newLine === targetLine) {
          return targetLine;
        }
      }
    }

    // If exact line not found, try to find the closest added line within 5 lines
    let closestLine = null;
    let closestDistance = Infinity;

    for (const hunk of file.hunks || []) {
      for (const change of hunk.changes || []) {
        if (change.type === 'add' && change.newLine) {
          const distance = Math.abs(change.newLine - targetLine);
          if (distance < closestDistance && distance <= 5) {
            closestDistance = distance;
            closestLine = change.newLine;
          }
        }
      }
    }

    return closestLine;
  }

  // =========================================================================
  // Feature: Feedback Loop (Reactions)
  // =========================================================================

  async getCommentReactions(commentId) {
    // Bitbucket doesn't support reactions on comments
    return null;
  }

  async getReviewReactions(reviewId) {
    // Bitbucket doesn't have the review concept with reactions
    return null;
  }

  // =========================================================================
  // Feature: Auto-fix PRs
  // =========================================================================

  async createAutoFixPR(branchName, fixes, prTitle, prBody) {
    if (fixes.length === 0) {
      return null;
    }

    const sanitizedBranch = sanitizeBranchName(branchName);

    try {
      // Stash any current changes
      execSync('git stash', {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: GIT_TIMEOUT.local
      });

      // Create and checkout new branch
      execSync(`git checkout -b ${sanitizedBranch}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: GIT_TIMEOUT.local
      });

      // Group fixes by file
      const fixesByFile = new Map();
      for (const fix of fixes) {
        if (!fixesByFile.has(fix.file)) {
          fixesByFile.set(fix.file, []);
        }
        fixesByFile.get(fix.file).push(fix);
      }

      // Apply fixes to each file
      for (const [filePath, fileFixes] of fixesByFile) {
        try {
          const fullPath = path.join(process.cwd(), filePath);
          const content = await fs.readFile(fullPath, 'utf-8');
          const lines = content.split('\n');

          // Sort fixes by line number descending
          const sortedFixes = [...fileFixes].sort((a, b) => b.line - a.line);

          for (const fix of sortedFixes) {
            if (fix.line > 0 && fix.line <= lines.length) {
              lines[fix.line - 1] = fix.suggested;
            }
          }

          await fs.writeFile(fullPath, lines.join('\n'), 'utf-8');
        } catch (error) {
          console.log(`[WARN] Failed to apply fixes to ${filePath}:`, error.message);
        }
      }

      // Commit changes
      execSync('git add -A', {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: GIT_TIMEOUT.local
      });
      execSync(`git commit -m "${prTitle}"`, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: GIT_TIMEOUT.local
      });

      // Push branch
      execSync(`git push origin ${sanitizedBranch}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: GIT_TIMEOUT.network
      });

      // Get the source branch name
      const sourceBranch = this._prDetails?.source?.branch?.name || 'main';

      // Create PR via Bitbucket API
      const newPR = await this._apiRequest(
        `/repositories/${this.context.owner}/${this.context.repo}/pullrequests`,
        {
          method: 'POST',
          body: JSON.stringify({
            title: prTitle,
            description: prBody,
            source: {
              branch: {
                name: sanitizedBranch
              }
            },
            destination: {
              branch: {
                name: sourceBranch
              }
            },
            close_source_branch: true
          })
        }
      );

      // Checkout back to original branch
      execSync('git checkout -', {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: GIT_TIMEOUT.local
      });
      execSync('git stash pop || true', {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: GIT_TIMEOUT.local
      });

      console.log(`[INFO] Created auto-fix PR #${newPR.id}`);

      return {
        prNumber: newPR.id,
        prUrl: newPR.links?.html?.href || `https://bitbucket.org/${this.context.owner}/${this.context.repo}/pull-requests/${newPR.id}`,
        branch: sanitizedBranch,
        fixCount: fixes.length
      };
    } catch (error) {
      console.error('[ERROR] Failed to create auto-fix PR:', error.message);

      // Try to restore original state
      try {
        execSync('git checkout -', {
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: GIT_TIMEOUT.local
        });
        execSync('git stash pop || true', {
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: GIT_TIMEOUT.local
        });
      } catch (e) {
        // Ignore cleanup errors
      }

      return null;
    }
  }

  async getPRInfo(prNumber) {
    const response = await this._apiRequest(
      `/repositories/${this.context.owner}/${this.context.repo}/pullrequests/${prNumber}`
    );
    return {
      head: {
        ref: response.source?.branch?.name || 'main'
      },
      base: {
        ref: response.destination?.branch?.name || 'main'
      }
    };
  }

  // =========================================================================
  // Metrics & Summary
  // =========================================================================

  async writeMetricsSummary(summary) {
    // Bitbucket Pipelines doesn't have a native step summary feature like GitHub
    // We'll log the summary to stdout and optionally write to a file
    console.log('\n' + '='.repeat(60));
    console.log('AI PR Review Metrics Summary');
    console.log('='.repeat(60));
    console.log(summary);
    console.log('='.repeat(60) + '\n');

    // Also write to artifacts if needed
    try {
      const artifactPath = path.join(process.cwd(), '.ai-review-cache', 'metrics-summary.md');
      await fs.mkdir(path.dirname(artifactPath), { recursive: true });
      await fs.writeFile(artifactPath, summary);
    } catch (error) {
      // Ignore artifact write errors
    }
  }
}
