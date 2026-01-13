/**
 * AI PR Review Script
 *
 * Uses Claude (Anthropic) to perform comprehensive code reviews on Pull Requests.
 * Posts inline comments and a summary review on the PR.
 *
 * Features:
 *   - Incremental reviews (only review new commits after first review)
 *   - Comment threading (update existing comments instead of duplicates)
 *   - Auto-dismiss stale reviews when issues are fixed
 *   - File-level ignore comments (ai-review-ignore)
 *   - PR size warnings
 *   - Review caching by commit SHA
 *   - Custom review instructions from PR description
 *   - Metrics and analytics
 *
 * Environment Variables Required:
 *   - ANTHROPIC_API_KEY: API key for Claude
 *   - GITHUB_TOKEN: GitHub token for PR interactions
 *   - PR_NUMBER: Pull request number
 *   - REPO_OWNER: Repository owner
 *   - REPO_NAME: Repository name
 *   - BASE_SHA: Base commit SHA
 *   - HEAD_SHA: Head commit SHA
 */

import Anthropic from '@anthropic-ai/sdk';
import { Octokit } from '@octokit/rest';
import fs from 'fs/promises';
import yaml from 'js-yaml';
import path from 'path';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG = {
  enabled: true,
  model: 'claude-sonnet-4-20250514',
  maxTokens: 4096,
  reviewAreas: {
    codeQuality: true,
    security: true,
    documentation: true,
    testCoverage: true,
    conventions: true
  },
  languages: ['csharp', 'typescript', 'python'],
  ignorePatterns: [
    '*.lock',
    'package-lock.json',
    'yarn.lock',
    '*.min.js',
    '*.min.css',
    'dist/**',
    'build/**',
    'node_modules/**'
  ],
  chunkSize: 100000,
  maxFilesPerReview: 50,
  severity: {
    critical: true,
    warning: true,
    suggestion: true,
    nitpick: false
  },
  // New feature defaults
  prSizeWarning: {
    enabled: true,
    maxLines: 1000,
    maxFiles: 30
  },
  incrementalReview: {
    enabled: true
  },
  caching: {
    enabled: true
  },
  customInstructions: {
    enabled: true
  },
  inlineIgnore: {
    enabled: true,
    patterns: ['ai-review-ignore', 'ai-review-ignore-next-line', 'ai-review-ignore-file']
  },
  metrics: {
    enabled: true,
    showInSummary: true,
    showInComment: true
  },
  // High Impact Features
  feedbackLoop: {
    enabled: true
      log('info', `Converting APPROVE to COMMENT (GitHub Actions cannot approve PRs) - original event: ${event}`);
  },
  contextualAwareness: {
    enabled: true,
    maxRelatedFiles: 5,       // Maximum related files to read
    includeImports: true,     // Always include imported files
    includeTests: false,      // Include related test files
    includeSimilarFiles: false // Include files with similar names
  },
  autoFix: {
    enabled: false,           // Disabled by default for safety
    createSeparatePR: true,   // Create fixes in a separate PR
    requireApproval: true,    // Require approval before creating PR
    branchPrefix: 'ai-fix/'   // Prefix for auto-fix branches
  },
  severityThreshold: {
    enabled: false,           // Disabled by default
    minSeverityToComment: 'warning',  // minimum: critical, warning, suggestion, nitpick
    skipCleanPRs: false       // Skip posting if no issues above threshold
  }
};

// Rate limiting configuration
const RATE_LIMIT = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000
};

// AI Review marker for identifying our comments
const AI_REVIEW_MARKER = '<!-- ai-pr-review -->';

// ============================================================================
// Initialization
// ============================================================================

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

const context = {
  owner: process.env.REPO_OWNER,
  repo: process.env.REPO_NAME,
  prNumber: parseInt(process.env.PR_NUMBER, 10),
  prTitle: process.env.PR_TITLE || '',
  prBody: process.env.PR_BODY || '',
  prAuthor: process.env.PR_AUTHOR || '',
  baseSha: process.env.BASE_SHA,
  headSha: process.env.HEAD_SHA,
  eventName: process.env.GITHUB_EVENT_NAME || 'opened',
  cacheHit: process.env.CACHE_HIT === 'true'
};

// Metrics tracking
const metrics = {
  startTime: Date.now(),
  filesReviewed: 0,
  linesReviewed: 0,
  commentsPosted: 0,
  criticalIssues: 0,
  warningIssues: 0,
  suggestionIssues: 0,
  cachedSkipped: false,
  incrementalReview: false,
  apiCalls: 0,
  tokensUsed: 0,
  // High Impact feature metrics
  relatedFilesRead: 0,
  suggestedFixesCount: 0,
  autoFixPRCreated: false,
  skippedDueToThreshold: false
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Logs a message with timestamp and level
 */
function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

  if (data) {
    console.log(logMessage, JSON.stringify(data, null, 2));
  } else {
    console.log(logMessage);
  }
}

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
        log('warn', `Rate limited on ${operation}, attempt ${attempt}/${RATE_LIMIT.maxRetries}`);
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
 * Load configuration from .github/ai-review.yml or use defaults
 */
async function loadConfig() {
  const configPath = path.join(process.cwd(), '.github', 'ai-review.yml');

  try {
    const configContent = await fs.readFile(configPath, 'utf-8');
    const userConfig = yaml.load(configContent);
    log('info', 'Loaded custom configuration from .github/ai-review.yml');
    const merged = deepMerge(DEFAULT_CONFIG, userConfig);
    return normalizeConfig(merged);
  } catch (error) {
    if (error.code === 'ENOENT') {
      log('info', 'No custom config found, using defaults');
      return normalizeConfig(DEFAULT_CONFIG);
    }
    log('warn', 'Error loading config, using defaults', { error: error.message });
    return normalizeConfig(DEFAULT_CONFIG);
  }
}

/**
 * Deep merge two objects
 */
