/**
 * @hernangarcia/ai-pr-review-core
 *
 * Core library for AI-powered PR reviews using Claude.
 * This package is platform-agnostic and provides the review engine,
 * platform adapter interface, and utility functions.
 *
 * Usage:
 *   import { ReviewEngine, PlatformAdapter } from '@hernangarcia/ai-pr-review-core';
 *
 *   // Create your platform adapter (implements PlatformAdapter)
 *   const adapter = new MyPlatformAdapter(context);
 *
 *   // Create and run the review engine
 *   const engine = new ReviewEngine({
 *     platformAdapter: adapter,
 *     anthropicApiKey: process.env.ANTHROPIC_API_KEY
 *   });
 *
 *   await engine.run();
 */

// Platform adapter interface and utilities
export {
  PlatformAdapter,
  AI_REVIEW_MARKER,
  detectPlatform
} from './platform-adapter.js';

// Review engine
export {
  ReviewEngine,
  DEFAULT_CONFIG
} from './review-engine.js';

// Utility functions
export {
  // Validation
  parsePRNumber,
  validateRepoOwner,
  validateRepoName,
  validateGitSha,
  sanitizeBranchName,

  // File utilities
  shouldIgnoreFile,
  detectLanguage,

  // Object utilities
  deepMerge,
  ensureArray,

  // Diff utilities
  parseDiff,
  calculateDiffPosition,
  chunkDiff,

  // Severity utilities
  SEVERITY_LEVELS,
  getSeverityLevel,
  filterBySeverityThreshold,

  // PR utilities
  extractCustomInstructions,
  filterIgnoredContent,
  checkPRSize,
  extractImports
} from './utils.js';
