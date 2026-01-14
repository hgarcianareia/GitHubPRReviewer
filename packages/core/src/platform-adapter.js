/**
 * Platform Adapter Interface
 *
 * Defines the contract for platform-specific operations.
 * Implementations exist for GitHub and Bitbucket.
 *
 * This allows the core review logic to be platform-agnostic
 * while supporting the full feature set on both platforms.
 */

/**
 * Platform type enum
 * @typedef {'github' | 'bitbucket'} PlatformType
 */

/**
 * Normalized context object shared across platforms
 * @typedef {Object} PlatformContext
 * @property {string} owner - Repository owner (GitHub) or workspace (Bitbucket)
 * @property {string} repo - Repository name
 * @property {number} prNumber - Pull request number/ID
 * @property {string} prTitle - Pull request title
 * @property {string} prBody - Pull request description
 * @property {string} prAuthor - Pull request author username
 * @property {string} baseSha - Base commit SHA
 * @property {string} headSha - Head commit SHA
 * @property {string} eventName - Event that triggered the review
 * @property {boolean} isManualTrigger - Whether this was manually triggered
 */

/**
 * Inline comment structure for posting
 * @typedef {Object} InlineComment
 * @property {string} path - File path
 * @property {number} position - Position in diff (GitHub) or line number (Bitbucket)
 * @property {string} body - Comment body in markdown
 */

/**
 * Existing comment structure from platform
 * @typedef {Object} ExistingComment
 * @property {string|number} id - Comment ID
 * @property {string} path - File path
 * @property {number} line - Line number
 * @property {string} body - Comment body
 */

/**
 * Reaction/feedback counts
 * @typedef {Object} ReactionCounts
 * @property {number} positive - Positive reactions (thumbs up, heart, etc.)
 * @property {number} negative - Negative reactions (thumbs down, confused)
 */

/**
 * Auto-fix PR result
 * @typedef {Object} AutoFixResult
 * @property {number} prNumber - Created PR number
 * @property {string} prUrl - URL to the created PR
 * @property {string} branch - Branch name used
 * @property {number} fixCount - Number of fixes applied
 */

/**
 * Platform capabilities - what features the platform supports
 * @typedef {Object} PlatformCapabilities
 * @property {boolean} supportsReactions - Can get comment reactions
 * @property {boolean} supportsReviewStates - Can post APPROVE/REQUEST_CHANGES
 * @property {boolean} supportsAutoFixPR - Can create auto-fix PRs
 * @property {boolean} supportsCaching - Can cache reviewed commits
 */

/**
 * Abstract base class for platform adapters
 *
 * Each platform (GitHub, Bitbucket) implements this interface
 * to provide platform-specific operations while maintaining
 * a consistent API for the core review logic.
 */
export class PlatformAdapter {
  /**
   * @param {PlatformContext} context - Normalized platform context
   */
  constructor(context) {
    if (new.target === PlatformAdapter) {
      throw new Error('PlatformAdapter is abstract and cannot be instantiated directly');
    }
    this.context = context;
  }

  /**
   * Get the platform type
   * @returns {PlatformType}
   */
  getPlatformType() {
    throw new Error('getPlatformType() must be implemented');
  }

  /**
   * Get platform capabilities
   * @returns {PlatformCapabilities}
   */
  getCapabilities() {
    throw new Error('getCapabilities() must be implemented');
  }

  /**
   * Get the normalized context
   * @returns {PlatformContext}
   */
  getContext() {
    return this.context;
  }

  // =========================================================================
  // PR Data Access
  // =========================================================================

  /**
   * Get the PR diff content
   * @returns {Promise<string>} Unified diff content
   */
  async getDiff() {
    throw new Error('getDiff() must be implemented');
  }

  /**
   * Get list of changed files
   * @returns {Promise<string[]>} Array of file paths
   */
  async getChangedFiles() {
    throw new Error('getChangedFiles() must be implemented');
  }

  /**
   * Get existing AI review comments on the PR
   * Used for comment threading (avoiding duplicates)
   * @returns {Promise<ExistingComment[]>}
   */
  async getExistingComments() {
    throw new Error('getExistingComments() must be implemented');
  }

  /**
   * Get existing AI reviews on the PR
   * Used for stale review detection
   * @returns {Promise<Object[]>}
   */
  async getExistingReviews() {
    throw new Error('getExistingReviews() must be implemented');
  }

  /**
   * Read file content from the repository
   * Used for contextual awareness feature
   * @param {string} filePath - Path to the file
   * @returns {Promise<string>} File content
   */
  async getFileContent(filePath) {
    throw new Error('getFileContent() must be implemented');
  }

  // =========================================================================
  // PR Interaction
  // =========================================================================