function deepMerge(target, source) {
  const result = { ...target };
  for (const key in source) {
    if (source[key] instanceof Object && key in target) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Ensure a value is an array (YAML sometimes parses arrays as objects)
 */
function ensureArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return Object.values(value);
}

/**
 * Normalize config to ensure all array fields are actually arrays
 */
function normalizeConfig(config) {
  return {
    ...config,
    languages: ensureArray(config.languages),
    ignorePatterns: ensureArray(config.ignorePatterns),
    inlineIgnore: config.inlineIgnore ? {
      ...config.inlineIgnore,
      patterns: ensureArray(config.inlineIgnore.patterns)
    } : config.inlineIgnore
  };
}

/**
 * Check if a file should be ignored based on patterns
 */
function shouldIgnoreFile(filename, ignorePatterns) {
  const patterns = ignorePatterns || [];
  return patterns.some(pattern => {
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regexPattern}$`).test(filename);
  });
}

/**
 * Detect the programming language from file extension
 */
function detectLanguage(filename) {
  const ext = path.extname(filename).toLowerCase();
  const languageMap = {
    '.cs': 'csharp',
    '.csx': 'csharp',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.pyw': 'python',
    '.pyi': 'python'
  };
  return languageMap[ext] || 'unknown';
}

// ============================================================================
// Feature: Review Caching
// ============================================================================

/**
 * Check if the current commit has already been reviewed
 */
async function isCommitAlreadyReviewed(config) {
  if (!config.caching?.enabled) {
    return false;
  }

  try {
    const cachePath = path.join(process.cwd(), '.ai-review-cache', 'reviewed-commits.txt');
    const cacheContent = await fs.readFile(cachePath, 'utf-8');
    const reviewedCommits = cacheContent.split('\n').filter(c => c.trim());

    if (reviewedCommits.includes(context.headSha)) {
      log('info', 'Commit already reviewed, skipping', { sha: context.headSha });
      metrics.cachedSkipped = true;
      return true;
    }
  } catch (error) {
    // Cache file doesn't exist yet, that's fine
  }

  return false;
}

/**
 * Get the last reviewed commit SHA
 */
async function getLastReviewedCommit() {
  try {
    const cachePath = path.join(process.cwd(), '.ai-review-cache', 'reviewed-commits.txt');
    const cacheContent = await fs.readFile(cachePath, 'utf-8');
    const reviewedCommits = cacheContent.split('\n').filter(c => c.trim());
    return reviewedCommits[reviewedCommits.length - 1] || null;
  } catch (error) {
    return null;
  }
}

// ============================================================================
// Feature: Incremental Reviews
// ============================================================================

/**
 * Get incremental diff (only changes since last review)
 */
async function getIncrementalDiff(config, lastReviewedCommit) {
  if (!config.incrementalReview?.enabled || !lastReviewedCommit) {
    return null;
  }

  try {
    // Get diff between last reviewed commit and current head
    const { execSync } = await import('child_process');
    const diff = execSync(
      `git diff ${lastReviewedCommit}..${context.headSha}`,
      { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
    );

    if (diff.trim()) {
      log('info', 'Using incremental diff', {
        from: lastReviewedCommit.substring(0, 7),
        to: context.headSha.substring(0, 7)
      });
      metrics.incrementalReview = true;
      return diff;
    }
  } catch (error) {
    log('warn', 'Failed to get incremental diff, using full diff', { error: error.message });
  }

  return null;
}

// ============================================================================
// Feature: Custom Review Instructions
// ============================================================================

/**
 * Extract custom review instructions from PR description
 */
function extractCustomInstructions(config) {
  if (!config.customInstructions?.enabled) {
    return null;
  }

  const prBody = context.prBody || '';

  // Look for <!-- ai-review: instructions here -->
  const match = prBody.match(/<!--\s*ai-review:\s*(.*?)\s*-->/is);
  if (match) {
    const instructions = match[1].trim();
    log('info', 'Found custom review instructions', { instructions });
    return instructions;
  }

  return null;
}

// ============================================================================
// Feature: File-Level Ignores
// ============================================================================

/**
 * Filter out lines/files with ignore comments
 */
function filterIgnoredContent(diff, config) {
  if (!config.inlineIgnore?.enabled) {
    return { diff, ignoredLines: [] };
  }

  const patterns = config.inlineIgnore.patterns || [];
  const lines = diff.split('\n');
  const filteredLines = [];
  const ignoredLines = [];
  let ignoreNextLine = false;
  let ignoreFile = false;
  let currentFile = null;

  for (const line of lines) {
    // Track current file
    if (line.startsWith('diff --git')) {
      const match = line.match(/diff --git a\/(.*) b\/(.*)/);
      currentFile = match ? match[2] : null;
      ignoreFile = false;
    }

    // Check for ignore patterns
    const hasIgnore = patterns.some(p => line.includes(p));

    if (hasIgnore) {
      if (line.includes('ai-review-ignore-file')) {
        ignoreFile = true;
        ignoredLines.push({ file: currentFile, type: 'file' });
        continue;
      }
      if (line.includes('ai-review-ignore-next-line')) {
        ignoreNextLine = true;
        continue;
      }
      if (line.includes('ai-review-ignore')) {
        ignoredLines.push({ file: currentFile, line: line, type: 'line' });
        continue;
      }
    }

    if (ignoreFile) {
      continue;
    }

    if (ignoreNextLine && line.startsWith('+')) {
      ignoreNextLine = false;
      ignoredLines.push({ file: currentFile, line: line, type: 'next-line' });
      continue;
    }

    filteredLines.push(line);
  }

  return {
    diff: filteredLines.join('\n'),
    ignoredLines
  };
}

// ============================================================================
// Feature: PR Size Warning
// ============================================================================

/**
 * Check PR size and generate warning if too large
 */
function checkPRSize(parsedFiles, config) {
  if (!config.prSizeWarning?.enabled) {
    return null;
  }

  const totalLines = parsedFiles.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  const totalFiles = parsedFiles.length;

  const warnings = [];

  if (totalLines > config.prSizeWarning.maxLines) {
    warnings.push(`This PR has **${totalLines} changed lines**, which exceeds the recommended maximum of ${config.prSizeWarning.maxLines} lines.`);
  }

  if (totalFiles > config.prSizeWarning.maxFiles) {
    warnings.push(`This PR modifies **${totalFiles} files**, which exceeds the recommended maximum of ${config.prSizeWarning.maxFiles} files.`);
  }

  if (warnings.length > 0) {
    return {
      warning: true,
      message: `### ⚠️ PR Size Warning\n\n${warnings.join('\n\n')}\n\n**Recommendation**: Consider splitting this PR into smaller, focused changes for easier review and safer merging.`
    };
  }

  return null;
}

// ============================================================================
// Feature: Comment Threading
// ============================================================================

/**
 * Get existing AI review comments on the PR
 */
async function getExistingAIComments() {
  try {
    const commentsJson = await fs.readFile('pr_comments.json', 'utf-8');
    const comments = JSON.parse(commentsJson);

    // Filter for our AI review comments
    return comments.filter(c =>
      c.body?.includes(AI_REVIEW_MARKER) ||
      c.body?.includes('🤖') ||
      c.body?.includes('AI Code Review')
    );
  } catch (error) {
    log('warn', 'Could not load existing comments', { error: error.message });
    return [];
  }
}

/**
 * Get existing AI reviews on the PR
 */
async function getExistingAIReviews() {
  try {
    const reviewsJson = await fs.readFile('pr_reviews.json', 'utf-8');
    const reviews = JSON.parse(reviewsJson);

    // Filter for our AI reviews
    return reviews.filter(r =>
      r.body?.includes(AI_REVIEW_MARKER) ||
      r.body?.includes('🤖 AI Code Review')
    );
  } catch (error) {
    log('warn', 'Could not load existing reviews', { error: error.message });
    return [];
  }
}

/**
 * Find if there's an existing comment for the same file/line
 */
function findExistingComment(existingComments, file, line) {
  return existingComments.find(c =>
    c.path === file &&
    c.line === line
  );
}

// ============================================================================
// Feature: Dismiss Stale Reviews
// ============================================================================

