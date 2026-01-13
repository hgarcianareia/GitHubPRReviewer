/**
 * AI PR Review Script
 *
 * Uses Claude (Anthropic) to perform comprehensive code reviews on Pull Requests.
 * Posts inline comments and a summary review on the PR.
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
  chunkSize: 100000,  // Characters per chunk for large diffs
  maxFilesPerReview: 50,
  severity: {
    critical: true,
    warning: true,
    suggestion: true,
    nitpick: false
  }
};

// Rate limiting configuration
const RATE_LIMIT = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000
};

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
  headSha: process.env.HEAD_SHA
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

      // Check for rate limiting
      if (error.status === 429 || error.message?.includes('rate')) {
        log('warn', `Rate limited on ${operation}, attempt ${attempt}/${RATE_LIMIT.maxRetries}`);
        await sleep(delay);
        delay = Math.min(delay * 2, RATE_LIMIT.maxDelayMs);
        continue;
      }

      // For other errors, don't retry
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
    return { ...DEFAULT_CONFIG, ...userConfig };
  } catch (error) {
    if (error.code === 'ENOENT') {
      log('info', 'No custom config found, using defaults');
      return DEFAULT_CONFIG;
    }
    log('warn', 'Error loading config, using defaults', { error: error.message });
    return DEFAULT_CONFIG;
  }
}

/**
 * Check if a file should be ignored based on patterns
 */
