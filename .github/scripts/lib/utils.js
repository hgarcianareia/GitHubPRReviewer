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
 */
export function parsePRNumber(value) {
  const num = parseInt(value, 10);
  if (isNaN(num) || num <= 0) {
    throw new Error(`Invalid PR_NUMBER: ${value}. Must be a positive integer.`);
  }
  return num;
}

/**
 * Maximum length for git branch names (git typically allows ~255 bytes)
 */
const MAX_BRANCH_NAME_LENGTH = 200;

/**
 * Sanitize a git branch name to prevent command injection
 * Allows valid git ref characters: alphanumeric, hyphens, underscores, forward slashes, dots, and tildes
 * Blocks shell injection characters: ; | & $ ` ( ) { } < > \ " '
 * @param {string} name - The branch name to sanitize
 * @returns {string} - The sanitized branch name (max 200 chars)
 */
export function sanitizeBranchName(name) {
  if (!name || typeof name !== 'string') {
    return '';
  }
  // Remove shell injection characters while preserving valid git ref chars (. and ~)
  return name
    .replace(/[;|&$`(){}<>\\\"']/g, '-')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '')
    .replace(/-+/g, '-')
    .slice(0, MAX_BRANCH_NAME_LENGTH);
}

/**
 * Check if a file should be ignored based on patterns
 * Note: Patterns like '*.min.js' only match files in the root directory.
 * Use '**\/*.min.js' to match in subdirectories.
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
 * @param {Object} target - The target object
 * @param {Object} source - The source object
 * @returns {Object} - The merged object
 */
export function deepMerge(target, source) {
  const result = { ...target };
  for (const key in source) {
    // If source value is an array or not an object, replace directly
    if (Array.isArray(source[key]) || !(source[key] instanceof Object)) {
      result[key] = source[key];
    } else if (key in target && target[key] instanceof Object && !Array.isArray(target[key])) {
      // Both are non-array objects, merge recursively
      result[key] = deepMerge(target[key], source[key]);
    } else {
      // Target doesn't have this key or target value is not an object
      result[key] = source[key];
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