/**
 * Check if previous critical issues have been fixed
 */
async function checkAndDismissStaleReviews(config, newReviews) {
  const existingReviews = await getExistingAIReviews();

  // Find our previous REQUEST_CHANGES reviews
  const previousRequestChanges = existingReviews.filter(r =>
    r.state === 'CHANGES_REQUESTED'
  );

  if (previousRequestChanges.length === 0) {
    return;
  }

  // Count current critical issues
  const currentCriticalCount = newReviews.reduce((sum, r) => {
    return sum + (r.inlineComments || []).filter(c => c.severity === 'critical').length;
  }, 0);

  // If no more critical issues, we could dismiss (but GitHub API doesn't allow bots to dismiss)
  // Instead, we'll note it in the new review
  if (currentCriticalCount === 0) {
    log('info', 'Previous critical issues appear to be resolved');
    return { resolved: true, previousCount: previousRequestChanges.length };
  }

  return { resolved: false };
}

// ============================================================================
// Feature: Review Feedback Loop
// ============================================================================

/**
 * Get feedback (reactions) on previous AI review comments
 */
async function getReviewFeedback(config) {
  if (!config.feedbackLoop?.enabled) {
    return null;
  }

  try {
    // Get all reactions on our review comments
    const existingComments = await getExistingAIComments();
    const existingReviews = await getExistingAIReviews();

    const feedback = {
      positive: 0,    // 👍, ❤️, 🚀, 👏
      negative: 0,    // 👎, 😕
      total: 0,
      byComment: []
    };

    // Check reactions on inline comments
    for (const comment of existingComments) {
      try {
        const reactions = await octokit.reactions.listForPullRequestReviewComment({
          owner: context.owner,
          repo: context.repo,
          comment_id: comment.id
        });

        const positive = reactions.data.filter(r =>
          ['+1', 'heart', 'rocket', 'hooray'].includes(r.content)
        ).length;
        const negative = reactions.data.filter(r =>
          ['-1', 'confused'].includes(r.content)
        ).length;

        feedback.positive += positive;
        feedback.negative += negative;
        feedback.total += positive + negative;

        if (positive > 0 || negative > 0) {
          feedback.byComment.push({
            id: comment.id,
            file: comment.path,
            line: comment.line,
            positive,
            negative
          });
        }
      } catch (error) {
        // Ignore individual comment errors
      }
    }

    // Check reactions on review body comments
    for (const review of existingReviews) {
      if (review.id) {
        try {
          // Get the review comments which may have reactions
          const reviewComments = await octokit.pulls.listCommentsForReview({
            owner: context.owner,
            repo: context.repo,
            pull_number: context.prNumber,
            review_id: review.id
          });

          for (const rc of reviewComments.data) {
            const reactions = await octokit.reactions.listForPullRequestReviewComment({
              owner: context.owner,
              repo: context.repo,
              comment_id: rc.id
            });

            const positive = reactions.data.filter(r =>
              ['+1', 'heart', 'rocket', 'hooray'].includes(r.content)
            ).length;
            const negative = reactions.data.filter(r =>
              ['-1', 'confused'].includes(r.content)
            ).length;

            feedback.positive += positive;
            feedback.negative += negative;
            feedback.total += positive + negative;
          }
        } catch (error) {
          // Ignore individual review errors
        }
      }
    }

    log('info', 'Collected feedback on previous reviews', feedback);
    return feedback;
  } catch (error) {
    log('warn', 'Failed to collect feedback', { error: error.message });
    return null;
  }
}

/**
 * Write feedback summary to GitHub Actions Summary
 */
async function writeFeedbackSummary(feedback, config) {
  if (!config.feedbackLoop?.enabled || !feedback || feedback.total === 0) {
    return;
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }

  const feedbackRatio = feedback.total > 0
    ? ((feedback.positive / feedback.total) * 100).toFixed(1)
    : 'N/A';

  let summary = `
## 📊 AI Review Feedback

| Metric | Value |
|--------|-------|
| 👍 Positive reactions | ${feedback.positive} |
| 👎 Negative reactions | ${feedback.negative} |
| Approval rate | ${feedbackRatio}% |

`;

  if (feedback.byComment.length > 0) {
    summary += `### Feedback by Comment\n\n`;
    summary += `| File | Line | 👍 | 👎 |\n`;
    summary += `|------|------|----|----|
`;
    for (const c of feedback.byComment.slice(0, 10)) {
      summary += `| ${c.file} | ${c.line} | ${c.positive} | ${c.negative} |\n`;
    }
  }

  try {
    await fs.appendFile(summaryPath, summary);
    log('info', 'Wrote feedback summary to GitHub Actions Summary');
  } catch (error) {
    log('warn', 'Failed to write feedback summary', { error: error.message });
  }
}

// ============================================================================
// Feature: Contextual Awareness
// ============================================================================

/**
 * Extract import statements from file content
 */
function extractImports(content, language) {
  const imports = [];

  if (language === 'typescript' || language === 'javascript') {
    // Match: import ... from '...'
    const importMatches = content.matchAll(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g);
    for (const match of importMatches) {
      imports.push(match[1]);
    }
    // Match: require('...')
    const requireMatches = content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    for (const match of requireMatches) {
      imports.push(match[1]);
    }
  } else if (language === 'python') {
    // Match: from X import Y or import X
    const fromMatches = content.matchAll(/from\s+([^\s]+)\s+import/g);
    for (const match of fromMatches) {
      imports.push(match[1]);
    }
    const importMatches = content.matchAll(/^import\s+([^\s,]+)/gm);
    for (const match of importMatches) {
      imports.push(match[1]);
    }
  } else if (language === 'csharp') {
    // Match: using X;
    const usingMatches = content.matchAll(/using\s+([^;]+);/g);
    for (const match of usingMatches) {
      imports.push(match[1]);
    }
  }

  return imports;
}

/**
 * Resolve import path to actual file path
 */
function resolveImportPath(importPath, currentFile, language) {
  // Skip node_modules and external packages
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    return null;
  }

  const currentDir = path.dirname(currentFile);
  let resolvedPath = path.resolve(currentDir, importPath);

  // Add common extensions if not present
  const extensions = {
    typescript: ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'],
    javascript: ['.js', '.jsx', '.ts', '.tsx', '/index.js', '/index.jsx'],
    python: ['.py', '/__init__.py'],
    csharp: ['.cs']
  };

  const exts = extensions[language] || [];
  if (!path.extname(resolvedPath)) {
    for (const ext of exts) {
      const withExt = resolvedPath + ext;
      // Return the path with extension (we'll check if it exists later)
      return withExt;
    }
  }

  return resolvedPath;
}

/**
 * Get related files for context
 */