function shouldIgnoreFile(filename, ignorePatterns) {
  return ignorePatterns.some(pattern => {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
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
// GitHub API Functions
// ============================================================================

/**
 * Get the diff content for the PR
 */
async function getPRDiff() {
  try {
    const diffContent = await fs.readFile('pr_diff.txt', 'utf-8');
    return diffContent;
  } catch (error) {
    log('error', 'Failed to read diff file', { error: error.message });
    throw error;
  }
}

/**
 * Get list of changed files
 */
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
 * Get file content at specific commit
 */
async function getFileContent(filename, sha) {
  try {
    const response = await withRetry(
      () => octokit.repos.getContent({
        owner: context.owner,
        repo: context.repo,
        path: filename,
        ref: sha
      }),
      `getFileContent:${filename}`
    );

    if (response.data.content) {
      return Buffer.from(response.data.content, 'base64').toString('utf-8');
    }
    return null;
  } catch (error) {
    if (error.status === 404) {
      return null; // File doesn't exist at this commit
    }
    throw error;
  }
}

/**
 * Post a review comment on the PR
 */
async function postReviewComment(body, comments = []) {
  try {
    await withRetry(
      () => octokit.pulls.createReview({
        owner: context.owner,
        repo: context.repo,
        pull_number: context.prNumber,
        commit_id: context.headSha,
        body: body,
        event: 'COMMENT',
        comments: comments
      }),
      'postReviewComment'
    );
    log('info', `Posted review with ${comments.length} inline comments`);
  } catch (error) {
    log('error', 'Failed to post review', { error: error.message });
    throw error;
  }
}

// ============================================================================
// Diff Parsing
// ============================================================================

/**
 * Parse unified diff format into structured data
 */
function parseDiff(diffContent) {
  const files = [];
  const lines = diffContent.split('\n');

  let currentFile = null;
  let currentHunk = null;
  let lineInHunk = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // New file header
    if (line.startsWith('diff --git')) {
      if (currentFile) {
        files.push(currentFile);
      }

      // Extract filename from "diff --git a/path b/path"
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

    // Skip file mode, index lines
    if (line.startsWith('index ') ||
        line.startsWith('old mode') ||
        line.startsWith('new mode') ||
        line.startsWith('new file') ||
        line.startsWith('deleted file') ||
        line.startsWith('---') ||
        line.startsWith('+++')) {
      continue;
    }

    // Hunk header
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

    // Content lines
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

  // Don't forget the last file
  if (currentFile) {
    files.push(currentFile);
  }

  return files;
}

/**
 * Calculate position in diff for inline comments
 */
function calculateDiffPosition(file, targetLine) {
  let position = 0;

  for (const hunk of file.hunks) {
    position++; // Count the @@ line

    for (const change of hunk.changes) {
      position++;
      if (change.type === 'add' && change.newLine === targetLine) {
        return position;
      }
    }
  }

  return null;
}

// ============================================================================
// Claude API Integration
// ============================================================================

/**
 * Build the system prompt for Claude
 */
function buildSystemPrompt(config) {
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

  return `You are an expert code reviewer with deep knowledge of software engineering best practices.
Your task is to review Pull Request changes and provide constructive, actionable feedback.

## Review Focus Areas
${areas.join('\n')}

## Language Expertise
You have expertise in: ${config.languages.join(', ')}

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
      "comment": "The specific issue and how to fix it"
    }
  ]
}

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
}

/**
 * Build the user prompt with PR context and diff
 */
function buildUserPrompt(prContext, files, diff) {
  const filesSummary = files.map(f => {
    const lang = detectLanguage(f.newPath);
    return `- ${f.newPath} (${lang}): +${f.additions}/-${f.deletions}`;
  }).join('\n');

  return `## Pull Request Information
**Title**: ${prContext.prTitle}
**Author**: ${prContext.prAuthor}
**Description**:
${prContext.prBody || 'No description provided'}

## Changed Files Summary
${filesSummary}

## Diff Content
\`\`\`diff
${diff}
\`\`\`

Please review the above changes and provide your feedback in the specified JSON format.`;
}

/**
 * Send diff to Claude for review
 */
async function reviewWithClaude(config, files, diff) {
  const systemPrompt = buildSystemPrompt(config);
  const userPrompt = buildUserPrompt(context, files, diff);

  log('info', 'Sending request to Claude API', {
    model: config.model,
    diffLength: diff.length,
    filesCount: files.length
  });

  try {
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

    // Extract the text content from the response
    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    // Parse the JSON response
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

/**
 * Chunk large diffs into smaller pieces
 */
function chunkDiff(diff, files, maxSize) {
  if (diff.length <= maxSize) {
    return [{ diff, files }];
  }

  log('info', `Diff too large (${diff.length} chars), chunking...`);

  const chunks = [];
  let currentChunk = { diff: '', files: [] };

  // Split by file
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
    currentChunk.files.push(file);
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

/**
 * Format the summary comment for the PR
 */
function formatSummaryComment(reviews, config) {
  // Aggregate results from all chunks
  const allStrengths = [];
  const allConcerns = [];
  let finalRecommendation = 'COMMENT';
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
      // Escalate recommendation if any chunk requests changes
      if (review.summary.recommendation === 'REQUEST_CHANGES') {
        finalRecommendation = 'REQUEST_CHANGES';
      } else if (review.summary.recommendation === 'APPROVE' && finalRecommendation !== 'REQUEST_CHANGES') {
        finalRecommendation = 'APPROVE';
      }
    }
  }

  // Count comments by severity
  const severityCounts = { critical: 0, warning: 0, suggestion: 0, nitpick: 0 };
  for (const review of reviews) {
    for (const comment of review.inlineComments || []) {
      if (severityCounts[comment.severity] !== undefined) {
        severityCounts[comment.severity]++;
      }
    }
  }

  // Build recommendation emoji
  const recommendationEmoji = {
    'APPROVE': '✅',
    'REQUEST_CHANGES': '🔴',
    'COMMENT': '💬'
  };

  let markdown = `## 🤖 AI Code Review Summary

${recommendationEmoji[finalRecommendation]} **Recommendation**: ${finalRecommendation.replace('_', ' ')}

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

  markdown += `
---
*This review was generated by Claude (${config.model}). Please use your judgment when evaluating the suggestions.*
*To skip AI review, add the \`skip-ai-review\` label or prefix your PR title with \`[no-review]\`.*`;

  return markdown;
}

/**
 * Convert review comments to GitHub PR review format
 */
function prepareInlineComments(reviews, parsedFiles, config) {
  const comments = [];
  const fileMap = new Map(parsedFiles.map(f => [f.newPath, f]));

  for (const review of reviews) {
    for (const comment of review.inlineComments || []) {
      // Skip based on severity settings
      if (!config.severity[comment.severity]) {
        continue;
      }

      const file = fileMap.get(comment.file);
      if (!file) {
        log('warn', `File not found in diff: ${comment.file}`);
        continue;
      }

      const position = calculateDiffPosition(file, comment.line);
      if (!position) {
        log('warn', `Could not find line ${comment.line} in diff for ${comment.file}`);
        continue;
      }

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

      comments.push({
        path: comment.file,
        position: position,
        body: `${severityEmoji[comment.severity] || '💬'} ${categoryEmoji[comment.category] || ''} **${comment.severity?.toUpperCase() || 'INFO'}** (${comment.category || 'general'})

${comment.comment}`
      });
    }
  }

  return comments;
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  log('info', 'Starting AI PR Review', {
    pr: context.prNumber,
    repo: `${context.owner}/${context.repo}`
  });

  try {
    // Load configuration
    const config = await loadConfig();

    if (!config.enabled) {
      log('info', 'AI review is disabled in configuration');
      return;
    }

    // Get diff and parse it
    const rawDiff = await getPRDiff();
    const changedFiles = await getChangedFiles();

    log('info', `Processing ${changedFiles.length} changed files`);

    // Parse the diff
    const parsedFiles = parseDiff(rawDiff);

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

      const startMatch = rawDiff.match(startPattern);
      if (!startMatch) return '';

      const startIndex = startMatch.index;
      const afterStart = rawDiff.substring(startIndex + startMatch[0].length);
      const nextMatch = afterStart.match(nextFilePattern);

      if (nextMatch) {
        return rawDiff.substring(startIndex, startIndex + startMatch[0].length + nextMatch.index);
      }
      return rawDiff.substring(startIndex);
    }).join('');

    // Chunk if necessary and review
    const chunks = chunkDiff(filteredDiff, limitedFiles, config.chunkSize);
    const reviews = [];

    for (let i = 0; i < chunks.length; i++) {
      log('info', `Processing chunk ${i + 1}/${chunks.length}`);
      const review = await reviewWithClaude(config, chunks[i].files, chunks[i].diff);
      reviews.push(review);

      // Add delay between chunks to avoid rate limiting
      if (i < chunks.length - 1) {
        await sleep(2000);
      }
    }

    // Prepare and post the review
    const summaryComment = formatSummaryComment(reviews, config);
    const inlineComments = prepareInlineComments(reviews, parsedFiles, config);

    await postReviewComment(summaryComment, inlineComments);

    log('info', 'Review completed successfully', {
      inlineComments: inlineComments.length
    });

  } catch (error) {
    log('error', 'Review failed', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// Run the main function
main();
