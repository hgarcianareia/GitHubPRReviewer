/**
 * Bitbucket Cloud Platform Adapter
 *
 * Implements the PlatformAdapter interface for Bitbucket Cloud.
 * Uses the Bitbucket REST API 2.0 for all operations.
 */

import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import {
  PlatformAdapter,
  AI_REVIEW_MARKER,
  parsePRNumber,
  validateRepoOwner,
  validateRepoName,
  validateGitSha,
  sanitizeBranchName
} from '@hgarcianareia/ai-pr-review-core';

// Bitbucket API configuration
const BITBUCKET_API_BASE = 'https://api.bitbucket.org/2.0';

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
 * Safely validate an environment variable with user-friendly error message
 */
function safeValidateEnv(name, validator, defaultValue = undefined) {
  try {
    return validator(process.env[name]);
  } catch (error) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    console.error('='.repeat(60));
    console.error(`[FATAL] ${name} Validation Failed`);
    console.error('='.repeat(60));
    console.error(`  ${error.message}`);
    console.error('');
    console.error('Please check your Bitbucket Pipelines configuration.');
    console.error('='.repeat(60));
    process.exit(1);
  }
}

/**
 * Bitbucket Cloud Platform Adapter Implementation
 */
export class BitbucketAdapter extends PlatformAdapter {
  /**
   * @param {Object} context - Platform context
   * @param {string} authHeader - Base64 encoded auth header for Basic auth
   */
  constructor(context, authHeader) {
    super(context);
    this.authHeader = authHeader;
  }

  /**
   * Factory method to create a BitbucketAdapter instance
   * @returns {Promise<BitbucketAdapter>}
   */
  static async create() {
    // Support both new API token format and legacy App Password format
    const apiEmail = process.env.BITBUCKET_API_EMAIL;
    const apiToken = process.env.BITBUCKET_API_TOKEN;
    const legacyUsername = process.env.BITBUCKET_USERNAME;
    const legacyToken = process.env.BITBUCKET_TOKEN;

    let authHeader;

    if (apiEmail && apiToken) {
      // New API token authentication (recommended)
      authHeader = Buffer.from(`${apiEmail}:${apiToken}`).toString('base64');
    } else if (legacyUsername && legacyToken) {
      // Legacy App Password authentication (deprecated)
      console.log('[WARN] Using deprecated BITBUCKET_USERNAME/BITBUCKET_TOKEN authentication.');
      console.log('[WARN] Please migrate to BITBUCKET_API_EMAIL/BITBUCKET_API_TOKEN.');
      console.log('[WARN] See: https://support.atlassian.com/bitbucket-cloud/docs/api-tokens/');
      authHeader = Buffer.from(`${legacyUsername}:${legacyToken}`).toString('base64');
    } else {
      console.error('='.repeat(60));
      console.error('[FATAL] Bitbucket authentication is required');
      console.error('='.repeat(60));
      console.error('  Please add these repository variables:');
      console.error('    - BITBUCKET_API_EMAIL: Your Atlassian account email');
      console.error('    - BITBUCKET_API_TOKEN: API token with scopes');
      console.error('');
      console.error('  Create an API token at:');
      console.error('    Bitbucket > Personal settings > Atlassian account settings >');
      console.error('    Security > API tokens > Create API token with scopes');
      console.error('');
      console.error('  Required scopes: Repositories (Read), Pull requests (Read, Write)');
      console.error('='.repeat(60));
      process.exit(1);
    }

    // Check if this is a manual dispatch
    const isManualDispatch = process.env.AI_REVIEW_TRIGGER === 'manual';

    // Build context from environment variables
    const context = {
      owner: safeValidateEnv('BITBUCKET_WORKSPACE', validateRepoOwner),
      repo: safeValidateEnv('BITBUCKET_REPO_SLUG', validateRepoName),
      prNumber: safeValidateEnv('BITBUCKET_PR_ID', parsePRNumber),
      prTitle: '',
      prBody: '',
      prAuthor: '',
      baseSha: null,
      headSha: safeValidateEnv('BITBUCKET_COMMIT', (v) => validateGitSha(v, 'BITBUCKET_COMMIT')),
      eventName: process.env.AI_REVIEW_TRIGGER || 'opened',
      isManualTrigger: isManualDispatch
    };

    const adapter = new BitbucketAdapter(context, authHeader);

    // Load PR metadata from API
    await adapter._loadPRMetadata();

    return adapter;
  }