async function getRelatedFiles(parsedFiles, config) {
  if (!config.contextualAwareness?.enabled) {
    return { files: [], content: '' };
  }

  const relatedFiles = new Map();
  const maxFiles = config.contextualAwareness.maxRelatedFiles || 5;

  for (const file of parsedFiles) {
    const language = detectLanguage(file.newPath);
    if (language === 'unknown') continue;

    // Try to read the full file content
    try {
      const fullPath = path.join(process.cwd(), file.newPath);
      const content = await fs.readFile(fullPath, 'utf-8');

      if (config.contextualAwareness.includeImports) {
        const imports = extractImports(content, language);

        for (const importPath of imports) {
          if (relatedFiles.size >= maxFiles) break;

          const resolvedPath = resolveImportPath(importPath, file.newPath, language);
          if (!resolvedPath || relatedFiles.has(resolvedPath)) continue;

          // Check if file exists and read it
          try {
            const importedContent = await fs.readFile(resolvedPath, 'utf-8');
            relatedFiles.set(resolvedPath, {
              path: resolvedPath,
              content: importedContent,
              reason: `imported by ${file.newPath}`
            });
            metrics.relatedFilesRead++;
          } catch (e) {
            // File doesn't exist, skip
          }
        }
      }

      if (config.contextualAwareness.includeTests) {
        // Look for test files
        const testPatterns = [
          file.newPath.replace(/\.([^.]+)$/, '.test.$1'),
          file.newPath.replace(/\.([^.]+)$/, '.spec.$1'),
          file.newPath.replace(/src\//, 'test/').replace(/\.([^.]+)$/, '.test.$1')
        ];

        for (const testPath of testPatterns) {
          if (relatedFiles.size >= maxFiles) break;
          try {
            const testContent = await fs.readFile(path.join(process.cwd(), testPath), 'utf-8');
            relatedFiles.set(testPath, {
              path: testPath,
              content: testContent,
              reason: `test file for ${file.newPath}`
            });
            metrics.relatedFilesRead++;
          } catch (e) {
            // Test file doesn't exist
          }
        }
      }
    } catch (error) {
      // Could not read file
    }
  }

  // Format related files for context
  let contextContent = '';
  if (relatedFiles.size > 0) {
    contextContent = '\n## Related Files for Context\n';
    for (const [filePath, info] of relatedFiles) {
      // Truncate content if too long
      const truncatedContent = info.content.length > 2000
        ? info.content.substring(0, 2000) + '\n... (truncated)'
        : info.content;
      contextContent += `\n### ${filePath}\n*Reason: ${info.reason}*\n\`\`\`\n${truncatedContent}\n\`\`\`\n`;
    }
  }

  log('info', `Read ${relatedFiles.size} related files for context`);
  return { files: Array.from(relatedFiles.values()), content: contextContent };
}

// ============================================================================
// Feature: Auto-fix PRs
// ============================================================================

/**
 * Collect all suggested fixes from reviews
 */
function collectSuggestedFixes(reviews, parsedFiles) {
  const fixes = [];

  for (const review of reviews) {
    for (const comment of review.inlineComments || []) {
      if (comment.suggestedCode) {
        fixes.push({
          file: comment.file,
          line: comment.line,
          severity: comment.severity,
          original: null, // Will be filled from file
          suggested: comment.suggestedCode,
          comment: comment.comment
        });
        metrics.suggestedFixesCount++;
      }
    }
  }

  return fixes;
}

/**
 * Apply fixes to file content
 */
function applyFixesToContent(content, fixes) {
  const lines = content.split('\n');

  // Sort fixes by line number descending to apply from bottom up
  const sortedFixes = [...fixes].sort((a, b) => b.line - a.line);

  for (const fix of sortedFixes) {
    if (fix.line > 0 && fix.line <= lines.length) {
      lines[fix.line - 1] = fix.suggested;
    }
  }

  return lines.join('\n');
}

/**
 * Create a separate PR with auto-fixes
 */
async function createAutoFixPR(config, fixes, reviews) {
  if (!config.autoFix?.enabled || fixes.length === 0) {
    return null;
  }

  // Group fixes by file
  const fixesByFile = new Map();
  for (const fix of fixes) {
    if (!fixesByFile.has(fix.file)) {
      fixesByFile.set(fix.file, []);
    }
    fixesByFile.get(fix.file).push(fix);
  }

  const branchPrefix = config.autoFix.branchPrefix || 'ai-fix/';
  const fixBranch = `${branchPrefix}pr-${context.prNumber}-${Date.now()}`;

  try {
    // Create new branch from current head
    const { execSync } = await import('child_process');

    // Stash any current changes
    execSync('git stash', { encoding: 'utf-8', stdio: 'pipe' });

    // Create and checkout new branch
    execSync(`git checkout -b ${fixBranch}`, { encoding: 'utf-8', stdio: 'pipe' });

    // Apply fixes to each file
    for (const [filePath, fileFixes] of fixesByFile) {
      try {
        const fullPath = path.join(process.cwd(), filePath);
        const content = await fs.readFile(fullPath, 'utf-8');
        const fixedContent = applyFixesToContent(content, fileFixes);
        await fs.writeFile(fullPath, fixedContent, 'utf-8');
      } catch (error) {
        log('warn', `Failed to apply fixes to ${filePath}`, { error: error.message });
      }
    }

    // Commit changes
    execSync('git add -A', { encoding: 'utf-8', stdio: 'pipe' });
    execSync(
      `git commit -m "fix: Auto-fix AI review suggestions for PR #${context.prNumber}"`,
      { encoding: 'utf-8', stdio: 'pipe' }
    );

    // Push branch
    execSync(`git push origin ${fixBranch}`, { encoding: 'utf-8', stdio: 'pipe' });

    // Create PR
    const prBody = `## 🤖 Auto-fix PR

This PR contains automatic fixes suggested by the AI code review for PR #${context.prNumber}.

### Fixes Applied
${fixes.map(f => `- **${f.file}:${f.line}** - ${f.comment.substring(0, 100)}...`).join('\n')}

### Review
Please review these changes carefully before merging.

---
*Generated automatically by AI PR Review*`;

    // Get the PR's head branch name to base our fix PR on
    const prInfo = await octokit.pulls.get({
      owner: context.owner,
      repo: context.repo,
      pull_number: context.prNumber
    });
    const baseBranch = prInfo.data.head.ref;

    const newPR = await octokit.pulls.create({
      owner: context.owner,
      repo: context.repo,
      title: `fix: AI review fixes for PR #${context.prNumber}`,
      body: prBody,
      head: fixBranch,
      base: baseBranch // Base on the original PR's head branch
    });

    // Checkout back to original branch
    execSync(`git checkout -`, { encoding: 'utf-8', stdio: 'pipe' });
    execSync('git stash pop || true', { encoding: 'utf-8', stdio: 'pipe' });

    metrics.autoFixPRCreated = true;
    log('info', 'Created auto-fix PR', { prNumber: newPR.data.number, branch: fixBranch });

    return {
      prNumber: newPR.data.number,
      prUrl: newPR.data.html_url,
      branch: fixBranch,
      fixCount: fixes.length
    };
  } catch (error) {
    log('error', 'Failed to create auto-fix PR', { error: error.message });

    // Try to restore original state
    try {
      const { execSync } = await import('child_process');
      execSync(`git checkout -`, { encoding: 'utf-8', stdio: 'pipe' });
      execSync('git stash pop || true', { encoding: 'utf-8', stdio: 'pipe' });
    } catch (e) {
      // Ignore cleanup errors
    }

    return null;
  }
}

// ============================================================================
// Feature: Severity Threshold
// ============================================================================

const SEVERITY_LEVELS = ['nitpick', 'suggestion', 'warning', 'critical'];

/**
 * Get severity level as number for comparison
 */
function getSeverityLevel(severity) {
  return SEVERITY_LEVELS.indexOf(severity);
}

/**
 * Filter comments based on severity threshold
 */
function filterBySeverityThreshold(reviews, config) {
  if (!config.severityThreshold?.enabled) {
    return { reviews, filtered: false };
  }

  const minLevel = getSeverityLevel(config.severityThreshold.minSeverityToComment || 'warning');

  const filteredReviews = reviews.map(review => ({
    ...review,
    inlineComments: (review.inlineComments || []).filter(
      comment => getSeverityLevel(comment.severity) >= minLevel
    )
  }));

  // Count remaining comments
  const totalRemaining = filteredReviews.reduce(
    (sum, r) => sum + (r.inlineComments?.length || 0),
    0
  );

  const originalTotal = reviews.reduce(
    (sum, r) => sum + (r.inlineComments?.length || 0),
    0
  );

  log('info', `Severity threshold filter: ${originalTotal} -> ${totalRemaining} comments`);

  return {
    reviews: filteredReviews,
    filtered: totalRemaining < originalTotal,
    originalCount: originalTotal,
    filteredCount: totalRemaining
  };
}

/**
 * Check if PR should be skipped due to being "clean"
 */
function shouldSkipCleanPR(reviews, config) {
  if (!config.severityThreshold?.enabled || !config.severityThreshold?.skipCleanPRs) {
    return false;
  }

  const minLevel = getSeverityLevel(config.severityThreshold.minSeverityToComment || 'warning');

  const hasSignificantIssues = reviews.some(review =>
    (review.inlineComments || []).some(
      comment => getSeverityLevel(comment.severity) >= minLevel
    )
  );

  if (!hasSignificantIssues) {
    metrics.skippedDueToThreshold = true;
    log('info', 'PR is clean, skipping review comment');
    return true;
  }

  return false;
}

// ============================================================================
// GitHub API Functions
// ============================================================================

async function getPRDiff() {
  try {
    const diffContent = await fs.readFile('pr_diff.txt', 'utf-8');
    return diffContent;
  } catch (error) {
    log('error', 'Failed to read diff file', { error: error.message });
    throw error;
  }
}

async function getChangedFiles() {
  try {
    const filesContent = await fs.readFile('changed_files.txt', 'utf-8');
    return filesContent.split('\n').filter(f => f.trim());
  } catch (error) {
    log('error', 'Failed to read changed files', { error: error.message });
    throw error;
  }
}

/**
 * Post a review comment on the PR
 */
async function postReviewComment(body, comments = [], event = 'COMMENT') {
  try {
    // Add our marker to the body for identification
    const markedBody = `${AI_REVIEW_MARKER}\n${body}`;

    // GitHub Actions cannot APPROVE PRs by default (security restriction)
    // Convert APPROVE to COMMENT to avoid 422 errors
    let safeEvent = event;
    if (event === 'APPROVE') {
      log('info', 'Converting APPROVE to COMMENT (GitHub Actions cannot approve PRs)');
      safeEvent = 'COMMENT';
    }

    await withRetry(
      () => octokit.pulls.createReview({
        owner: context.owner,
        repo: context.repo,
        pull_number: context.prNumber,
        commit_id: context.headSha,
        body: markedBody,
        event: safeEvent,
        comments: comments
      }),
      'postReviewComment'
    );

    metrics.commentsPosted = comments.length;
    log('info', `Posted review with ${comments.length} inline comments`, { event: safeEvent });
  } catch (error) {
    log('error', 'Failed to post review', { error: error.message });
    throw error;
  }
}

// ============================================================================
// Diff Parsing
// ============================================================================

function parseDiff(diffContent) {
  const files = [];
  const lines = diffContent.split('\n');

  let currentFile = null;
  let currentHunk = null;
  let lineInHunk = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('diff --git')) {
      if (currentFile) {
        files.push(currentFile);
      }

      const match = line.match(/diff --git a\/(.*) b\/(.*)/);
      if (match) {
        currentFile = {
          oldPath: match[1],
          newPath: match[2],
          hunks: [],
          additions: 0,
          deletions: 0
        };
      }
      currentHunk = null;
      continue;
    }

    if (line.startsWith('index ') ||
        line.startsWith('old mode') ||
        line.startsWith('new mode') ||
        line.startsWith('new file') ||
        line.startsWith('deleted file') ||
        line.startsWith('---') ||
        line.startsWith('+++')) {
      continue;
    }

    if (line.startsWith('@@')) {
      const hunkMatch = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@(.*)?/);
      if (hunkMatch && currentFile) {
        currentHunk = {
          oldStart: parseInt(hunkMatch[1], 10),
          oldLines: parseInt(hunkMatch[2] || '1', 10),
          newStart: parseInt(hunkMatch[3], 10),
          newLines: parseInt(hunkMatch[4] || '1', 10),
          header: hunkMatch[5]?.trim() || '',
          changes: []
        };
        currentFile.hunks.push(currentHunk);
        lineInHunk = 0;
      }
      continue;
    }

    if (currentHunk && currentFile) {
      if (line.startsWith('+')) {
        currentHunk.changes.push({
          type: 'add',
          content: line.substring(1),
          newLine: currentHunk.newStart + lineInHunk
        });
        currentFile.additions++;
        lineInHunk++;
      } else if (line.startsWith('-')) {
        currentHunk.changes.push({
          type: 'delete',
          content: line.substring(1),
          oldLine: currentHunk.oldStart + lineInHunk
        });
        currentFile.deletions++;
      } else if (line.startsWith(' ')) {
        currentHunk.changes.push({
          type: 'context',
          content: line.substring(1),
          newLine: currentHunk.newStart + lineInHunk
        });
        lineInHunk++;
      }
    }
  }

  if (currentFile) {
    files.push(currentFile);
  }

  return files;
}

