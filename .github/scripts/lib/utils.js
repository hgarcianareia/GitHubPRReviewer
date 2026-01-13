/**
 * Utility functions for AI PR Review
 * Extracted for testability
 */

import path from 'path';

/**
 * Parse and validate PR number from environment
 * @param {string} value - The PR number as a string
 * @returns {number} - The parsed PR number
 * @throws {Error} - If the value is not a valid positive integer
 * @example
 * parsePRNumber('42')  // returns 42
 * parsePRNumber('0')   // throws Error
 * parsePRNumber('abc') // throws Error
 */
export function parsePRNumber(value) {
  const num = parseInt(value, 10);
  if (isNaN(num) || num <= 0) {
    throw new Error(`Invalid PR_NUMBER: ${value}. Must be a positive integer.`);
  }
  return num;
}

/**
 * Valid GitHub repository name pattern
 * Allows alphanumeric, hyphens, underscores, and dots (1-100 chars)
 * See: https://docs.github.com/en/repositories/creating-and-managing-repositories/about-repositories
 */
const REPO_NAME_PATTERN = /^[a-zA-Z0-9._-]{1,100}$/;

/**
 * Valid GitHub username/org pattern
 * Allows alphanumeric and hyphens, cannot start/end with hyphen (1-39 chars)
 * See: https://docs.github.com/en/get-started/signing-up-for-github/signing-up-for-a-new-github-account
 */
const GITHUB_USERNAME_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;

/**
 * Valid git SHA pattern (40-char hex or 7+ char short SHA)
 */
const GIT_SHA_PATTERN = /^[a-fA-F0-9]{7,40}$/;

/**
 * Validate a GitHub repository owner (username or org)
 * @param {string} value - The owner name to validate
 * @returns {string} - The validated owner name
 * @throws {Error} - If the value is not a valid GitHub username/org
 */
export function validateRepoOwner(value) {
  if (!value || typeof value !== 'string') {
    throw new Error('REPO_OWNER is required and must be a string.');
  }
  if (!GITHUB_USERNAME_PATTERN.test(value)) {
    throw new Error(`Invalid REPO_OWNER: "${value}". Must be a valid GitHub username (1-39 alphanumeric chars or hyphens, cannot start/end with hyphen).`);
  }
  return value;
}

/**
 * Validate a GitHub repository name
 * @param {string} value - The repo name to validate
 * @returns {string} - The validated repo name
 * @throws {Error} - If the value is not a valid repository name
 */
export function validateRepoName(value) {
  if (!value || typeof value !== 'string') {
    throw new Error('REPO_NAME is required and must be a string.');
  }
  if (!REPO_NAME_PATTERN.test(value)) {
    throw new Error(`Invalid REPO_NAME: "${value}". Must be 1-100 alphanumeric chars, hyphens, underscores, or dots.`);
  }
  return value;
}

/**
 * Validate a git SHA (commit hash)
 * @param {string} value - The SHA to validate
 * @param {string} [name='SHA'] - Name of the variable for error messages
 * @returns {string} - The validated SHA
 * @throws {Error} - If the value is not a valid git SHA
 */
export function validateGitSha(value, name = 'SHA') {
  if (!value || typeof value !== 'string') {
    throw new Error(`${name} is required and must be a string.`);
  }
  if (!GIT_SHA_PATTERN.test(value)) {
    throw new Error(`Invalid ${name}: "${value}". Must be a 7-40 character hexadecimal git SHA.`);
  }
  return value;
}

/**
 * Maximum length for git branch names (git typically allows ~255 bytes)
 */
const MAX_BRANCH_NAME_LENGTH = 200;

/**
 * Sanitize a git branch name to prevent command injection
 * Allows valid git ref characters: alphanumeric, hyphens, underscores, forward slashes, dots, and tildes
 * Blocks shell injection and problematic characters: ; | & $ ` ( ) { } < > \ " ' @ #
 * @param {string} name - The branch name to sanitize
 * @returns {string} - The sanitized branch name (max 200 chars)
 */
export function sanitizeBranchName(name) {
  if (!name || typeof name !== 'string') {
    return '';
  }
  // Remove shell injection and problematic characters
  const sanitized = name
    .replace(/[;|&$`(){}<>\\\"'@#]/g, '-')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '')
    .replace(/-+/g, '-');

  // Warn if truncation occurs (useful for debugging)
  if (sanitized.length > MAX_BRANCH_NAME_LENGTH) {
    console.warn(`[WARN] Branch name truncated from ${sanitized.length} to ${MAX_BRANCH_NAME_LENGTH} chars`);
  }

  return sanitized.slice(0, MAX_BRANCH_NAME_LENGTH);
}

/**
 * Check if a file should be ignored based on patterns
 *
 * Pattern matching rules:
 * - Patterns without path separators match exact filenames (e.g., '*.lock' matches 'yarn.lock')
 * - Use `**\/*.ext` to match files in any directory (e.g., '**\/*.min.js' matches 'src/bundle.min.js')
 * - Use `dir/**` to match all files in a directory (e.g., 'dist/**' matches 'dist/bundle.js')
 *
 * @param {string} filename - The filename to check
 * @param {string[]} ignorePatterns - Array of glob patterns
 * @returns {boolean} - True if the file should be ignored
 */
export function shouldIgnoreFile(filename, ignorePatterns) {
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
 * @param {string} filename - The filename to analyze
 * @returns {string} - The detected language or 'unknown'
 */
export function detectLanguage(filename) {
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

/**
 * Deep merge two objects
 * Arrays are replaced, not merged. Only plain objects are recursively merged.
 * Null/undefined values in source will replace target values.
 * @param {Object} target - The target object
 * @param {Object} source - The source object
 * @returns {Object} - The merged object
 */
export function deepMerge(target, source) {
  const result = { ...target };
  for (const key in source) {
    const sourceValue = source[key];
    const targetValue = target[key];

    // Handle null/undefined explicitly - they replace target values
    if (sourceValue === null || sourceValue === undefined) {
      result[key] = sourceValue;
    }
    // Arrays replace, don't merge
    else if (Array.isArray(sourceValue)) {
      result[key] = sourceValue;
    }
    // Plain objects get recursively merged if target also has a plain object
    else if (
      typeof sourceValue === 'object' &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(targetValue, sourceValue);
    }
    // Everything else (primitives, objects where target is not an object) replaces
    else {
      result[key] = sourceValue;
    }
  }
  return result;
}

/**
 * Ensure a value is an array
 * Note: If an object is passed, only its values are returned (keys are lost).
 * This is intended for YAML parsing where arrays may be parsed as indexed objects.
 * @param {*} value - The value to check
 * @returns {Array} - The value as an array
 */
export function ensureArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return Object.values(value);
}

/**
 * Parse a unified diff into structured file objects
 * @param {string} diffContent - The unified diff content
 * @returns {Array} - Array of parsed file objects
 */
export function parseDiff(diffContent) {
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

/**
 * Calculate the diff position for a given line in a file
 * @param {Object} file - The parsed file object
 * @param {number} targetLine - The target line number
 * @returns {number|null} - The diff position or null if not found
 */
export function calculateDiffPosition(file, targetLine) {
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

/**
 * Severity levels for comparison
 */
export const SEVERITY_LEVELS = ['nitpick', 'suggestion', 'warning', 'critical'];

/**
 * Get severity level as number for comparison
 * @param {string} severity - The severity string
 * @returns {number} - The severity level index
 */
export function getSeverityLevel(severity) {
  return SEVERITY_LEVELS.indexOf(severity);
}