  /**
   * Post a review with inline comments
   * @param {string} body - Review summary body (markdown)
   * @param {InlineComment[]} comments - Array of inline comments
   * @param {'APPROVE'|'REQUEST_CHANGES'|'COMMENT'} event - Review event type
   * @returns {Promise<void>}
   */
  async postReview(body, comments, event) {
    throw new Error('postReview() must be implemented');
  }

  /**
   * Calculate the correct position/line for an inline comment
   * GitHub uses diff positions, Bitbucket uses line numbers
   * @param {Object} file - Parsed file object from diff
   * @param {number} targetLine - Target line number in the new file
   * @returns {number|null} Position for the comment, or null if not found
   */
  calculateCommentPosition(file, targetLine) {
    throw new Error('calculateCommentPosition() must be implemented');
  }

  // =========================================================================
  // Feature: Feedback Loop (Reactions)
  // =========================================================================

  /**
   * Get reactions on a comment
   * Returns null if platform doesn't support reactions
   * @param {string|number} commentId - Comment ID
   * @returns {Promise<ReactionCounts|null>}
   */
  async getCommentReactions(commentId) {
    // Default implementation for platforms without reaction support
    return null;
  }

  /**
   * Get reactions on review comments
   * @param {string|number} reviewId - Review ID
   * @returns {Promise<ReactionCounts|null>}
   */
  async getReviewReactions(reviewId) {
    // Default implementation for platforms without reaction support
    return null;
  }

  // =========================================================================
  // Feature: Auto-fix PRs
  // =========================================================================

  /**
   * Create a PR with auto-fixes
   * @param {string} branchName - Branch name for fixes
   * @param {Object[]} fixes - Array of fixes to apply
   * @param {string} prTitle - PR title
   * @param {string} prBody - PR body
   * @returns {Promise<AutoFixResult|null>}
   */
  async createAutoFixPR(branchName, fixes, prTitle, prBody) {
    throw new Error('createAutoFixPR() must be implemented');
  }

  /**
   * Get PR info (for auto-fix feature)
   * @param {number} prNumber - PR number
   * @returns {Promise<Object>}
   */
  async getPRInfo(prNumber) {
    throw new Error('getPRInfo() must be implemented');
  }

  // =========================================================================
  // Feature: Caching
  // =========================================================================

  /**
   * Check if a commit has already been reviewed
   * @param {string} sha - Commit SHA
   * @returns {Promise<boolean>}
   */
  async isCommitCached(sha) {
    // Default implementation using file-based cache
    // Can be overridden for platform-specific caching
    const fs = await import('fs/promises');
    const path = await import('path');

    try {
      const cachePath = path.default.join(process.cwd(), '.ai-review-cache', 'reviewed-commits.txt');
      const content = await fs.default.readFile(cachePath, 'utf-8');
      const commits = content.split('\n').filter(c => c.trim());
      return commits.includes(sha);
    } catch (error) {
      return false;
    }
  }

  /**
   * Mark a commit as reviewed in cache
   * @param {string} sha - Commit SHA
   * @returns {Promise<void>}
   */
  async cacheCommit(sha) {
    // Default implementation using file-based cache
    const fs = await import('fs/promises');
    const path = await import('path');

    const cacheDir = path.default.join(process.cwd(), '.ai-review-cache');
    const cachePath = path.default.join(cacheDir, 'reviewed-commits.txt');

    try {
      await fs.default.mkdir(cacheDir, { recursive: true });
      await fs.default.appendFile(cachePath, sha + '\n');
    } catch (error) {
      // Ignore cache write errors
    }
  }

  // =========================================================================
  // Metrics & Summary
  // =========================================================================

  /**
   * Write metrics to platform summary (if supported)
   * @param {string} summary - Markdown summary content
   * @returns {Promise<void>}
   */
  async writeMetricsSummary(summary) {
    // Default implementation - can be overridden
    const fs = await import('fs/promises');

    const summaryPath = process.env.GITHUB_STEP_SUMMARY || process.env.BITBUCKET_STEP_SUMMARY;
    if (summaryPath) {
      try {
        await fs.default.appendFile(summaryPath, summary);
      } catch (error) {
        // Ignore summary write errors
      }
    }
  }
}

/**
 * AI Review marker for identifying bot comments
 */
export const AI_REVIEW_MARKER = '<!-- ai-pr-review -->';

/**
 * Detect the current platform from environment variables
 * @returns {PlatformType}
 */
export function detectPlatform() {
  if (process.env.BITBUCKET_BUILD_NUMBER || process.env.BITBUCKET_PIPELINE_UUID) {
    return 'bitbucket';
  }
  return 'github';
}