function calculateDiffPosition(file, targetLine) {
  let position = 0;

  for (const hunk of file.hunks) {
    position++; // Count the @@ hunk header

    for (const change of hunk.changes) {
      position++;
      // Allow commenting on added lines or context lines that match the target
      if ((change.type === 'add' || change.type === 'context') && change.newLine === targetLine) {
        return position;
      }
    }
  }

  // If exact line not found, try to find the closest added line in the same hunk
  // This helps when Claude references a line that's near but not exactly in the diff
  position = 0;
  let closestPosition = null;
  let closestDistance = Infinity;

  for (const hunk of file.hunks) {
    position++;

    for (const change of hunk.changes) {
      position++;
      if (change.type === 'add' && change.newLine) {
        const distance = Math.abs(change.newLine - targetLine);
        if (distance < closestDistance && distance <= 5) { // Within 5 lines
          closestDistance = distance;
          closestPosition = position;
        }
      }
    }
  }

  return closestPosition;
}

// ============================================================================
// Claude API Integration
// ============================================================================

function buildSystemPrompt(config, customInstructions) {
  const areas = [];

  if (config.reviewAreas.codeQuality) {
    areas.push('- **Code Quality**: Clean code principles, readability, maintainability, DRY, SOLID');
  }
  if (config.reviewAreas.security) {
    areas.push('- **Security**: Vulnerabilities, injection risks, authentication issues, data exposure');
  }
  if (config.reviewAreas.documentation) {
    areas.push('- **Documentation**: Code comments, function documentation, clarity');
  }
  if (config.reviewAreas.testCoverage) {
    areas.push('- **Testing**: Test coverage gaps, edge cases, test quality');
  }
  if (config.reviewAreas.conventions) {
    areas.push('- **Conventions**: Language-specific best practices and style guidelines');
  }

  let prompt = `You are an expert code reviewer with deep knowledge of software engineering best practices.
Your task is to review Pull Request changes and provide constructive, actionable feedback.

## Review Focus Areas
${areas.join('\n')}

## Language Expertise
You have expertise in: ${config.languages.join(', ')}`;

  // Add custom instructions if provided
  if (customInstructions) {
    prompt += `

## Custom Instructions from PR Author
The PR author has requested specific focus:
${customInstructions}`;
  }

  prompt += `

## Response Format
You MUST respond with valid JSON in this exact format:
{
  "summary": {
    "overview": "Brief overall assessment of the PR",
    "strengths": ["List of things done well"],
    "concerns": ["List of main concerns"],
    "recommendation": "APPROVE | REQUEST_CHANGES | COMMENT"
  },
  "inlineComments": [
    {
      "file": "path/to/file.ts",
      "line": 42,
      "severity": "critical | warning | suggestion | nitpick",
      "category": "security | quality | documentation | testing | convention",
      "comment": "The specific issue and how to fix it",
      "suggestedCode": "optional - the exact replacement code for this line"
    }
  ]
}

## Code Suggestions
When you are CONFIDENT about a fix, include a "suggestedCode" field with the exact replacement code for the line.
- Only provide suggestedCode when you are certain it will work correctly
- The suggestedCode should replace the ENTIRE line at the specified line number
- Do NOT include suggestedCode if the fix requires changes across multiple lines or files
- Do NOT include suggestedCode if you're unsure about the exact fix
- Keep the same indentation as the original code

## Guidelines
1. Be constructive and specific - explain WHY something is an issue
2. Provide concrete suggestions for fixes when possible
3. Acknowledge good practices, not just problems
4. Focus on the most impactful issues first
5. Consider the context and purpose of the changes
6. Be respectful and professional in tone
7. For security issues, explain the potential risk

## Severity Levels
- **critical**: Security vulnerabilities, bugs that will cause failures, data loss risks
- **warning**: Potential bugs, performance issues, significant code quality problems
- **suggestion**: Improvements that would enhance maintainability or readability
- **nitpick**: Minor style issues, optional improvements`;

  return prompt;
}

