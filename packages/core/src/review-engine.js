/**
 * AI PR Review Engine
 *
 * Core review logic that is platform-agnostic.
 * Uses Claude (Anthropic) to perform comprehensive code reviews.
 *
 * This module handles:
 * - Claude API integration
 * - Review prompt building
 * - Comment formatting
 * - Metrics tracking
 * - Configuration management
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs/promises';
import yaml from 'js-yaml';
import path from 'path';

import {
  shouldIgnoreFile,
  detectLanguage,
  deepMerge,
  ensureArray,
  parseDiff,
  getSeverityLevel,
  SEVERITY_LEVELS,
  extractCustomInstructions,
  filterIgnoredContent,
  checkPRSize,
  extractImports,
  filterBySeverityThreshold,
  chunkDiff
} from './utils.js';

import { FeedbackStore } from './feedback-store.js';
import { FeedbackReporter } from './feedback-reporter.js';

// ============================================================================
// Configuration
// ============================================================================

export const DEFAULT_CONFIG = {
  enabled: true,
  model: 'claude-sonnet-4-5-20250929',
  maxTokens: 4096,
  temperature: 0,
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
  prSizeWarning: {
    enabled: true,
    maxLines: 1000,
    maxFiles: 30
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
  feedbackLoop: {
    enabled: true
  },
  feedbackTracking: {
    enabled: true,
    autoCommit: true,
    generateMetricsFile: true,
    historyPath: '.ai-review/feedback-history.json',
    metricsPath: '.ai-review/METRICS.md'
  },
  contextualAwareness: {
    enabled: true,
    maxRelatedFiles: 5,
    includeImports: true,
    includeTests: false,
    includeSimilarFiles: false
  },
  autoFix: {
    enabled: false,
    createSeparatePR: true,
    requireApproval: true,
    branchPrefix: 'ai-fix/'
  },
  severityThreshold: {
    enabled: false,
    minSeverityToComment: 'warning',
    skipCleanPRs: false
  }
};

// Rate limiting configuration
const RATE_LIMIT = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000
};

// ============================================================================
// Review Engine Class
// ============================================================================

export class ReviewEngine {
  /**
   * @param {Object} options
   * @param {import('./platform-adapter.js').PlatformAdapter} options.platformAdapter
   * @param {string} options.anthropicApiKey
   * @param {Object} [options.config] - Override default config
   */
  constructor({ platformAdapter, anthropicApiKey, config = null }) {
    if (!anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY is required');
    }

    this.platformAdapter = platformAdapter;
    this.anthropic = new Anthropic({ apiKey: anthropicApiKey });
    this.config = config;
    this.context = platformAdapter.getContext();

    // Feedback tracking (initialized lazily after config is loaded)
    this.feedbackStore = null;
    this.feedbackReporter = null;

    // Metrics tracking
    this.metrics = {
      startTime: Date.now(),
      filesReviewed: 0,
      linesReviewed: 0,
      commentsPosted: 0,
      criticalIssues: 0,
      warningIssues: 0,
      suggestionIssues: 0,
      cachedSkipped: false,
      apiCalls: 0,
      tokensUsed: 0,
      relatedFilesRead: 0,
      suggestedFixesCount: 0,
      autoFixPRCreated: false,
      skippedDueToThreshold: false
    };
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

    if (data) {
      console.log(logMessage, JSON.stringify(data, null, 2));
    } else {
      console.log(logMessage);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async withRetry(fn, operation) {
    let lastError;
    let delay = RATE_LIMIT.initialDelayMs;

    for (let attempt = 1; attempt <= RATE_LIMIT.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (error.status === 429 || error.message?.includes('rate')) {
          this.log('warn', `Rate limited on ${operation}, attempt ${attempt}/${RATE_LIMIT.maxRetries}`);
          await this.sleep(delay);
          delay = Math.min(delay * 2, RATE_LIMIT.maxDelayMs);
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  async loadConfig() {
    if (this.config) {
      return this.normalizeConfig(this.config);
    }

    const configPath = path.join(process.cwd(), '.github', 'ai-review.yml');

    try {
      const configContent = await fs.readFile(configPath, 'utf-8');
      const userConfig = yaml.load(configContent);
      this.log('info', 'Loaded custom configuration from .github/ai-review.yml');
      const merged = deepMerge(DEFAULT_CONFIG, userConfig);
      return this.normalizeConfig(merged);
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.log('info', 'No custom config found, using defaults');
        return this.normalizeConfig(DEFAULT_CONFIG);
      }
      this.log('warn', 'Error loading config, using defaults', { error: error.message });
      return this.normalizeConfig(DEFAULT_CONFIG);
    }
  }

  normalizeConfig(config) {
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

  // ============================================================================
  // Feature: Review Caching
  // ============================================================================

  async isCommitAlreadyReviewed(config) {
    if (!config.caching?.enabled) {
      return false;
    }

    try {
      const cachePath = path.join(process.cwd(), '.ai-review-cache', 'reviewed-commits.txt');
      const cacheContent = await fs.readFile(cachePath, 'utf-8');
      const reviewedCommits = cacheContent.split('\n').filter(c => c.trim());

      if (reviewedCommits.includes(this.context.headSha)) {
        this.log('info', 'Commit already reviewed, skipping', { sha: this.context.headSha });
        this.metrics.cachedSkipped = true;
        return true;
      }
    } catch (error) {
      // Cache file doesn't exist yet
    }

    return false;
  }

  // ============================================================================
  // Feature: Custom Review Instructions
  // ============================================================================

  getCustomInstructions(config) {
    if (!config.customInstructions?.enabled) {
      return null;
    }

    const instructions = extractCustomInstructions(this.context.prBody || '');
    if (instructions) {
      this.log('info', 'Found custom review instructions', { instructions });
    }
    return instructions;
  }

  // ============================================================================
  // Feature: File-Level Ignores
  // ============================================================================

  filterIgnoredContentWithConfig(diff, config) {
    if (!config.inlineIgnore?.enabled) {
      return { diff, ignoredLines: [] };
    }

    const patterns = config.inlineIgnore.patterns || [];
    return filterIgnoredContent(diff, patterns);
  }

  // ============================================================================
  // Feature: Comment Threading
  // ============================================================================

  async getExistingAIComments() {
    try {
      return await this.platformAdapter.getExistingComments();
    } catch (error) {
      this.log('warn', 'Could not load existing comments', { error: error.message });
      return [];
    }
  }

  async getExistingAIReviews() {
    try {
      return await this.platformAdapter.getExistingReviews();
    } catch (error) {
      this.log('warn', 'Could not load existing reviews', { error: error.message });
      return [];
    }
  }

  findExistingComment(existingComments, file, line) {
    return existingComments.find(c => c.path === file && c.line === line);
  }

  // ============================================================================
  // Feature: Dismiss Stale Reviews
  // ============================================================================

  async checkAndDismissStaleReviews(config, newReviews) {
    const existingReviews = await this.getExistingAIReviews();

    const previousRequestChanges = existingReviews.filter(r =>
      r.state === 'CHANGES_REQUESTED'
    );

    if (previousRequestChanges.length === 0) {
      return;
    }

    const currentCriticalCount = newReviews.reduce((sum, r) => {
      return sum + (r.inlineComments || []).filter(c => c.severity === 'critical').length;
    }, 0);

    if (currentCriticalCount === 0 && previousRequestChanges.length > 0) {
      this.log('info', 'No critical issues in current review (previous reviews had REQUEST_CHANGES)');
      return { resolved: true, previousCount: previousRequestChanges.length };
    }

    return { resolved: false };
  }

  // ============================================================================
  // Feature: Review Feedback Loop
  // ============================================================================

  /**
   * Extracts severity from a comment body based on emoji indicators
   * @param {string} body - Comment body text
   * @returns {string} Severity level (critical, warning, suggestion, nitpick, or unknown)
   * @private
   */
  _extractSeverityFromComment(body) {
    if (!body) return 'unknown';

    // Check for severity emojis at the start of the comment
    if (body.includes('🔴') || body.toLowerCase().includes('critical')) {
      return 'critical';
    }
    if (body.includes('🟡') || body.toLowerCase().includes('warning')) {
      return 'warning';
    }
    if (body.includes('🔵') || body.toLowerCase().includes('suggestion')) {
      return 'suggestion';
    }
    if (body.includes('⚪') || body.toLowerCase().includes('nitpick')) {
      return 'nitpick';
    }

    return 'unknown';
  }

  async getReviewFeedback(config) {
    if (!config.feedbackLoop?.enabled) {
      return null;
    }

    if (!this.platformAdapter?.getCapabilities().supportsReactions) {
      this.log('info', 'Platform does not support reactions, skipping feedback collection');
      return null;
    }

    try {
      const existingComments = await this.getExistingAIComments();
      const existingReviews = await this.getExistingAIReviews();

      const feedback = {
        positive: 0,
        negative: 0,
        total: 0,
        byComment: []
      };

      for (const comment of existingComments) {
        try {
          const reactions = await this.platformAdapter.getCommentReactions(comment.id);
          if (reactions) {
            feedback.positive += reactions.positive;
            feedback.negative += reactions.negative;
            feedback.total += reactions.positive + reactions.negative;

            if (reactions.positive > 0 || reactions.negative > 0) {
              // Extract severity from comment body based on emoji
              const severity = this._extractSeverityFromComment(comment.body);

              feedback.byComment.push({
                id: comment.id,
                file: comment.path,
                line: comment.line,
                positive: reactions.positive,
                negative: reactions.negative,
                severity,
                body: comment.body
              });
            }
          }
        } catch (error) {
          // Ignore individual comment errors
        }
      }

      for (const review of existingReviews) {
        if (review.id) {
          try {
            const reactions = await this.platformAdapter.getReviewReactions(review.id);
            if (reactions) {
              feedback.positive += reactions.positive;
              feedback.negative += reactions.negative;
              feedback.total += reactions.positive + reactions.negative;
            }
          } catch (error) {
            // Ignore individual review errors
          }
        }
      }

      this.log('info', 'Collected feedback on previous reviews', feedback);
      return feedback;
    } catch (error) {
      this.log('warn', 'Failed to collect feedback', { error: error.message });
      return null;
    }
  }

  async writeFeedbackSummary(feedback, config) {
    if (!config.feedbackLoop?.enabled || !feedback || feedback.total === 0) {
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
      await this.platformAdapter.writeMetricsSummary(summary);
      this.log('info', 'Wrote feedback summary');
    } catch (error) {
      this.log('warn', 'Failed to write feedback summary', { error: error.message });
    }
  }

  // ============================================================================
  // Feature: Feedback Tracking (Persistent History)
  // ============================================================================

  /**
   * Initializes feedback tracking components
   * @param {Object} config - Review configuration
   * @private
   */
  async initFeedbackTracking(config) {
    if (!config.feedbackTracking?.enabled) {
      return;
    }

    if (!this.platformAdapter?.getCapabilities().supportsReactions) {
      this.log('info', 'Platform does not support reactions, skipping feedback tracking');
      return;
    }

    try {
      const historyPath = config.feedbackTracking.historyPath || '.ai-review/feedback-history.json';
      const metricsPath = config.feedbackTracking.metricsPath || '.ai-review/METRICS.md';

      this.feedbackStore = new FeedbackStore(process.cwd(), historyPath);
      this.feedbackReporter = new FeedbackReporter(process.cwd(), metricsPath);

      const repository = `${this.context.owner}/${this.context.repo}`;
      await this.feedbackStore.loadHistory(repository);

      this.log('info', 'Initialized feedback tracking');
    } catch (error) {
      this.log('warn', 'Failed to initialize feedback tracking', { error: error.message });
      this.feedbackStore = null;
      this.feedbackReporter = null;
    }
  }

  /**
   * Captures feedback event from the current review
   * @param {Object} reviews - Review results from Claude
   * @param {Object} previousFeedback - Previous feedback data
   * @param {Object} config - Review configuration
   * @returns {Promise<void>}
   */
  async captureFeedbackEvent(reviews, previousFeedback, config) {
    if (!this.feedbackStore || !config.feedbackTracking?.enabled) {
      return;
    }

    try {
      // Calculate severity counts and categories from reviews
      const severityCounts = { critical: 0, warning: 0, suggestion: 0, nitpick: 0 };
      const categoryCounts = {
        security: 0,
        codeQuality: 0,
        documentation: 0,
        testCoverage: 0,
        conventions: 0
      };
      const topComments = [];

      // Build a map of comments with reactions from previousFeedback for quick lookup
      const feedbackByKey = new Map();
      if (previousFeedback?.byComment && Array.isArray(previousFeedback.byComment)) {
        for (const fb of previousFeedback.byComment) {
          const key = `${fb.file}:${fb.line}`;
          feedbackByKey.set(key, fb);
        }
      }

      for (const review of reviews) {
        for (const comment of review.inlineComments || []) {
          // Count by severity
          const severity = comment.severity || 'suggestion';
          if (severityCounts[severity] !== undefined) {
            severityCounts[severity]++;
          }

          // Count by category (review area)
          // Normalize category names (handle variations from Claude)
          const categoryMap = {
            'quality': 'codeQuality',
            'code-quality': 'codeQuality',
            'testing': 'testCoverage',
            'test': 'testCoverage',
            'tests': 'testCoverage',
            'convention': 'conventions',
            'style': 'conventions'
          };
          const rawCategory = comment.category || 'codeQuality';
          const category = categoryMap[rawCategory] || rawCategory;
          if (categoryCounts[category] !== undefined) {
            categoryCounts[category]++;
          }

          // Add to topComments with severity info
          // Check if this comment has reactions from previous feedback
          const key = `${comment.file}:${comment.line}`;
          const existingFeedback = feedbackByKey.get(key);

          topComments.push({
            file: comment.file,
            line: comment.line,
            severity: severity,
            category: category,
            comment: comment.comment || '',
            positive: existingFeedback?.positive || 0,
            negative: existingFeedback?.negative || 0
          });
        }
      }

      // Determine review event type
      let reviewEvent = 'COMMENT';
      for (const review of reviews) {
        if (review.summary?.recommendation === 'REQUEST_CHANGES' || severityCounts.critical > 0) {
          reviewEvent = 'REQUEST_CHANGES';
          break;
        } else if (review.summary?.recommendation === 'APPROVE') {
          reviewEvent = 'APPROVE';
        }
      }

      // Build the feedback event
      const feedbackEvent = {
        prNumber: this.context.prNumber,
        prTitle: this.context.prTitle || `PR #${this.context.prNumber}`,
        prAuthor: this.context.prAuthor || 'unknown',
        headSha: this.context.headSha || '',
        reviewEvent,
        platform: this.platformAdapter.getPlatformType(),
        summary: {
          filesReviewed: this.metrics.filesReviewed,
          linesReviewed: this.metrics.linesReviewed,
          commentsPosted: this.metrics.commentsPosted
        },
        findings: severityCounts,
        commentsByCategory: categoryCounts,
        feedback: previousFeedback ? {
          positive: previousFeedback.positive,
          negative: previousFeedback.negative,
          total: previousFeedback.total
        } : { positive: 0, negative: 0, total: 0 },
        topComments
      };

      await this.feedbackStore.appendFeedback(feedbackEvent);
      this.log('info', 'Captured feedback event', { prNumber: this.context.prNumber });
    } catch (error) {
      this.log('warn', 'Failed to capture feedback event', { error: error.message });
    }
  }

  /**
   * Generates and writes feedback reports
   * @param {Object} config - Review configuration
   * @returns {Promise<void>}
   */
  async generateFeedbackReports(config) {
    if (!this.feedbackStore || !this.feedbackReporter || !config.feedbackTracking?.enabled) {
      return;
    }

    try {
      const history = this.feedbackStore.getHistory();
      if (!history || history.events.length === 0) {
        this.log('info', 'No feedback history to report');
        return;
      }

      // Generate GitHub Actions summary with analytics
      const actionsSummary = this.feedbackReporter.generateActionsSummary(history.events);
      await this.platformAdapter.writeMetricsSummary(actionsSummary);
      this.log('info', 'Wrote feedback analytics to Actions summary');

      // Generate METRICS.md file
      if (config.feedbackTracking.generateMetricsFile) {
        await this.feedbackReporter.writeMetricsFile(history.events, history.metadata);
      }

      // Auto-commit if enabled
      if (config.feedbackTracking.autoCommit) {
        const additionalFiles = [];
        if (config.feedbackTracking.generateMetricsFile) {
          additionalFiles.push(this.feedbackReporter.getMetricsRelativePath());
        }
        await this.feedbackStore.commitToGit(
          'chore: Update AI review feedback history and metrics',
          additionalFiles
        );
      }
    } catch (error) {
      this.log('warn', 'Failed to generate feedback reports', { error: error.message });
    }
  }

  /**
   * Runs in feedback-only mode when PR is closed/merged
   * Captures final reactions without running a new review
   * @param {Object} config - Review configuration
   * @returns {Promise<Object>} Result object
   */
  async runFeedbackOnlyMode(config) {
    this.log('info', 'PR closed/merged - capturing final feedback only');

    try {
      if (!config.feedbackTracking?.enabled) {
        this.log('info', 'Feedback tracking disabled, nothing to capture');
        return { skipped: true, reason: 'feedback_tracking_disabled' };
      }

      // Get reactions from existing AI comments
      const previousFeedback = await this.getReviewFeedback(config);

      if (!previousFeedback || previousFeedback.total === 0) {
        this.log('info', 'No feedback reactions found on PR comments');
        return { skipped: true, reason: 'no_feedback' };
      }

      this.log('info', `Captured final feedback: +${previousFeedback.positive}/-${previousFeedback.negative}`);

      // Find the most recent event for this PR to update it
      if (this.feedbackStore) {
        const history = this.feedbackStore.getHistory();
        const existingEvent = history?.events?.find(
          e => e.prNumber === this.context.prNumber && e.headSha === this.context.headSha
        );

        if (existingEvent) {
          // Update existing event with final feedback
          existingEvent.feedback = {
            positive: previousFeedback.positive,
            negative: previousFeedback.negative,
            total: previousFeedback.total
          };

          // Update topComments with per-comment feedback if available
          if (previousFeedback.byComment && existingEvent.topComments) {
            const feedbackByKey = new Map();
            for (const fb of previousFeedback.byComment) {
              feedbackByKey.set(`${fb.file}:${fb.line}`, fb);
            }

            for (const comment of existingEvent.topComments) {
              const key = `${comment.file}:${comment.line}`;
              const fb = feedbackByKey.get(key);
              if (fb) {
                comment.positive = fb.positive;
                comment.negative = fb.negative;
              }
            }
          }

          existingEvent.closedAt = new Date().toISOString();
          await this.feedbackStore.saveHistory();
          this.log('info', 'Updated existing feedback event with final reactions');
        } else {
          this.log('info', 'No existing event found for this PR/commit, skipping update');
        }
      }

      // Generate updated reports
      await this.generateFeedbackReports(config);

      // Write summary to Actions
      await this.platformAdapter.writeMetricsSummary(
        `## Feedback Captured on PR Close\n\n` +
        `| Metric | Value |\n|--------|-------|\n` +
        `| 👍 Positive | ${previousFeedback.positive} |\n` +
        `| 👎 Negative | ${previousFeedback.negative} |\n` +
        `| Total Reactions | ${previousFeedback.total} |\n`
      );

      return {
        skipped: false,
        feedbackOnly: true,
        feedback: previousFeedback
      };
    } catch (error) {
      this.log('error', 'Failed to capture final feedback', { error: error.message });
      return { skipped: true, reason: 'error', error: error.message };
    }
  }

  // ============================================================================
  // Feature: Contextual Awareness
  // ============================================================================

  resolveImportPath(importPath, currentFile, language) {
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      return null;
    }

    const currentDir = path.dirname(currentFile);
    let resolvedPath = path.resolve(currentDir, importPath);

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
        return withExt;
      }
    }

    return resolvedPath;
  }

  async getRelatedFiles(parsedFiles, config) {
    if (!config.contextualAwareness?.enabled) {
      return { files: [], content: '' };
    }

    const relatedFiles = new Map();
    const maxFiles = config.contextualAwareness.maxRelatedFiles || 5;

    for (const file of parsedFiles) {
      const language = detectLanguage(file.newPath);
      if (language === 'unknown') continue;

      try {
        const fullPath = path.join(process.cwd(), file.newPath);
        const content = await fs.readFile(fullPath, 'utf-8');

        if (config.contextualAwareness.includeImports) {
          const imports = extractImports(content, language);

          for (const importPath of imports) {
            if (relatedFiles.size >= maxFiles) break;

            const resolvedPath = this.resolveImportPath(importPath, file.newPath, language);
            if (!resolvedPath || relatedFiles.has(resolvedPath)) continue;

            try {
              const importedContent = await fs.readFile(resolvedPath, 'utf-8');
              relatedFiles.set(resolvedPath, {
                path: resolvedPath,
                content: importedContent,
                reason: `imported by ${file.newPath}`
              });
              this.metrics.relatedFilesRead++;
            } catch (e) {
              // File doesn't exist
            }
          }
        }

        if (config.contextualAwareness.includeTests) {
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
              this.metrics.relatedFilesRead++;
            } catch (e) {
              // Test file doesn't exist
            }
          }
        }
      } catch (error) {
        // Could not read file
      }
    }

    let contextContent = '';
    if (relatedFiles.size > 0) {
      contextContent = '\n## Related Files for Context\n';
      for (const [filePath, info] of relatedFiles) {
        const truncatedContent = info.content.length > 2000
          ? info.content.substring(0, 2000) + '\n... (truncated)'
          : info.content;
        contextContent += `\n### ${filePath}\n*Reason: ${info.reason}*\n\`\`\`\n${truncatedContent}\n\`\`\`\n`;
      }
    }

    this.log('info', `Read ${relatedFiles.size} related files for context`);
    return { files: Array.from(relatedFiles.values()), content: contextContent };
  }

  // ============================================================================
  // Feature: Auto-fix PRs
  // ============================================================================

  collectSuggestedFixes(reviews, parsedFiles) {
    const fixes = [];

    for (const review of reviews) {
      for (const comment of review.inlineComments || []) {
        if (comment.suggestedCode) {
          fixes.push({
            file: comment.file,
            line: comment.line,
            severity: comment.severity,
            original: null,
            suggested: comment.suggestedCode,
            comment: comment.comment
          });
          this.metrics.suggestedFixesCount++;
        }
      }
    }

    return fixes;
  }

  async createAutoFixPR(config, fixes, reviews) {
    if (!config.autoFix?.enabled || fixes.length === 0) {
      return null;
    }

    if (!this.platformAdapter?.getCapabilities().supportsAutoFixPR) {
      this.log('info', 'Platform does not support auto-fix PRs');
      return null;
    }

    const branchPrefix = config.autoFix.branchPrefix || 'ai-fix/';
    const branchName = `${branchPrefix}pr-${this.context.prNumber}-${Date.now()}`;

    const prTitle = `fix: AI review fixes for PR #${this.context.prNumber}`;
    const prBody = `## 🤖 Auto-fix PR

This PR contains automatic fixes suggested by the AI code review for PR #${this.context.prNumber}.

### Fixes Applied
${fixes.map(f => `- **${f.file}:${f.line}** - ${f.comment.substring(0, 100)}...`).join('\n')}

### Review
Please review these changes carefully before merging.

---
*Generated automatically by AI PR Review*`;

    try {
      const result = await this.platformAdapter.createAutoFixPR(branchName, fixes, prTitle, prBody);

      if (result) {
        this.metrics.autoFixPRCreated = true;
        this.log('info', 'Created auto-fix PR', { prNumber: result.prNumber, branch: result.branch });
      }

      return result;
    } catch (error) {
      this.log('error', 'Failed to create auto-fix PR', { error: error.message });
      return null;
    }
  }

  // ============================================================================
  // Feature: Severity Threshold
  // ============================================================================

  filterBySeverityThresholdWithConfig(reviews, config) {
    if (!config.severityThreshold?.enabled) {
      return { reviews, filtered: false };
    }

    const minSeverity = config.severityThreshold.minSeverityToComment || 'warning';
    const result = filterBySeverityThreshold(reviews, minSeverity);

    this.log('info', `Severity threshold filter: ${result.originalCount} -> ${result.filteredCount} comments`);

    return result;
  }

  shouldSkipCleanPR(reviews, config) {
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
      this.metrics.skippedDueToThreshold = true;
      this.log('info', 'PR is clean, skipping review comment');
      return true;
    }

    return false;
  }

  // ============================================================================
  // Claude API Integration
  // ============================================================================

  buildSystemPrompt(config, customInstructions) {
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
      "category": "security | codeQuality | documentation | testCoverage | conventions",
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

  buildUserPrompt(files, diff, relatedFilesContent = '') {
    const filesSummary = files.map(f => {
      const lang = detectLanguage(f.newPath);
      return `- ${f.newPath} (${lang}): +${f.additions}/-${f.deletions}`;
    }).join('\n');

    let prompt = `## Pull Request Information
**Title**: ${this.context.prTitle}
**Author**: ${this.context.prAuthor}
**Description**:
${this.context.prBody || 'No description provided'}

## Changed Files Summary
${filesSummary}

## Diff Content
\`\`\`diff
${diff}
\`\`\``;

    if (relatedFilesContent) {
      prompt += `
${relatedFilesContent}`;
    }

    prompt += `

Please review the above changes and provide your feedback in the specified JSON format.`;

    return prompt;
  }

  async reviewWithClaude(config, files, diff, customInstructions, relatedFilesContent = '') {
    const systemPrompt = this.buildSystemPrompt(config, customInstructions);
    const userPrompt = this.buildUserPrompt(files, diff, relatedFilesContent);

    this.log('info', 'Sending request to Claude API', {
      model: config.model,
      diffLength: diff.length,
      filesCount: files.length
    });

    try {
      this.metrics.apiCalls++;

      const response = await this.withRetry(
        () => this.anthropic.messages.create({
          model: config.model,
          max_tokens: config.maxTokens,
          temperature: config.temperature ?? 0,
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

      if (response.usage) {
        this.metrics.tokensUsed += response.usage.input_tokens + response.usage.output_tokens;
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
      this.log('info', 'Received review from Claude', {
        recommendation: review.summary?.recommendation,
        inlineCommentsCount: review.inlineComments?.length || 0
      });

      return review;
    } catch (error) {
      this.log('error', 'Claude API error', { error: error.message });
      throw error;
    }
  }

  chunkDiffWithLogging(diff, files, maxSize) {
    if (diff.length <= maxSize) {
      return [{ diff, files }];
    }

    this.log('info', `Diff too large (${diff.length} chars), chunking...`);

    const chunks = chunkDiff(diff, files, maxSize);

    this.log('info', `Split into ${chunks.length} chunks`);
    return chunks;
  }

  // ============================================================================
  // Review Formatting
  // ============================================================================

  formatSummaryComment(reviews, config, extras = {}) {
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

    this.metrics.criticalIssues = severityCounts.critical;
    this.metrics.warningIssues = severityCounts.warning;
    this.metrics.suggestionIssues = severityCounts.suggestion;

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

    if (extras.sizeWarning) {
      markdown += `

${extras.sizeWarning.message}`;
    }

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

    if (config.metrics?.enabled && config.metrics?.showInComment) {
      const duration = ((Date.now() - this.metrics.startTime) / 1000).toFixed(1);
      markdown += `
### 📊 Review Metrics
| Metric | Value |
|--------|-------|
| Files reviewed | ${this.metrics.filesReviewed} |
| Lines analyzed | ${this.metrics.linesReviewed} |
| API calls | ${this.metrics.apiCalls} |
| Review time | ${duration}s |
`;
    }

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
*To skip AI review, add the \`skip-ai-review\` label or prefix your PR title with \`[no-review]\`.*
*💡 React with 👍 or 👎 on inline comments to help improve future reviews.*`;

    return { markdown, event: finalRecommendation };
  }

  prepareInlineComments(reviews, parsedFiles, config, existingComments = []) {
    const comments = [];
    const fileMap = new Map(parsedFiles.map(f => [f.newPath, f]));

    const totalComments = reviews.reduce((sum, r) => sum + (r.inlineComments?.length || 0), 0);
    this.log('info', `Processing ${totalComments} inline comments from Claude`);

    let skippedSeverity = 0;
    let skippedFile = 0;
    let skippedPosition = 0;
    let skippedDuplicate = 0;

    for (const review of reviews) {
      for (const comment of review.inlineComments || []) {
        if (!config.severity[comment.severity]) {
          skippedSeverity++;
          this.log('debug', `Skipping comment due to severity filter: ${comment.severity}`);
          continue;
        }

        const file = fileMap.get(comment.file);
        if (!file) {
          skippedFile++;
          this.log('warn', `File not found in diff: ${comment.file}`);
          continue;
        }

        const position = this.platformAdapter.calculateCommentPosition(file, comment.line);
        if (!position) {
          skippedPosition++;
          this.log('warn', `Could not find line ${comment.line} in diff for ${comment.file} (severity: ${comment.severity})`);
          continue;
        }

        const existing = this.findExistingComment(existingComments, comment.file, comment.line);
        if (existing) {
          skippedDuplicate++;
          this.log('info', `Skipping duplicate comment at ${comment.file}:${comment.line}`);
          continue;
        }

        this.log('info', `Adding comment at ${comment.file}:${comment.line} (position ${position}, severity: ${comment.severity})`);

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

    this.log('info', `Inline comments summary: ${comments.length} to post, skipped: ${skippedSeverity} (severity), ${skippedFile} (file not found), ${skippedPosition} (position not found), ${skippedDuplicate} (duplicate)`);

    return comments;
  }

  // ============================================================================
  // Metrics
  // ============================================================================

  async writeMetricsSummary(config) {
    if (!config.metrics?.enabled || !config.metrics?.showInSummary) {
      return;
    }

    const duration = ((Date.now() - this.metrics.startTime) / 1000).toFixed(1);

    const summary = `## 📊 AI PR Review Metrics

| Metric | Value |
|--------|-------|
| PR Number | #${this.context.prNumber} |
| Files Reviewed | ${this.metrics.filesReviewed} |
| Lines Analyzed | ${this.metrics.linesReviewed} |
| Comments Posted | ${this.metrics.commentsPosted} |
| Critical Issues | ${this.metrics.criticalIssues} |
| Warnings | ${this.metrics.warningIssues} |
| Suggestions | ${this.metrics.suggestionIssues} |
| API Calls | ${this.metrics.apiCalls} |
| Tokens Used | ${this.metrics.tokensUsed} |
| Review Duration | ${duration}s |
| Cache Hit | ${this.metrics.cachedSkipped ? 'Yes (skipped)' : 'No'} |
| Related Files Read | ${this.metrics.relatedFilesRead} |
| Suggested Fixes | ${this.metrics.suggestedFixesCount} |
| Auto-fix PR Created | ${this.metrics.autoFixPRCreated ? 'Yes' : 'No'} |
| Skipped (Clean PR) | ${this.metrics.skippedDueToThreshold ? 'Yes' : 'No'} |
`;

    try {
      await this.platformAdapter.writeMetricsSummary(summary);
      this.log('info', 'Wrote metrics summary');
    } catch (error) {
      this.log('warn', 'Failed to write metrics summary', { error: error.message });
    }
  }

  // ============================================================================
  // Main Review Execution
  // ============================================================================

  async run() {
    this.log('info', 'Starting AI PR Review', {
      platform: this.platformAdapter.getPlatformType(),
      pr: this.context.prNumber,
      repo: `${this.context.owner}/${this.context.repo}`,
      event: this.context.eventName
    });

    try {
      const config = await this.loadConfig();

      if (!config.enabled) {
        this.log('info', 'AI review is disabled in configuration');
        return { skipped: true, reason: 'disabled' };
      }

      // Feature: Initialize feedback tracking
      await this.initFeedbackTracking(config);

      // Feature: Capture final feedback on PR close/merge
      if (this.context.eventName === 'closed') {
        return await this.runFeedbackOnlyMode(config);
      }

      // Feature: Check cache
      if (await this.isCommitAlreadyReviewed(config)) {
        await this.writeMetricsSummary(config);
        return { skipped: true, reason: 'cached' };
      }

      // Get the full PR diff
      const rawDiff = await this.platformAdapter.getDiff();
      const changedFiles = await this.platformAdapter.getChangedFiles();

      this.log('info', `Processing ${changedFiles.length} changed files`);

      // Feature: Filter ignored content
      const { diff: filteredDiffContent, ignoredLines } = this.filterIgnoredContentWithConfig(rawDiff, config);
      if (ignoredLines.length > 0) {
        this.log('info', `Filtered ${ignoredLines.length} ignored lines/files`);
      }

      // Parse the diff for review
      const parsedFiles = parseDiff(filteredDiffContent);

      // Update metrics
      this.metrics.filesReviewed = parsedFiles.length;
      this.metrics.linesReviewed = parsedFiles.reduce((sum, f) => sum + f.additions + f.deletions, 0);

      // Feature: PR size warning
      const sizeWarning = checkPRSize(parsedFiles, config);

      // Filter out ignored files
      const filesToReview = parsedFiles.filter(f =>
        !shouldIgnoreFile(f.newPath, config.ignorePatterns)
      );

      if (filesToReview.length === 0) {
        this.log('info', 'No files to review after filtering');
        await this.platformAdapter.postReview(
          '## 🤖 AI Code Review\n\nNo reviewable files found in this PR (all files matched ignore patterns).',
          []
        );
        await this.writeMetricsSummary(config);
        return { skipped: true, reason: 'no-files' };
      }

      // Limit files if too many
      const limitedFiles = filesToReview.slice(0, config.maxFilesPerReview);
      if (filesToReview.length > config.maxFilesPerReview) {
        this.log('warn', `Too many files (${filesToReview.length}), limiting to ${config.maxFilesPerReview}`);
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
      const customInstructions = this.getCustomInstructions(config);

      // Feature: Contextual Awareness
      const relatedFiles = await this.getRelatedFiles(limitedFiles, config);

      // Feature: Feedback Loop
      const previousFeedback = await this.getReviewFeedback(config);

      // Chunk if necessary and review
      const chunks = this.chunkDiffWithLogging(filteredDiff, limitedFiles, config.chunkSize);
      const reviews = [];

      for (let i = 0; i < chunks.length; i++) {
        this.log('info', `Processing chunk ${i + 1}/${chunks.length}`);
        const review = await this.reviewWithClaude(
          config,
          chunks[i].files,
          chunks[i].diff,
          customInstructions,
          relatedFiles.content
        );
        reviews.push(review);

        if (i < chunks.length - 1) {
          await this.sleep(2000);
        }
      }

      // Feature: Severity Threshold
      if (this.shouldSkipCleanPR(reviews, config)) {
        this.log('info', 'Skipping review - PR is clean (below severity threshold)');
        await this.writeMetricsSummary(config);
        await this.writeFeedbackSummary(previousFeedback, config);
        return { skipped: true, reason: 'clean' };
      }

      // Feature: Severity Threshold - filter comments
      const { reviews: filteredReviews } = this.filterBySeverityThresholdWithConfig(reviews, config);

      // Feature: Check if previous issues were resolved
      const resolvedIssues = await this.checkAndDismissStaleReviews(config, filteredReviews);

      // Feature: Get existing comments for threading
      const existingComments = await this.getExistingAIComments();

      // Feature: Auto-fix PRs
      let autoFixResult = null;
      if (config.autoFix?.enabled) {
        const suggestedFixes = this.collectSuggestedFixes(filteredReviews, parsedFiles);
        if (suggestedFixes.length > 0) {
          autoFixResult = await this.createAutoFixPR(config, suggestedFixes, filteredReviews);
        }
      }

      // Prepare and post the review
      const { markdown: summaryComment, event: reviewEvent } = this.formatSummaryComment(
        filteredReviews,
        config,
        { sizeWarning, resolvedIssues, autoFixResult }
      );
      const inlineComments = this.prepareInlineComments(filteredReviews, parsedFiles, config, existingComments);

      if (inlineComments.length === 0) {
        this.log('info', 'No inline comments to post (all filtered or position not found)');
      }

      await this.platformAdapter.postReview(summaryComment, inlineComments, reviewEvent);
      this.metrics.commentsPosted = inlineComments.length;

      // Feature: Write metrics summary
      await this.writeMetricsSummary(config);

      // Feature: Feedback Loop
      await this.writeFeedbackSummary(previousFeedback, config);

      // Feature: Feedback Tracking (Persistent)
      await this.captureFeedbackEvent(filteredReviews, previousFeedback, config);
      await this.generateFeedbackReports(config);

      this.log('info', 'Review completed successfully', {
        inlineComments: inlineComments.length,
        reviewEvent,
        relatedFilesRead: this.metrics.relatedFilesRead,
        autoFixCreated: this.metrics.autoFixPRCreated
      });

      return {
        success: true,
        metrics: this.metrics,
        reviewEvent
      };

    } catch (error) {
      this.log('error', 'Review failed', {
        error: error.message,
        stack: error.stack
      });

      // Still try to write metrics on failure
      try {
        await this.writeMetricsSummary(await this.loadConfig());
      } catch (e) {
        // Ignore metrics failure
      }

      throw error;
    }
  }
}
