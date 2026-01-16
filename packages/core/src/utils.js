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
  // GitHub's position is 1-indexed starting from the first line of content
  // after the @@ hunk header. The @@ header itself is NOT counted.
  let position = 0;

  for (const hunk of file.hunks) {
    // Note: Don't count the @@ hunk header - GitHub positions start at 1
    // for the first actual content line after the header

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
    // Note: Don't count the @@ hunk header

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

/**
 * Extract custom review instructions from PR description
 * Looks for <!-- ai-review: instructions here --> pattern
 * @param {string} prBody - The PR description body
 * @returns {string|null} - The custom instructions or null if not found
 */
export function extractCustomInstructions(prBody) {
  if (!prBody || typeof prBody !== 'string') {
    return null;
  }

  // Look for <!-- ai-review: instructions here -->
  const match = prBody.match(/<!--\s*ai-review:\s*(.*?)\s*-->/is);
  if (match) {
    return match[1].trim();
  }

  return null;
}

/**
 * Filter out lines/files with ignore comments from diff
 * @param {string} diff - The diff content
 * @param {string[]} patterns - Array of ignore patterns to look for
 * @returns {Object} - { diff: filteredDiff, ignoredLines: array of ignored items }
 */
export function filterIgnoredContent(diff, patterns) {
  if (!diff || typeof diff !== 'string') {
    return { diff: '', ignoredLines: [] };
  }

  if (!patterns || !Array.isArray(patterns) || patterns.length === 0) {
    return { diff, ignoredLines: [] };
  }

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

/**
 * Check PR size and generate warning if too large
 * @param {Array} parsedFiles - Array of parsed file objects from parseDiff
 * @param {Object} config - Configuration with prSizeWarning settings
 * @returns {Object|null} - Warning object or null if no warning
 */
export function checkPRSize(parsedFiles, config) {
  if (!config?.prSizeWarning?.enabled) {
    return null;
  }

  if (!parsedFiles || !Array.isArray(parsedFiles)) {
    return null;
  }

  const totalLines = parsedFiles.reduce((sum, f) => sum + (f.additions || 0) + (f.deletions || 0), 0);
  const totalFiles = parsedFiles.length;

  const warnings = [];

  if (totalLines > (config.prSizeWarning.maxLines || Infinity)) {
    warnings.push(`This PR has **${totalLines} changed lines**, which exceeds the recommended maximum of ${config.prSizeWarning.maxLines} lines.`);
  }

  if (totalFiles > (config.prSizeWarning.maxFiles || Infinity)) {
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

/**
 * Extract import statements from file content
 * @param {string} content - The file content
 * @param {string} language - The programming language
 * @returns {string[]} - Array of import paths
 */
export function extractImports(content, language) {
  if (!content || typeof content !== 'string') {
    return [];
  }

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
 * Filter reviews/comments based on severity threshold
 * @param {Array} reviews - Array of review objects with inlineComments
 * @param {string} minSeverity - Minimum severity to include ('nitpick', 'suggestion', 'warning', 'critical')
 * @returns {Object} - { reviews: filtered reviews, filtered: boolean, originalCount, filteredCount }
 */
export function filterBySeverityThreshold(reviews, minSeverity) {
  if (!reviews || !Array.isArray(reviews)) {
    return { reviews: [], filtered: false, originalCount: 0, filteredCount: 0 };
  }

  const minLevel = getSeverityLevel(minSeverity || 'nitpick');

  const filteredReviews = reviews.map(review => ({
    ...review,
    inlineComments: (review.inlineComments || []).filter(
      comment => getSeverityLevel(comment.severity) >= minLevel
    )
  }));

  const totalRemaining = filteredReviews.reduce(
    (sum, r) => sum + (r.inlineComments?.length || 0),
    0
  );

  const originalTotal = reviews.reduce(
    (sum, r) => sum + (r.inlineComments?.length || 0),
    0
  );

  return {
    reviews: filteredReviews,
    filtered: totalRemaining < originalTotal,
    originalCount: originalTotal,
    filteredCount: totalRemaining
  };
}

/**
 * Chunk a diff into smaller pieces for API calls
 * @param {string} diff - The full diff content
 * @param {Array} files - Array of parsed file objects
 * @param {number} maxSize - Maximum chunk size in characters
 * @returns {Array} - Array of { diff, files } chunks
 */
export function chunkDiff(diff, files, maxSize) {
  if (!diff || typeof diff !== 'string') {
    return [];
  }

  if (diff.length <= maxSize) {
    return [{ diff, files: files || [] }];
  }

  const chunks = [];
  let currentChunk = { diff: '', files: [] };

  const filePattern = /^diff --git/m;
  const fileDiffs = diff.split(filePattern).slice(1).map(d => 'diff --git' + d);

  for (let i = 0; i < fileDiffs.length; i++) {
    const fileDiff = fileDiffs[i];
    const file = files ? files[i] : null;

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

  return chunks;
}

/**
 * Attempt to repair malformed JSON from Claude API responses
 * Common issues:
 * - Unescaped quotes in strings
 * - Trailing commas
 * - Truncated responses
 * - Control characters in strings
 *
 * @param {string} jsonString - The potentially malformed JSON string
 * @returns {object} - Parsed JSON object
 * @throws {Error} - If JSON cannot be repaired
 */
export function repairAndParseJSON(jsonString) {
  // First, try to parse as-is
  try {
    return JSON.parse(jsonString);
  } catch (firstError) {
    // Continue to repair attempts
  }

  let repaired = jsonString;

  // Remove any text before the first { and after the last }
  const startIndex = repaired.indexOf('{');
  const endIndex = repaired.lastIndexOf('}');
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    repaired = repaired.substring(startIndex, endIndex + 1);
  }

  // Fix common issues

  // 1. Remove control characters except \n, \r, \t within strings
  repaired = repaired.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  // 2. Fix trailing commas before ] or }
  repaired = repaired.replace(/,(\s*[}\]])/g, '$1');

  // 3. Try to parse after basic fixes
  try {
    return JSON.parse(repaired);
  } catch (secondError) {
    // Continue to more aggressive repairs
  }

  // 4. Try to fix unescaped quotes in string values
  // This is tricky - we need to find strings and escape internal quotes
  repaired = fixUnescapedQuotesInJSON(repaired);

  try {
    return JSON.parse(repaired);
  } catch (thirdError) {
    // Continue to truncation repair
  }

  // 5. Handle truncated JSON - try to close unclosed structures
  repaired = closeTruncatedJSON(repaired);

  try {
    return JSON.parse(repaired);
  } catch (fourthError) {
    // If all repairs fail, throw with details
    throw new Error(
      `Failed to parse JSON after repair attempts. ` +
      `Original error: ${fourthError.message}. ` +
      `JSON snippet: ${jsonString.substring(0, 500)}...`
    );
  }
}

/**
 * Attempt to fix unescaped quotes within JSON string values
 * @param {string} json - JSON string
 * @returns {string} - Repaired JSON string
 */
function fixUnescapedQuotesInJSON(json) {
  let result = '';
  let inString = false;
  let i = 0;

  while (i < json.length) {
    const char = json[i];
    const prevChar = i > 0 ? json[i - 1] : '';

    if (char === '"' && prevChar !== '\\') {
      if (!inString) {
        // Starting a string
        inString = true;
        result += char;
      } else {
        // Check if this quote ends the string or is internal
        // Look ahead to see if next non-whitespace is : , ] or }
        let j = i + 1;
        while (j < json.length && /\s/.test(json[j])) j++;
        const nextSignificant = json[j];

        if (nextSignificant === ':' || nextSignificant === ',' ||
            nextSignificant === ']' || nextSignificant === '}' ||
            j >= json.length) {
          // This quote ends the string
          inString = false;
          result += char;
        } else {
          // This is an internal quote that should be escaped
          result += '\\"';
        }
      }
    } else if (char === '\n' && inString) {
      // Newlines in strings should be escaped
      result += '\\n';
    } else if (char === '\t' && inString) {
      // Tabs in strings should be escaped
      result += '\\t';
    } else {
      result += char;
    }
    i++;
  }

  return result;
}

/**
 * Attempt to close truncated JSON by adding missing brackets
 * @param {string} json - Potentially truncated JSON
 * @returns {string} - JSON with closing brackets added
 */
function closeTruncatedJSON(json) {
  const stack = [];
  let inString = false;
  let i = 0;

  while (i < json.length) {
    const char = json[i];
    const prevChar = i > 0 ? json[i - 1] : '';

    if (char === '"' && prevChar !== '\\') {
      inString = !inString;
    } else if (!inString) {
      if (char === '{') stack.push('}');
      else if (char === '[') stack.push(']');
      else if (char === '}' || char === ']') {
        if (stack.length > 0 && stack[stack.length - 1] === char) {
          stack.pop();
        }
      }
    }
    i++;
  }

  // If we're still in a string, close it
  let result = json;
  if (inString) {
    result += '"';
  }

  // Close any unclosed brackets
  while (stack.length > 0) {
    result += stack.pop();
  }

  return result;
}