function buildUserPrompt(prContext, files, diff, isIncremental, relatedFilesContent = '') {
  const filesSummary = files.map(f => {
    const lang = detectLanguage(f.newPath);
    return `- ${f.newPath} (${lang}): +${f.additions}/-${f.deletions}`;
  }).join('\n');

  let prompt = `## Pull Request Information
**Title**: ${prContext.prTitle}
**Author**: ${prContext.prAuthor}
**Description**:
${prContext.prBody || 'No description provided'}`;

  if (isIncremental) {
    prompt += `

⚠️ **Note**: This is an INCREMENTAL review of only the NEW changes since the last review.
Focus on the new code and whether it addresses any previous feedback.`;
  }

  prompt += `

## Changed Files Summary
${filesSummary}

## Diff Content
\`\`\`diff
${diff}
\`\`\``;

  // Add related files context if available
  if (relatedFilesContent) {
    prompt += `
${relatedFilesContent}`;
  }

  prompt += `

Please review the above changes and provide your feedback in the specified JSON format.`;

  return prompt;
}

async function reviewWithClaude(config, files, diff, customInstructions, isIncremental, relatedFilesContent = '') {
  const systemPrompt = buildSystemPrompt(config, customInstructions);
  const userPrompt = buildUserPrompt(context, files, diff, isIncremental, relatedFilesContent);

  log('info', 'Sending request to Claude API', {
    model: config.model,
    diffLength: diff.length,
    filesCount: files.length,
    isIncremental
  });

  try {
    metrics.apiCalls++;

    const response = await withRetry(
      () => anthropic.messages.create({
        model: config.model,
        max_tokens: config.maxTokens,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt
          }
        ]
      }),
      'claudeReview'
    );

    // Track token usage
    if (response.usage) {
      metrics.tokensUsed += response.usage.input_tokens + response.usage.output_tokens;
    }

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Claude response');
    }

    const review = JSON.parse(jsonMatch[0]);
    log('info', 'Received review from Claude', {
      recommendation: review.summary?.recommendation,
      inlineCommentsCount: review.inlineComments?.length || 0
    });

    return review;
  } catch (error) {
    log('error', 'Claude API error', { error: error.message });
    throw error;
  }
}

function chunkDiff(diff, files, maxSize) {
  if (diff.length <= maxSize) {
    return [{ diff, files }];
  }

  log('info', `Diff too large (${diff.length} chars), chunking...`);

  const chunks = [];
  let currentChunk = { diff: '', files: [] };

  const filePattern = /^diff --git/m;
  const fileDiffs = diff.split(filePattern).slice(1).map(d => 'diff --git' + d);

  for (let i = 0; i < fileDiffs.length; i++) {
    const fileDiff = fileDiffs[i];
    const file = files[i];

    if (currentChunk.diff.length + fileDiff.length > maxSize) {
      if (currentChunk.diff) {
        chunks.push(currentChunk);
      }
      currentChunk = { diff: '', files: [] };
    }

    currentChunk.diff += fileDiff;
    if (file) {
      currentChunk.files.push(file);
    }
  }

  if (currentChunk.diff) {
    chunks.push(currentChunk);
  }

  log('info', `Split into ${chunks.length} chunks`);
  return chunks;
}

// ============================================================================
// Review Formatting
// ============================================================================

