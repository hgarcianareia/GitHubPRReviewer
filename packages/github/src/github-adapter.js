/**
 * GitHub Platform Adapter
 *
 * Implements the PlatformAdapter interface for GitHub Actions.
 * Wraps Octokit API calls and handles GitHub-specific operations.
 */

import { Octokit } from '@octokit/rest';
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
  sanitizeBranchName,
  calculateDiffPosition
} from '@hgarcianareia/ai-pr-review-core';

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
    console.error('Please check your GitHub Actions workflow configuration.');
    console.error('='.repeat(60));
    process.exit(1);
  }
}

/**
 * GitHub Platform Adapter Implementation
 */
export class GitHubAdapter extends PlatformAdapter {
  /**
   * @param {Object} context - Platform context
   * @param {Octokit} octokit - Initialized Octokit client
   */
  constructor(context, octokit) {
    super(context);
    this.octokit = octokit;
  }

  /**
   * Factory method to create a GitHubAdapter instance
   * @returns {Promise<GitHubAdapter>}
   */
  static async create() {
    // Validate required API keys
    if (!process.env.GITHUB_TOKEN) {
      console.error('='.repeat(60));
      console.error('[FATAL] GITHUB_TOKEN is required');
      console.error('='.repeat(60));
      console.error('  The GITHUB_TOKEN should be automatically provided by GitHub Actions.');
      console.error('  If missing, check your workflow permissions configuration.');
      console.error('='.repeat(60));
      process.exit(1);
    }

    // Initialize Octokit
    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN
    });

    // Check if this is a manual dispatch
    const isManualDispatch = process.env.AI_REVIEW_TRIGGER === 'manual';

    // Build context from environment variables
    const context = {
      owner: safeValidateEnv('REPO_OWNER', validateRepoOwner),
      repo: safeValidateEnv('REPO_NAME', validateRepoName),
      prNumber: safeValidateEnv('PR_NUMBER', parsePRNumber),
      prTitle: process.env.PR_TITLE || '',
      prBody: process.env.PR_BODY || '',
      prAuthor: process.env.PR_AUTHOR || '',
      baseSha: isManualDispatch
        ? (process.env.BASE_SHA || null)
        : safeValidateEnv('BASE_SHA', (v) => validateGitSha(v, 'BASE_SHA')),
      headSha: safeValidateEnv('HEAD_SHA', (v) => validateGitSha(v, 'HEAD_SHA')),
      eventName: process.env.AI_REVIEW_TRIGGER || 'opened',
      isManualTrigger: isManualDispatch
    };

    const adapter = new GitHubAdapter(context, octokit);

    // Load PR metadata for manual dispatch
    if (isManualDispatch) {
      await adapter._loadPRMetadata();
    }

    return adapter;
  }

  /**
   * Load PR metadata from pr_metadata.json for manual dispatch
   * @private
   */
  async _loadPRMetadata() {
    try {
      const metadataContent = await fs.readFile('pr_metadata.json', 'utf-8');
      const metadata = JSON.parse(metadataContent);

      // Fill in missing context from metadata
      this.context.prTitle = metadata.title || this.context.prTitle;
      this.context.prBody = metadata.body || this.context.prBody;
      this.context.prAuthor = metadata.author?.login || this.context.prAuthor;
      this.context.baseSha = metadata.baseRefOid || this.context.baseSha;

      console.log('[INFO] Loaded PR metadata for manual dispatch');
    } catch (error) {
      console.error('[ERROR] Failed to load pr_metadata.json:', error.message);
      throw new Error('pr_metadata.json is required for workflow_dispatch trigger');
    }

    // Validate baseSha after loading metadata
    if (!this.context.baseSha) {
      console.error('='.repeat(60));
      console.error('[FATAL] BASE_SHA Validation Failed');
      console.error('='.repeat(60));
      console.error('  BASE_SHA could not be determined from pr_metadata.json');
      console.error('='.repeat(60));
      process.exit(1);
    }

    // Validate the SHA format
    try {
      validateGitSha(this.context.baseSha, 'BASE_SHA');
    } catch (error) {
      console.error('='.repeat(60));
      console.error('[FATAL] BASE_SHA Validation Failed');
      console.error('='.repeat(60));
      console.error(`  ${error.message}`);
      console.error('='.repeat(60));
      process.exit(1);
    }
  }

  // =========================================================================
  // Interface Implementation
  // =========================================================================

  getPlatformType() {
    return 'github';
  }

  getCapabilities() {
    return {
      supportsReactions: true,
      supportsReviewStates: true,
      supportsAutoFixPR: true,
      supportsCaching: true
    };
  }

  // =========================================================================
  // PR Data Access
  // =========================================================================

  async getDiff() {
    try {
      const diffContent = await fs.readFile('pr_diff.txt', 'utf-8');
      return diffContent;
    } catch (error) {
      console.error('[ERROR] Failed to read diff file:', error.message);
      throw error;
    }
  }

  async getChangedFiles() {
    try {
      const filesContent = await fs.readFile('changed_files.txt', 'utf-8');
      return filesContent.split('\n').filter(f => f.trim());
    } catch (error) {
      console.error('[ERROR] Failed to read changed files:', error.message);
      throw error;
    }
  }

  async getExistingComments() {
    try {
      const commentsJson = await fs.readFile('pr_comments.json', 'utf-8');
      const comments = JSON.parse(commentsJson);

      // Filter for AI review comments
      return comments.filter(c =>
        c.body?.includes(AI_REVIEW_MARKER) ||
        c.body?.includes('🤖') ||
        c.body?.includes('AI Code Review')
      ).map(c => ({
        id: c.id,
        path: c.path,
        line: c.line,
        body: c.body
      }));
    } catch (error) {
      console.log('[WARN] Could not load existing comments:', error.message);
      return [];
    }
  }

  async getExistingReviews() {
    try {
      const reviewsJson = await fs.readFile('pr_reviews.json', 'utf-8');
      const reviews = JSON.parse(reviewsJson);

      // Filter for AI reviews
      return reviews.filter(r =>
        r.body?.includes(AI_REVIEW_MARKER) ||
        r.body?.includes('🤖 AI Code Review')
      );
    } catch (error) {
      console.log('[WARN] Could not load existing reviews:', error.message);
      return [];
    }
  }

  async getFileContent(filePath) {
    try {
      const fullPath = path.join(process.cwd(), filePath);
      return await fs.readFile(fullPath, 'utf-8');
    } catch (error) {
      console.log(`[WARN] Could not read file ${filePath}:`, error.message);
      throw error;
    }
  }

  // =========================================================================
  // PR Interaction
  // =========================================================================

  async postReview(body, comments = [], event = 'COMMENT') {
    try {
      // Add marker to the body for identification
      const markedBody = `${AI_REVIEW_MARKER}\n${body}`;

      // GitHub Actions cannot APPROVE PRs by default (security restriction)
      let safeEvent = event;
      if (event === 'APPROVE') {
        console.log('[INFO] Converting APPROVE to COMMENT (GitHub Actions cannot approve PRs)');
        safeEvent = 'COMMENT';
      }

      // Batch comments to avoid GitHub API 502 errors (max ~10 comments per request)
      const MAX_COMMENTS_PER_BATCH = 10;

      if (comments.length <= MAX_COMMENTS_PER_BATCH) {
        // Small number of comments - post all at once
        await withRetry(
          () => this.octokit.pulls.createReview({
            owner: this.context.owner,
            repo: this.context.repo,
            pull_number: this.context.prNumber,
            commit_id: this.context.headSha,
            body: markedBody,
            event: safeEvent,
            comments: comments
          }),
          'postReviewComment'
        );
        console.log(`[INFO] Posted review with ${comments.length} inline comments (event: ${safeEvent})`);
      } else {
        // Large number of comments - batch them
        console.log(`[INFO] Batching ${comments.length} comments into chunks of ${MAX_COMMENTS_PER_BATCH}`);

        // First, post the summary review with the first batch of comments
        const firstBatch = comments.slice(0, MAX_COMMENTS_PER_BATCH);
        await withRetry(
          () => this.octokit.pulls.createReview({
            owner: this.context.owner,
            repo: this.context.repo,
            pull_number: this.context.prNumber,
            commit_id: this.context.headSha,
            body: markedBody,
            event: safeEvent,
            comments: firstBatch
          }),
          'postReviewComment'
        );
        console.log(`[INFO] Posted review with first ${firstBatch.length} inline comments (event: ${safeEvent})`);

        // Post remaining comments in batches as separate COMMENT reviews
        for (let i = MAX_COMMENTS_PER_BATCH; i < comments.length; i += MAX_COMMENTS_PER_BATCH) {
          const batch = comments.slice(i, i + MAX_COMMENTS_PER_BATCH);
          const batchNum = Math.floor(i / MAX_COMMENTS_PER_BATCH) + 1;

          await withRetry(
            () => this.octokit.pulls.createReview({
              owner: this.context.owner,
              repo: this.context.repo,
              pull_number: this.context.prNumber,
              commit_id: this.context.headSha,
              body: `${AI_REVIEW_MARKER}\n*Additional review comments (batch ${batchNum + 1})*`,
              event: 'COMMENT',
              comments: batch
            }),
            `postReviewCommentBatch${batchNum + 1}`
          );
          console.log(`[INFO] Posted batch ${batchNum + 1} with ${batch.length} inline comments`);

          // Small delay between batches to avoid rate limiting
          await sleep(1000);
        }

        console.log(`[INFO] Completed posting all ${comments.length} comments in ${Math.ceil(comments.length / MAX_COMMENTS_PER_BATCH)} batches`);
      }
    } catch (error) {
      console.error('[ERROR] Failed to post review:', error.message);
      throw error;
    }
  }

  calculateCommentPosition(file, targetLine) {
    // Use the shared utility function
    return calculateDiffPosition(file, targetLine);
  }

  // =========================================================================
  // Feature: Feedback Loop (Reactions)
  // =========================================================================

  async getCommentReactions(commentId) {
    try {
      const reactions = await this.octokit.reactions.listForPullRequestReviewComment({
        owner: this.context.owner,
        repo: this.context.repo,
        comment_id: commentId
      });

      const positive = reactions.data.filter(r =>
        ['+1', 'heart', 'rocket', 'hooray'].includes(r.content)
      ).length;
      const negative = reactions.data.filter(r =>
        ['-1', 'confused'].includes(r.content)
      ).length;

      return { positive, negative };
    } catch (error) {
      console.log('[WARN] Could not get comment reactions:', error.message);
      return null;
    }
  }

  async getReviewReactions(reviewId) {
    try {
      // Get comments for this review
      const reviewComments = await this.octokit.pulls.listCommentsForReview({
        owner: this.context.owner,
        repo: this.context.repo,
        pull_number: this.context.prNumber,
        review_id: reviewId
      });

      let totalPositive = 0;
      let totalNegative = 0;

      for (const comment of reviewComments.data) {
        const reactions = await this.getCommentReactions(comment.id);
        if (reactions) {
          totalPositive += reactions.positive;
          totalNegative += reactions.negative;
        }
      }

      return { positive: totalPositive, negative: totalNegative };
    } catch (error) {
      console.log('[WARN] Could not get review reactions:', error.message);
      return null;
    }
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
      // Log working directory for debugging
      console.log(`[INFO] Auto-fix working directory: ${process.cwd()}`);

      // Configure git identity for commits
      try {
        execSync('git config user.email "ai-review-bot@users.noreply.github.com"', {
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: GIT_TIMEOUT.local
        });
        execSync('git config user.name "AI Review Bot"', {
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: GIT_TIMEOUT.local
        });
        console.log('[INFO] Configured git identity for auto-fix commits');
      } catch (e) {
        console.log('[WARN] Could not configure git identity:', e.message);
      }

      // Check if we're in a git repo and on the right branch
      try {
        const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: GIT_TIMEOUT.local
        }).trim();
        console.log(`[INFO] Current git branch: ${currentBranch}`);
      } catch (e) {
        console.log('[WARN] Could not determine current branch');
      }

      // Stash any current changes (ignore errors if nothing to stash)
      try {
        execSync('git stash', {
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: GIT_TIMEOUT.local
        });
      } catch (e) {
        console.log('[INFO] Nothing to stash');
      }

      // Get the PR's head branch to base our fixes on
      const prInfo = await this.getPRInfo(this.context.prNumber);
      const prHeadBranch = prInfo.head.ref;
      console.log(`[INFO] PR head branch: ${prHeadBranch}`);

      // Fetch the PR branch if we don't have it
      try {
        execSync(`git fetch origin ${prHeadBranch}`, {
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: GIT_TIMEOUT.network
        });
      } catch (e) {
        console.log(`[WARN] Could not fetch ${prHeadBranch}: ${e.message}`);
      }

      // Create new branch from PR head
      execSync(`git checkout -b ${sanitizedBranch} origin/${prHeadBranch}`, {
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

      // Apply fixes to each file and track which files were modified
      let appliedCount = 0;
      const modifiedFiles = [];

      for (const [filePath, fileFixes] of fixesByFile) {
        try {
          const fullPath = path.join(process.cwd(), filePath);

          // Check if file exists
          try {
            await fs.access(fullPath);
          } catch (e) {
            console.log(`[WARN] File not found, skipping: ${filePath}`);
            continue;
          }

          const content = await fs.readFile(fullPath, 'utf-8');
          const lines = content.split('\n');

          // Sort fixes by line number descending to apply from bottom up
          const sortedFixes = [...fileFixes].sort((a, b) => b.line - a.line);

          let fileModified = false;
          for (const fix of sortedFixes) {
            if (fix.line > 0 && fix.line <= lines.length) {
              lines[fix.line - 1] = fix.suggested;
              appliedCount++;
              fileModified = true;
            }
          }

          if (fileModified) {
            await fs.writeFile(fullPath, lines.join('\n'), 'utf-8');
            modifiedFiles.push(filePath);
            console.log(`[INFO] Applied ${fileFixes.length} fixes to ${filePath}`);
          }
        } catch (error) {
          console.log(`[WARN] Failed to apply fixes to ${filePath}:`, error.message);
        }
      }

      // Check if we actually applied any fixes
      if (appliedCount === 0 || modifiedFiles.length === 0) {
        console.log('[WARN] No fixes were applied, skipping auto-fix PR creation');
        execSync('git checkout -', {
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: GIT_TIMEOUT.local
        });
        return null;
      }

      // Only add the specific files that were modified (not all files)
      for (const filePath of modifiedFiles) {
        execSync(`git add "${filePath}"`, {
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: GIT_TIMEOUT.local
        });
      }
      console.log(`[INFO] Staged ${modifiedFiles.length} modified files for commit`);

      // Check if there are actually changes to commit
      const status = execSync('git status --porcelain', {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: GIT_TIMEOUT.local
      }).trim();

      if (!status) {
        console.log('[WARN] No changes to commit after applying fixes');
        execSync('git checkout -', {
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: GIT_TIMEOUT.local
        });
        return null;
      }

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

      // Create PR targeting the PR's head branch (so it merges into the PR)
      const newPR = await this.octokit.pulls.create({
        owner: this.context.owner,
        repo: this.context.repo,
        title: prTitle,
        body: prBody,
        head: sanitizedBranch,
        base: prHeadBranch
      });

      // Checkout back to original branch
      try {
        execSync('git checkout -', {
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: GIT_TIMEOUT.local
        });
      } catch (e) {
        // Ignore if we can't switch back
      }

      try {
        execSync('git stash pop || true', {
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: GIT_TIMEOUT.local
        });
      } catch (e) {
        // Ignore if nothing to pop
      }

      console.log(`[INFO] Created auto-fix PR #${newPR.data.number}`);

      return {
        prNumber: newPR.data.number,
        prUrl: newPR.data.html_url,
        branch: sanitizedBranch,
        fixCount: appliedCount
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
    const response = await this.octokit.pulls.get({
      owner: this.context.owner,
      repo: this.context.repo,
      pull_number: prNumber
    });
    return response.data;
  }

  // =========================================================================
  // Metrics & Summary
  // =========================================================================

  async writeMetricsSummary(summary) {
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      try {
        await fs.appendFile(summaryPath, summary);
        console.log('[INFO] Wrote metrics to GitHub Actions summary');
      } catch (error) {
        console.log('[WARN] Failed to write metrics summary:', error.message);
      }
    }
  }
}