  /**
   * Make an authenticated request to the Bitbucket API
   * @private
   */
  async _fetchBitbucket(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${BITBUCKET_API_BASE}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Basic ${this.authHeader}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options.headers
      }
    });

    if (!response.ok) {
      const error = new Error(`Bitbucket API error: ${response.status} ${response.statusText}`);
      error.status = response.status;
      try {
        error.body = await response.json();
      } catch (e) {
        // Ignore JSON parse errors
      }
      throw error;
    }

    // Handle empty responses
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return response.json();
    }
    return response.text();
  }

  /**
   * Load PR metadata from Bitbucket API
   * @private
   */
  async _loadPRMetadata() {
    try {
      const pr = await this._fetchBitbucket(
        `/repositories/${this.context.owner}/${this.context.repo}/pullrequests/${this.context.prNumber}`
      );

      this.context.prTitle = pr.title || '';
      this.context.prBody = pr.description || '';
      this.context.prAuthor = pr.author?.display_name || pr.author?.nickname || '';
      this.context.baseSha = pr.destination?.commit?.hash || null;

      // Update headSha if available from API
      if (pr.source?.commit?.hash) {
        this.context.headSha = pr.source.commit.hash;
      }

      console.log('[INFO] Loaded PR metadata from Bitbucket API');
    } catch (error) {
      console.error('[ERROR] Failed to load PR metadata:', error.message);
      throw new Error('Failed to load PR metadata from Bitbucket API');
    }

    // Validate baseSha after loading metadata
    if (!this.context.baseSha) {
      console.error('='.repeat(60));
      console.error('[FATAL] BASE_SHA Validation Failed');
      console.error('='.repeat(60));
      console.error('  Could not determine base commit SHA from PR metadata');
      console.error('='.repeat(60));
      process.exit(1);
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
      supportsReactions: false,      // Limited reaction support in Bitbucket
      supportsReviewStates: true,    // Supports APPROVE and REQUEST_CHANGES
      supportsAutoFixPR: true,
      supportsCaching: true
    };
  }

  // =========================================================================
  // PR Data Access
  // =========================================================================

  async getDiff() {
    // First try to read from file (prepared by pipeline script)
    try {
      const diffContent = await fs.readFile('pr_diff.txt', 'utf-8');
      return diffContent;
    } catch (error) {
      // Fall back to API
      console.log('[INFO] Fetching diff from Bitbucket API...');
    }

    try {
      const diff = await this._fetchBitbucket(
        `/repositories/${this.context.owner}/${this.context.repo}/pullrequests/${this.context.prNumber}/diff`,
        { headers: { 'Accept': 'text/plain' } }
      );
      return diff;
    } catch (error) {
      console.error('[ERROR] Failed to get diff:', error.message);
      throw error;
    }
  }

  async getChangedFiles() {
    // First try to read from file (prepared by pipeline script)
    try {
      const filesContent = await fs.readFile('changed_files.txt', 'utf-8');
      return filesContent.split('\n').filter(f => f.trim());
    } catch (error) {
      // Fall back to API
      console.log('[INFO] Fetching changed files from Bitbucket API...');
    }

    try {
      const diffstat = await this._fetchBitbucket(
        `/repositories/${this.context.owner}/${this.context.repo}/pullrequests/${this.context.prNumber}/diffstat`
      );

      const files = [];
      for (const entry of diffstat.values || []) {
        // Use new path if available, otherwise old path
        const filePath = entry.new?.path || entry.old?.path;
        if (filePath) {
          files.push(filePath);
        }
      }

      return files;
    } catch (error) {
      console.error('[ERROR] Failed to get changed files:', error.message);
      throw error;
    }
  }

  async getExistingComments() {
    // First try to read from file (prepared by pipeline script)
    try {
      const commentsJson = await fs.readFile('pr_comments.json', 'utf-8');
      const comments = JSON.parse(commentsJson);

      // Filter for AI review comments
      return comments.filter(c =>
        c.content?.raw?.includes(AI_REVIEW_MARKER) ||
        c.content?.raw?.includes('AI Code Review')
      ).map(c => ({
        id: c.id,
        path: c.inline?.path,
        line: c.inline?.to,
        body: c.content?.raw
      }));
    } catch (error) {
      // Fall back to API
      console.log('[INFO] Fetching existing comments from Bitbucket API...');
    }

    try {
      const response = await this._fetchBitbucket(
        `/repositories/${this.context.owner}/${this.context.repo}/pullrequests/${this.context.prNumber}/comments`
      );

      const comments = response.values || [];

      // Filter for AI review comments
      return comments.filter(c =>
        c.content?.raw?.includes(AI_REVIEW_MARKER) ||
        c.content?.raw?.includes('AI Code Review')
      ).map(c => ({
        id: c.id,
        path: c.inline?.path,
        line: c.inline?.to,
        body: c.content?.raw
      }));
    } catch (error) {
      console.log('[WARN] Could not load existing comments:', error.message);
      return [];
    }
  }

  async getExistingReviews() {
    // Bitbucket doesn't have a separate reviews concept like GitHub
    // Return empty array - we'll use comments for threading
    return [];
  }

  async getFileContent(filePath) {
    try {
      const fullPath = path.join(process.cwd(), filePath);
      return await fs.readFile(fullPath, 'utf-8');
    } catch (error) {
      // Try fetching from API if local file not found
      try {
        const content = await this._fetchBitbucket(
          `/repositories/${this.context.owner}/${this.context.repo}/src/${this.context.headSha}/${encodeURIComponent(filePath)}`,
          { headers: { 'Accept': 'text/plain' } }
        );
        return content;
      } catch (apiError) {
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

      // Post main summary comment
      await withRetry(
        () => this._fetchBitbucket(
          `/repositories/${this.context.owner}/${this.context.repo}/pullrequests/${this.context.prNumber}/comments`,
          {
            method: 'POST',
            body: JSON.stringify({
              content: { raw: markedBody }
            })
          }
        ),
        'postSummaryComment'
      );

      console.log('[INFO] Posted review summary comment');

      // Post inline comments
      for (const comment of comments) {
        try {
          await withRetry(
            () => this._fetchBitbucket(
              `/repositories/${this.context.owner}/${this.context.repo}/pullrequests/${this.context.prNumber}/comments`,
              {
                method: 'POST',
                body: JSON.stringify({
                  content: { raw: `${AI_REVIEW_MARKER}\n${comment.body}` },
                  inline: {
                    to: comment.position,  // Line number in new file
                    path: comment.path
                  }
                })
              }
            ),
            'postInlineComment'
          );
        } catch (error) {
          console.log(`[WARN] Failed to post inline comment on ${comment.path}:${comment.position}:`, error.message);
        }
      }

      console.log(`[INFO] Posted ${comments.length} inline comments`);

      // Handle review state
      if (event === 'APPROVE') {
        try {
          await withRetry(
            () => this._fetchBitbucket(
              `/repositories/${this.context.owner}/${this.context.repo}/pullrequests/${this.context.prNumber}/approve`,
              { method: 'POST' }
            ),
            'approvePR'
          );
          console.log('[INFO] Approved PR');
        } catch (error) {
          console.log('[WARN] Could not approve PR:', error.message);
        }
      } else if (event === 'REQUEST_CHANGES') {
        try {
          await withRetry(
            () => this._fetchBitbucket(
              `/repositories/${this.context.owner}/${this.context.repo}/pullrequests/${this.context.prNumber}/request-changes`,
              { method: 'POST' }
            ),
            'requestChangesPR'
          );
          console.log('[INFO] Requested changes on PR');
        } catch (error) {
          console.log('[WARN] Could not request changes on PR:', error.message);
        }
      }

    } catch (error) {
      console.error('[ERROR] Failed to post review:', error.message);
      throw error;
    }
  }

  calculateCommentPosition(file, targetLine) {
    // Bitbucket uses line numbers directly, not diff positions
    // Validate the line exists in an added or context section
    for (const hunk of file.hunks || []) {
      for (const change of hunk.changes || []) {
        if ((change.type === 'add' || change.type === 'context') &&
            change.newLine === targetLine) {
          return targetLine;
        }
      }
    }

    // If exact line not found, find closest added line within 5 lines
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
    // Bitbucket has limited reaction support - return null
    return null;
  }

  async getReviewReactions(reviewId) {
    // Bitbucket doesn't have review reactions - return null
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

          // Sort fixes by line number descending to apply from bottom up
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

      // Get the base branch (the PR's source branch)
      const prInfo = await this.getPRInfo(this.context.prNumber);
      const baseBranch = prInfo.source?.branch?.name;

      if (!baseBranch) {
        throw new Error('Could not determine source branch for auto-fix PR');
      }

      // Create PR via Bitbucket API
      const newPR = await this._fetchBitbucket(
        `/repositories/${this.context.owner}/${this.context.repo}/pullrequests`,
        {
          method: 'POST',
          body: JSON.stringify({
            title: prTitle,
            description: prBody,
            source: {
              branch: { name: sanitizedBranch }
            },
            destination: {
              branch: { name: baseBranch }
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
    const response = await this._fetchBitbucket(
      `/repositories/${this.context.owner}/${this.context.repo}/pullrequests/${prNumber}`
    );
    return response;
  }

  // =========================================================================
  // Metrics & Summary
  // =========================================================================

  async writeMetricsSummary(summary) {
    // Bitbucket Pipelines doesn't have a native step summary feature like GitHub Actions
    // Log to console instead
    console.log('\n' + '='.repeat(60));
    console.log('AI Review Metrics Summary');
    console.log('='.repeat(60));
    console.log(summary);
    console.log('='.repeat(60) + '\n');
  }
}