function formatSummaryComment(reviews, config, extras = {}) {
  const allStrengths = [];
  const allConcerns = [];
  let claudeRecommendation = 'COMMENT';
  let overallOverview = '';

  for (const review of reviews) {
    if (review.summary) {
      if (review.summary.strengths) {
        allStrengths.push(...review.summary.strengths);
      }
      if (review.summary.concerns) {
        allConcerns.push(...review.summary.concerns);
      }
      if (review.summary.overview) {
        overallOverview = review.summary.overview;
      }
      if (review.summary.recommendation === 'REQUEST_CHANGES') {
        claudeRecommendation = 'REQUEST_CHANGES';
      } else if (review.summary.recommendation === 'APPROVE' && claudeRecommendation !== 'REQUEST_CHANGES') {
        claudeRecommendation = 'APPROVE';
      }
    }
  }

  const severityCounts = { critical: 0, warning: 0, suggestion: 0, nitpick: 0 };
  for (const review of reviews) {
    for (const comment of review.inlineComments || []) {
      if (severityCounts[comment.severity] !== undefined) {
        severityCounts[comment.severity]++;
      }
    }
  }

  // Update metrics
  metrics.criticalIssues = severityCounts.critical;
  metrics.warningIssues = severityCounts.warning;
  metrics.suggestionIssues = severityCounts.suggestion;

  let finalRecommendation = claudeRecommendation;
  if (severityCounts.critical > 0) {
    finalRecommendation = 'REQUEST_CHANGES';
  }

  const recommendationEmoji = {
    'APPROVE': '✅',
    'REQUEST_CHANGES': '🔴',
    'COMMENT': '💬'
  };

  let markdown = `## 🤖 AI Code Review Summary

${recommendationEmoji[finalRecommendation]} **Recommendation**: ${finalRecommendation.replace('_', ' ')}`;

  // Add incremental review note
  if (extras.isIncremental) {
    markdown += `

📝 *This is an incremental review of changes since the last review.*`;
  }

  // Add PR size warning
  if (extras.sizeWarning) {
    markdown += `

${extras.sizeWarning.message}`;
  }

  // Add resolved issues note
  if (extras.resolvedIssues?.resolved) {
    markdown += `

✅ **Previous critical issues appear to be resolved!**`;
  }

  markdown += `

### Overview
${overallOverview || 'Review completed.'}

### Findings
| Severity | Count |
|----------|-------|
| 🔴 Critical | ${severityCounts.critical} |
| 🟡 Warning | ${severityCounts.warning} |
| 🔵 Suggestion | ${severityCounts.suggestion} |
| ⚪ Nitpick | ${severityCounts.nitpick} |
`;

  if (allStrengths.length > 0) {
    markdown += `
### ✨ Strengths
${allStrengths.map(s => `- ${s}`).join('\n')}
`;
  }

  if (allConcerns.length > 0) {
    markdown += `
### ⚠️ Areas of Concern
${allConcerns.map(c => `- ${c}`).join('\n')}
`;
  }

  // Add metrics section if enabled
  if (config.metrics?.enabled && config.metrics?.showInComment) {
    const duration = ((Date.now() - metrics.startTime) / 1000).toFixed(1);
    markdown += `
### 📊 Review Metrics
| Metric | Value |
|--------|-------|
| Files reviewed | ${metrics.filesReviewed} |
| Lines analyzed | ${metrics.linesReviewed} |
| API calls | ${metrics.apiCalls} |
| Review time | ${duration}s |
`;
  }

  // Add auto-fix PR info if created
  if (extras.autoFixResult) {
    markdown += `
### 🔧 Auto-fix PR Created
An automatic fix PR has been created with ${extras.autoFixResult.fixCount} suggested fixes.
**PR**: [#${extras.autoFixResult.prNumber}](${extras.autoFixResult.prUrl})
`;
  }

  markdown += `
---
*This review was generated by Claude (${config.model}). Please use your judgment when evaluating the suggestions.*
*To skip AI review, add the \`skip-ai-review\` label or prefix your PR title with \`[no-review]\`.*`;

  return { markdown, event: finalRecommendation };
}

function prepareInlineComments(reviews, parsedFiles, config, existingComments = []) {
  const comments = [];
  const fileMap = new Map(parsedFiles.map(f => [f.newPath, f]));

  // Count total comments from Claude for logging
  const totalComments = reviews.reduce((sum, r) => sum + (r.inlineComments?.length || 0), 0);
  log('info', `Processing ${totalComments} inline comments from Claude`);

  let skippedSeverity = 0;
  let skippedFile = 0;
  let skippedPosition = 0;
  let skippedDuplicate = 0;

  for (const review of reviews) {
    for (const comment of review.inlineComments || []) {
      if (!config.severity[comment.severity]) {
        skippedSeverity++;
        log('debug', `Skipping comment due to severity filter: ${comment.severity}`);
        continue;
      }

      const file = fileMap.get(comment.file);
      if (!file) {
        skippedFile++;
        log('warn', `File not found in diff: ${comment.file}`);
        continue;
      }

      const position = calculateDiffPosition(file, comment.line);
      if (!position) {
        skippedPosition++;
        log('warn', `Could not find line ${comment.line} in diff for ${comment.file} (severity: ${comment.severity})`);
        continue;
      }

      // Check for existing comment at same location (threading)
      const existing = findExistingComment(existingComments, comment.file, comment.line);
      if (existing) {
        skippedDuplicate++;
        log('info', `Skipping duplicate comment at ${comment.file}:${comment.line}`);
        continue;
      }

      log('info', `Adding comment at ${comment.file}:${comment.line} (position ${position}, severity: ${comment.severity})`);

      const severityEmoji = {
        critical: '🔴',
        warning: '🟡',
        suggestion: '🔵',
        nitpick: '⚪'
      };

      const categoryEmoji = {
        security: '🔒',
        quality: '✨',
        documentation: '📝',
        testing: '🧪',
        convention: '📏'
      };

      let body = `${severityEmoji[comment.severity] || '💬'} ${categoryEmoji[comment.category] || ''} **${comment.severity?.toUpperCase() || 'INFO'}** (${comment.category || 'general'})

${comment.comment}`;

      if (comment.suggestedCode) {
        body += `

\`\`\`suggestion
${comment.suggestedCode}
\`\`\``;
      }

      comments.push({
        path: comment.file,
        position: position,
        body: body
      });
    }
  }

  // Log summary of what was skipped
  log('info', `Inline comments summary: ${comments.length} to post, skipped: ${skippedSeverity} (severity), ${skippedFile} (file not found), ${skippedPosition} (position not found), ${skippedDuplicate} (duplicate)`);

  return comments;
}

// ============================================================================
// Feature: Metrics/Analytics
// ============================================================================

/**
 * Write metrics to GitHub Actions summary
 */
async function writeMetricsSummary(config) {
  if (!config.metrics?.enabled || !config.metrics?.showInSummary) {
    return;
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    log('warn', 'GITHUB_STEP_SUMMARY not available');
    return;
  }

  const duration = ((Date.now() - metrics.startTime) / 1000).toFixed(1);

  const summary = `## 📊 AI PR Review Metrics

| Metric | Value |
|--------|-------|
| PR Number | #${context.prNumber} |
| Files Reviewed | ${metrics.filesReviewed} |
| Lines Analyzed | ${metrics.linesReviewed} |
| Comments Posted | ${metrics.commentsPosted} |
| Critical Issues | ${metrics.criticalIssues} |
| Warnings | ${metrics.warningIssues} |
| Suggestions | ${metrics.suggestionIssues} |
| API Calls | ${metrics.apiCalls} |
| Tokens Used | ${metrics.tokensUsed} |
| Review Duration | ${duration}s |
| Incremental Review | ${metrics.incrementalReview ? 'Yes' : 'No'} |
| Cache Hit | ${metrics.cachedSkipped ? 'Yes (skipped)' : 'No'} |
| Related Files Read | ${metrics.relatedFilesRead} |
| Suggested Fixes | ${metrics.suggestedFixesCount} |
| Auto-fix PR Created | ${metrics.autoFixPRCreated ? 'Yes' : 'No'} |
| Skipped (Clean PR) | ${metrics.skippedDueToThreshold ? 'Yes' : 'No'} |
`;

  try {
    await fs.appendFile(summaryPath, summary);
    log('info', 'Wrote metrics to GitHub Actions summary');
  } catch (error) {
    log('warn', 'Failed to write metrics summary', { error: error.message });
  }
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  log('info', 'Starting AI PR Review', {
    pr: context.prNumber,
    repo: `${context.owner}/${context.repo}`,
    event: context.eventName
  });

  try {
    const config = await loadConfig();

    if (!config.enabled) {
      log('info', 'AI review is disabled in configuration');
      return;
    }

    // Feature: Check cache
    if (await isCommitAlreadyReviewed(config)) {
      await writeMetricsSummary(config);
      return;
    }

    // Feature: Get last reviewed commit for incremental review
    const lastReviewedCommit = await getLastReviewedCommit();

    // Get diff (try incremental first)
    let rawDiff = await getIncrementalDiff(config, lastReviewedCommit);
    const isIncremental = rawDiff !== null;

    if (!rawDiff) {
      rawDiff = await getPRDiff();
    }

    const changedFiles = await getChangedFiles();

    log('info', `Processing ${changedFiles.length} changed files`, { isIncremental });

    // Feature: Filter ignored content
    const { diff: filteredDiffContent, ignoredLines } = filterIgnoredContent(rawDiff, config);
    if (ignoredLines.length > 0) {
      log('info', `Filtered ${ignoredLines.length} ignored lines/files`);
    }

    // Parse the diff
    const parsedFiles = parseDiff(filteredDiffContent);

    // Update metrics
    metrics.filesReviewed = parsedFiles.length;
    metrics.linesReviewed = parsedFiles.reduce((sum, f) => sum + f.additions + f.deletions, 0);

    // Feature: PR size warning
    const sizeWarning = checkPRSize(parsedFiles, config);

    // Filter out ignored files
    const filesToReview = parsedFiles.filter(f =>
      !shouldIgnoreFile(f.newPath, config.ignorePatterns)
    );

    if (filesToReview.length === 0) {
      log('info', 'No files to review after filtering');
      await postReviewComment(
        '## 🤖 AI Code Review\n\nNo reviewable files found in this PR (all files matched ignore patterns).',
        []
      );
      await writeMetricsSummary(config);
      return;
    }

    // Limit files if too many
    const limitedFiles = filesToReview.slice(0, config.maxFilesPerReview);
    if (filesToReview.length > config.maxFilesPerReview) {
      log('warn', `Too many files (${filesToReview.length}), limiting to ${config.maxFilesPerReview}`);
    }

    // Reconstruct diff for files to review
    const filteredDiff = limitedFiles.map(f => {
      const startPattern = new RegExp(`diff --git a/${f.oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} b/${f.newPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
      const nextFilePattern = /^diff --git/m;

      const startMatch = filteredDiffContent.match(startPattern);
      if (!startMatch) return '';

      const startIndex = startMatch.index;
      const afterStart = filteredDiffContent.substring(startIndex + startMatch[0].length);
      const nextMatch = afterStart.match(nextFilePattern);

      if (nextMatch) {
        return filteredDiffContent.substring(startIndex, startIndex + startMatch[0].length + nextMatch.index);
      }
      return filteredDiffContent.substring(startIndex);
    }).join('');

    // Feature: Get custom instructions
    const customInstructions = extractCustomInstructions(config);

    // Feature: Contextual Awareness - get related files
    const relatedFiles = await getRelatedFiles(limitedFiles, config);

    // Feature: Feedback Loop - collect feedback from previous reviews
    const previousFeedback = await getReviewFeedback(config);

    // Chunk if necessary and review
    const chunks = chunkDiff(filteredDiff, limitedFiles, config.chunkSize);
    const reviews = [];

    for (let i = 0; i < chunks.length; i++) {
      log('info', `Processing chunk ${i + 1}/${chunks.length}`);
      const review = await reviewWithClaude(
        config,
        chunks[i].files,
        chunks[i].diff,
        customInstructions,
        isIncremental,
        relatedFiles.content  // Pass contextual awareness
      );
      reviews.push(review);

      if (i < chunks.length - 1) {
        await sleep(2000);
      }
    }

    // Feature: Severity Threshold - check if we should skip clean PRs
    if (shouldSkipCleanPR(reviews, config)) {
      log('info', 'Skipping review - PR is clean (below severity threshold)');
      await writeMetricsSummary(config);
      await writeFeedbackSummary(previousFeedback, config);
      return;
    }

    // Feature: Severity Threshold - filter comments by severity
    const { reviews: filteredReviews } = filterBySeverityThreshold(reviews, config);

    // Feature: Check if previous issues were resolved
    const resolvedIssues = await checkAndDismissStaleReviews(config, filteredReviews);

    // Feature: Get existing comments for threading
    const existingComments = await getExistingAIComments();

    // Feature: Auto-fix PRs - collect and create fix PR
    let autoFixResult = null;
    if (config.autoFix?.enabled) {
      const suggestedFixes = collectSuggestedFixes(filteredReviews, parsedFiles);
      if (suggestedFixes.length > 0) {
        autoFixResult = await createAutoFixPR(config, suggestedFixes, filteredReviews);
      }
    }

    // Prepare and post the review
    const { markdown: summaryComment, event: reviewEvent } = formatSummaryComment(
      filteredReviews,
      config,
      { isIncremental, sizeWarning, resolvedIssues, autoFixResult }
    );
    const inlineComments = prepareInlineComments(filteredReviews, parsedFiles, config, existingComments);

    await postReviewComment(summaryComment, inlineComments, reviewEvent);

    // Feature: Write metrics summary
    await writeMetricsSummary(config);

    // Feature: Feedback Loop - write feedback summary
    await writeFeedbackSummary(previousFeedback, config);

    log('info', 'Review completed successfully', {
      inlineComments: inlineComments.length,
      reviewEvent,
      isIncremental,
      relatedFilesRead: metrics.relatedFilesRead,
      autoFixCreated: metrics.autoFixPRCreated
    });

  } catch (error) {
    log('error', 'Review failed', {
      error: error.message,
      stack: error.stack
    });

    // Still try to write metrics on failure
    try {
      await writeMetricsSummary(await loadConfig());
    } catch (e) {
      // Ignore metrics failure
    }

    process.exit(1);
  }
}

main();
