# AI PR Reviewer with Claude

Automatically review Pull Requests using Anthropic's Claude AI. This GitHub Action analyzes code changes and provides comprehensive feedback on code quality, security, documentation, and best practices.

## Table of Contents

- [Initial Setup](#initial-setup)
- [Detailed Configuration](#detailed-configuration)
- [Detailed Implemented Features](#detailed-implemented-features)
- [Review Output](#review-output)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

---

## Initial Setup

### Prerequisites

- GitHub repository with Actions enabled
- Node.js >= 20.0.0 (used by the action runner)
- Anthropic API key ([get one here](https://console.anthropic.com))

### Step 1: Add the API Key Secret

1. Go to your repository **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `ANTHROPIC_API_KEY`
4. Value: Your Anthropic API key

### Step 2: Copy the Workflow Files

Copy the following files from this repository to your target repository:

```
.github/
├── workflows/
│   └── pr-review.yml      # GitHub Action workflow
├── scripts/
│   ├── review-pr.js       # Main review script
│   ├── lib/
│   │   └── utils.js       # Utility functions
│   ├── package.json       # Node.js dependencies
│   └── package-lock.json  # Lock file
└── ai-review.yml          # Configuration (optional)
```

### Step 3: Install Dependencies

The action requires Node.js packages. Run this once to generate the lock file:

```bash
cd .github/scripts
npm install
```

Commit the generated `package-lock.json` file.

### Step 4: Verify Permissions

The workflow requires these permissions (already configured in `pr-review.yml`):

```yaml
permissions:
  contents: read        # Read repository content and diffs
  pull-requests: write  # Post reviews and comments on PRs
```

### Step 5: Create Your First PR

The action will automatically run when you:
- Open a new Pull Request
- Push commits to an existing PR
- Reopen a closed PR

You can also trigger manually from the Actions tab (see [Manual Dispatch](#manual-dispatch-testing)).

---

## Detailed Configuration

Create `.github/ai-review.yml` to customize the review behavior. All options are optional - defaults are used for any omitted settings.

### Core Settings

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Global enable/disable for AI reviews |
| `model` | string | `claude-sonnet-4-5-20250929` | Claude model to use. Options: `claude-sonnet-4-5-20250929`, `claude-opus-4-5-20251101` |
| `maxTokens` | number | `4096` | Maximum tokens for Claude's response |
| `temperature` | number | `0` | API temperature. `0` = deterministic/consistent, `1` = creative. Lower values produce more consistent severity ratings |
| `chunkSize` | number | `100000` | Maximum characters per chunk. Larger diffs are split into multiple API calls |
| `maxFilesPerReview` | number | `50` | Maximum files to review per PR. Prevents excessive API usage on large PRs |

### Review Areas

Configure which aspects of code to review:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `reviewAreas.codeQuality` | boolean | `true` | Clean code principles, readability, maintainability, DRY, SOLID |
| `reviewAreas.security` | boolean | `true` | Vulnerabilities, injection risks, authentication issues, data exposure |
| `reviewAreas.documentation` | boolean | `true` | Code comments, function documentation, clarity |
| `reviewAreas.testCoverage` | boolean | `true` | Test coverage gaps, edge cases, test quality |
| `reviewAreas.conventions` | boolean | `true` | Language-specific best practices and style guidelines |

### Language Support

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `languages` | array | `['csharp', 'typescript', 'python']` | Languages for specialized feedback. Used for tailored review prompts and import detection |

### Ignore Patterns

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ignorePatterns` | array | See below | Glob patterns for files to exclude from review |

**Default Ignore Patterns:**
```yaml
ignorePatterns:
  - "*.lock"
  - "package-lock.json"
  - "yarn.lock"
  - "pnpm-lock.yaml"
  - "*.min.js"
  - "*.min.css"
  - "*.map"
  - "dist/**"
  - "build/**"
  - "out/**"
  - "node_modules/**"
  - ".git/**"
  - "*.generated.cs"
  - "*.Designer.cs"
  - "Migrations/**"
```

### Severity Filtering

Control which severity levels appear in reviews:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `severity.critical` | boolean | `true` | Security issues, bugs causing failures, data loss risks |
| `severity.warning` | boolean | `true` | Potential bugs, performance issues, significant quality problems |
| `severity.suggestion` | boolean | `true` | Improvements for maintainability or readability |
| `severity.nitpick` | boolean | `false` | Minor style issues, optional improvements |

### PR Size Warning

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `prSizeWarning.enabled` | boolean | `true` | Enable PR size warnings |
| `prSizeWarning.maxLines` | number | `1000` | Warn if total changed lines exceed this number |
| `prSizeWarning.maxFiles` | number | `30` | Warn if number of files exceed this number |

### Review Caching

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `caching.enabled` | boolean | `true` | Skip re-review if the same commit was already reviewed |

### Custom Instructions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `customInstructions.enabled` | boolean | `true` | Parse `<!-- ai-review: instructions -->` from PR description |

### Inline Ignore

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `inlineIgnore.enabled` | boolean | `true` | Enable inline ignore comments in code |
| `inlineIgnore.patterns` | array | See below | Patterns to detect ignore comments |

**Default Inline Ignore Patterns:**
```yaml
inlineIgnore:
  patterns:
    - "ai-review-ignore"           # Skip this specific line
    - "ai-review-ignore-next-line" # Skip the next line
    - "ai-review-ignore-file"      # Skip the entire file
```

### Metrics and Analytics

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `metrics.enabled` | boolean | `true` | Enable metrics collection |
| `metrics.showInSummary` | boolean | `true` | Show metrics in GitHub Actions Summary |
| `metrics.showInComment` | boolean | `true` | Show metrics in PR review comment |

### Feedback Loop

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `feedbackLoop.enabled` | boolean | `true` | Track emoji reactions on comments to measure effectiveness |

### Contextual Awareness

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `contextualAwareness.enabled` | boolean | `true` | Read related files for more accurate reviews |
| `contextualAwareness.maxRelatedFiles` | number | `5` | Maximum number of related files to read |
| `contextualAwareness.includeImports` | boolean | `true` | Include files that are imported/required by changed files |
| `contextualAwareness.includeTests` | boolean | `false` | Include test files for the changed files |
| `contextualAwareness.includeSimilarFiles` | boolean | `false` | Include files with similar names |

### Auto-fix PRs

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoFix.enabled` | boolean | `false` | Automatically create separate PRs with suggested fixes (disabled by default for safety) |
| `autoFix.createSeparatePR` | boolean | `true` | Create fixes in a separate PR instead of committing to the same branch |
| `autoFix.requireApproval` | boolean | `true` | Require manual approval before creating the fix PR |
| `autoFix.branchPrefix` | string | `ai-fix/` | Branch name prefix for auto-fix branches |

### Severity Threshold

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `severityThreshold.enabled` | boolean | `false` | Enable severity filtering for comments |
| `severityThreshold.minSeverityToComment` | string | `warning` | Minimum severity level to post comments. Options: `critical`, `warning`, `suggestion`, `nitpick` |
| `severityThreshold.skipCleanPRs` | boolean | `false` | Skip posting review entirely if no issues above threshold |

### Complete Configuration Example

```yaml
# .github/ai-review.yml

# Core Settings
enabled: true
model: claude-sonnet-4-5-20250929
maxTokens: 4096
temperature: 0
chunkSize: 100000
maxFilesPerReview: 50

# Review Focus Areas
reviewAreas:
  codeQuality: true
  security: true
  documentation: true
  testCoverage: true
  conventions: true

# Language Support
languages:
  - csharp
  - typescript
  - python

# Files to Ignore
ignorePatterns:
  - "*.lock"
  - "package-lock.json"
  - "dist/**"
  - "*.min.js"
  - "node_modules/**"

# Severity Levels
severity:
  critical: true
  warning: true
  suggestion: true
  nitpick: false

# PR Size Warning
prSizeWarning:
  enabled: true
  maxLines: 1000
  maxFiles: 30

# Review Caching
caching:
  enabled: true

# Custom Instructions
customInstructions:
  enabled: true

# Inline Ignore
inlineIgnore:
  enabled: true
  patterns:
    - "ai-review-ignore"
    - "ai-review-ignore-next-line"
    - "ai-review-ignore-file"

# Metrics
metrics:
  enabled: true
  showInSummary: true
  showInComment: true

# Feedback Loop
feedbackLoop:
  enabled: true

# Contextual Awareness
contextualAwareness:
  enabled: true
  maxRelatedFiles: 5
  includeImports: true
  includeTests: false
  includeSimilarFiles: false

# Auto-fix (disabled by default)
autoFix:
  enabled: false
  createSeparatePR: true
  requireApproval: true
  branchPrefix: 'ai-fix/'

# Severity Threshold
severityThreshold:
  enabled: false
  minSeverityToComment: 'warning'
  skipCleanPRs: false
```

---

## Detailed Implemented Features

### 1. Automated Code Review

**What it does:** Automatically triggers AI-powered code reviews when Pull Requests are opened, updated, or reopened.

**How it works:**
1. The workflow listens for PR events: `opened`, `synchronize` (new commits), and `reopened`
2. Fetches the unified diff of all changes using GitHub CLI
3. Filters out ignored files based on configuration
4. Sends the diff to Claude API with specialized review prompts
5. Posts the review as inline comments and a summary comment

**Trigger Events:**
| Event | Description |
|-------|-------------|
| `opened` | A new PR is created |
| `synchronize` | New commits are pushed to an existing PR |
| `reopened` | A previously closed PR is reopened |

---

### 2. Manual Dispatch (Testing)

**What it does:** Allows you to manually trigger a review on any PR from the GitHub Actions UI.

**How it works:**
1. Go to **Actions** → **AI PR Review** → **Run workflow**
2. Enter the PR number you want to review
3. Click **Run workflow**

**Use Cases:**
- Re-run a review after fixing issues
- Test the review system on specific PRs
- Review PRs that were created before the action was installed

**Implementation Details:**
- Uses `workflow_dispatch` trigger with required `pr_number` input
- Fetches PR metadata dynamically using GitHub CLI
- Bypasses skip conditions (labels, title prefixes)

---

### 3. Skip Review Mechanisms

**What it does:** Allows developers to skip AI reviews for specific PRs.

**Methods:**

| Method | How to Use | When to Use |
|--------|------------|-------------|
| Label | Add `skip-ai-review` label to PR | Urgent hotfixes, trivial changes |
| Title Prefix | Start PR title with `[no-review]` | WIP PRs, documentation-only changes |
| Config | Set `enabled: false` in config | Disable for entire repository |

**Example:**
```
[no-review] Update README formatting
```

---

### 4. Review Caching

**What it does:** Skips redundant reviews when the same commit has already been reviewed.

**How it works:**
1. Uses GitHub Actions cache to store reviewed commit SHAs
2. Cache key format: `ai-review-{pr_number}-{head_sha}`
3. Before reviewing, checks if the current commit SHA exists in cache
4. If found, skips the entire review process

**Benefits:**
- Saves API costs on re-runs
- Faster workflow execution
- Reduces noise from duplicate reviews

**Configuration:**
```yaml
caching:
  enabled: true  # default
```

---

### 5. Comment Threading and Deduplication

**What it does:** Prevents duplicate comments when a review is re-run on the same code.

**How it works:**
1. Before posting, fetches all existing AI review comments on the PR
2. Identifies AI comments by the marker `<!-- ai-pr-review -->`
3. For each new comment, checks if one already exists at the same file:line
4. Skips posting duplicate comments

**Benefits:**
- Clean PR comment history
- No spam from multiple review runs
- Easier to track which issues are new

---

### 6. Custom Review Instructions

**What it does:** Allows PR authors to guide the AI review focus using special comments in the PR description.

**How it works:**
1. Add an HTML comment in your PR description: `<!-- ai-review: your instructions -->`
2. The instructions are extracted and added to Claude's system prompt
3. Claude prioritizes the specified areas in its review

**Example:**
```markdown
## Description
This PR adds user authentication.

<!-- ai-review: Focus on security vulnerabilities, especially SQL injection and XSS. Also check for proper password hashing. -->

## Changes
- Added login endpoint
- Added session management
```

**Use Cases:**
- Security-focused reviews for sensitive code
- Performance focus for optimization PRs
- Specific framework/library expertise requests

---

### 7. Inline Ignore Comments

**What it does:** Allows developers to exclude specific lines or files from AI review using code comments.

**Patterns:**

| Pattern | Effect | Scope |
|---------|--------|-------|
| `ai-review-ignore` | Skips the current line | Single line |
| `ai-review-ignore-next-line` | Skips the next line | Single line |
| `ai-review-ignore-file` | Skips the entire file | Whole file |

**Examples:**

```typescript
// Skip a single line
const legacyHack = doSomethingWeird(); // ai-review-ignore

// Skip the next line
// ai-review-ignore-next-line
const deprecatedFunction = oldLibrary.method();

// Skip entire file (add at top of file)
// ai-review-ignore-file
// This file contains auto-generated code
```

**Configuration:**
```yaml
inlineIgnore:
  enabled: true
  patterns:
    - "ai-review-ignore"
    - "ai-review-ignore-next-line"
    - "ai-review-ignore-file"
```

---

### 8. PR Size Warning

**What it does:** Alerts reviewers when PRs exceed recommended size thresholds.

**How it works:**
1. Calculates total changed lines (additions + deletions)
2. Counts total number of changed files
3. Compares against configured thresholds
4. Adds a warning section to the review summary if exceeded

**Default Thresholds:**
- Maximum lines: 1,000
- Maximum files: 30

**Warning Example:**
```markdown
### ⚠️ PR Size Warning

This PR has **1,547 changed lines**, which exceeds the recommended maximum of 1000 lines.

This PR modifies **45 files**, which exceeds the recommended maximum of 30 files.

**Recommendation**: Consider splitting this PR into smaller, focused changes for easier review and safer merging.
```

**Configuration:**
```yaml
prSizeWarning:
  enabled: true
  maxLines: 1000
  maxFiles: 30
```

---

### 9. Contextual Awareness

**What it does:** Reads related files to provide more accurate and context-aware reviews.

**How it works:**
1. For each changed file, reads its full content
2. Extracts import statements based on language:
   - **TypeScript/JavaScript:** `import ... from '...'`, `require('...')`
   - **Python:** `from X import Y`, `import X`
   - **C#:** `using X;`
3. Resolves import paths to actual file paths
4. Reads imported files (up to `maxRelatedFiles`)
5. Includes related file content in Claude's context (truncated to 2000 chars per file)

**Benefits:**
- Better understanding of code dependencies
- More accurate detection of breaking changes
- Context-aware security analysis
- Understanding of shared utilities and patterns

**Configuration:**
```yaml
contextualAwareness:
  enabled: true
  maxRelatedFiles: 5
  includeImports: true      # Include imported files
  includeTests: false       # Include test files
  includeSimilarFiles: false # Include similarly named files
```

---

### 10. Feedback Loop

**What it does:** Tracks emoji reactions on review comments to measure the AI's effectiveness.

**How it works:**
1. Fetches existing AI review comments and their reactions
2. Categorizes reactions:
   - **Positive:** 👍, ❤️, 🚀, 👏
   - **Negative:** 👎, 😕
3. Calculates approval rate: `(positive / total) * 100%`
4. Writes feedback summary to GitHub Actions Summary

**Feedback Summary Example:**
```markdown
## 📊 AI Review Feedback

| Metric | Value |
|--------|-------|
| 👍 Positive reactions | 12 |
| 👎 Negative reactions | 2 |
| Approval rate | 85.7% |
```

**How to Provide Feedback:**
- React to helpful comments with 👍, ❤️, 🚀, or 👏
- React to unhelpful comments with 👎 or 😕
- Feedback is aggregated across all comments

---

### 11. Auto-fix PRs

**What it does:** Automatically creates a separate PR with suggested code fixes from the review.

**How it works:**
1. Collects all `suggestedCode` from Claude's review comments
2. Groups fixes by file
3. Creates a new git branch: `ai-fix/pr-{number}-{timestamp}`
4. Applies fixes to files (replaces entire lines)
5. Commits with message: `fix: Auto-fix AI review suggestions for PR #{number}`
6. Pushes branch and creates a new PR targeting the original PR's head branch

**Safety Features:**
- **Disabled by default** - must explicitly enable
- **Separate PR** - doesn't modify original branch
- **Review required** - human must approve and merge
- **Timeouts** - git operations have 30s/120s timeouts
- **Rollback** - automatically cleans up on failure

**Configuration:**
```yaml
autoFix:
  enabled: true           # Enable the feature
  createSeparatePR: true  # Always create separate PR
  requireApproval: true   # Require human approval
  branchPrefix: 'ai-fix/' # Branch naming
```

**Workflow:**
1. AI review identifies issues with suggested fixes
2. Auto-fix PR is created with all fixes applied
3. Developer reviews the fix PR
4. If approved, merge fix PR into feature branch
5. Original PR is updated with fixes

---

### 12. Severity Threshold

**What it does:** Filters review comments based on minimum severity level.

**Severity Hierarchy:**
```
nitpick < suggestion < warning < critical
```

**How it works:**
1. All comments are generated by Claude with severity levels
2. Comments below the threshold are filtered out before posting
3. Optionally skip posting review entirely if no significant issues found

**Configuration:**
```yaml
severityThreshold:
  enabled: true
  minSeverityToComment: 'warning'  # Only post warning and critical
  skipCleanPRs: true               # Don't post if no issues found
```

**Use Cases:**
- Reduce noise on well-written code
- Focus on critical issues only for large PRs
- Skip reviews on PRs with only nitpicks

---

### 13. Large PR Handling (Diff Chunking)

**What it does:** Automatically splits large diffs into manageable chunks for API processing.

**How it works:**
1. Checks if diff exceeds `chunkSize` (default: 100,000 characters)
2. Splits diff at file boundaries (never splits a file across chunks)
3. Sends separate API requests for each chunk
4. Waits 2 seconds between chunks to avoid rate limits
5. Combines all results into a single review

**Benefits:**
- Handles PRs of any size
- Prevents API token limit errors
- Maintains file integrity in reviews
- Built-in rate limit protection

**Configuration:**
```yaml
chunkSize: 100000       # Characters per chunk
maxFilesPerReview: 50   # Max files to review
```

---

### 14. Metrics and Analytics

**What it does:** Tracks comprehensive metrics about each review run.

**Metrics Tracked:**

| Category | Metrics |
|----------|---------|
| Performance | Review duration, API calls, tokens used |
| Content | Files reviewed, lines analyzed, comments posted |
| Issues | Critical/warning/suggestion counts |
| Features | Cache hits, related files read, auto-fix created |

**Output Locations:**
- **GitHub Actions Summary** - Detailed table visible in workflow run
- **PR Review Comment** - Summary in the review (if enabled)

**Example Summary:**
```markdown
### 📊 Review Metrics
| Metric | Value |
|--------|-------|
| Files reviewed | 12 |
| Lines analyzed | 847 |
| API calls | 1 |
| Review time | 8.3s |
```

**Configuration:**
```yaml
metrics:
  enabled: true
  showInSummary: true   # GitHub Actions Summary
  showInComment: true   # PR review comment
```

---

### 15. Stale Review Detection

**What it does:** Detects when previously identified critical issues have been resolved.

**How it works:**
1. Fetches previous AI reviews that requested changes
2. Compares critical issue count in new review vs previous reviews
3. If previous reviews had `REQUEST_CHANGES` but current has 0 critical issues, marks as resolved
4. Adds notification to review summary

**Example:**
```markdown
✅ **Previous critical issues appear to be resolved!**
```

---

### 16. Multi-Language Support

**What it does:** Provides language-specific review feedback and import detection.

**Supported Languages:**

| Language | Extensions | Import Detection |
|----------|------------|------------------|
| C# | `.cs`, `.csx` | `using X;` statements |
| TypeScript | `.ts`, `.tsx` | `import ... from`, `require()` |
| JavaScript | `.js`, `.jsx` | `import ... from`, `require()` |
| Python | `.py`, `.pyw`, `.pyi` | `from X import Y`, `import X` |

**Benefits:**
- Tailored review prompts per language
- Accurate import/dependency detection
- Language-specific best practice suggestions

---

### 17. Exponential Backoff and Retry

**What it does:** Handles API rate limits gracefully with automatic retries.

**How it works:**
1. Wraps all API calls with retry logic
2. Detects rate limiting (HTTP 429 or "rate" in error)
3. Retries up to 3 times with exponential backoff:
   - 1st retry: 1 second delay
   - 2nd retry: 2 seconds delay
   - 3rd retry: 4 seconds delay (max 30 seconds)
4. Continues with review if successful, fails if all retries exhausted

**Applied to:**
- Claude API calls
- GitHub API calls (reviews, reactions, comments)

---

### 18. Input Validation and Security

**What it does:** Validates all inputs to prevent security issues.

**Validators:**

| Input | Validation | Purpose |
|-------|------------|---------|
| PR Number | Positive integer | Prevent injection |
| Repo Owner | GitHub username pattern | Validate format |
| Repo Name | 1-100 valid characters | Validate format |
| Git SHA | 7-40 hex characters | Validate format |
| Branch Name | Sanitize shell characters | Prevent command injection |

**Security Benefits:**
- Prevents command injection in git operations
- Validates all GitHub API inputs
- Clear error messages for debugging
- Maximum length limits enforced

---

### 19. Error Handling and Recovery

**What it does:** Provides graceful error handling with user-friendly messages.

**On Failure:**
1. Posts a comment explaining the failure
2. Suggests troubleshooting steps
3. Provides options to retry or skip

**Error Comment Example:**
```markdown
⚠️ **AI Review Failed**

The automated code review encountered an error. Please check the workflow logs for details.

You can:
- Re-run the workflow from the Actions tab
- Add the `skip-ai-review` label to skip automated review
- Prefix your PR title with `[no-review]` to skip review
```

---

## Review Output

### Summary Comment

Every PR receives a summary comment with:
- Overall recommendation (APPROVE, REQUEST_CHANGES, COMMENT)
- PR size warnings (if applicable)
- Findings table by severity
- Strengths and concerns lists
- Review metrics (if enabled)

```markdown
## 🤖 AI Code Review Summary

✅ **Recommendation**: APPROVE

### Overview
The changes implement a clean and well-structured authentication module...

### Findings
| Severity | Count |
|----------|-------|
| 🔴 Critical | 0 |
| 🟡 Warning | 2 |
| 🔵 Suggestion | 5 |
| ⚪ Nitpick | 0 |

### ✨ Strengths
- Good separation of concerns
- Proper error handling
- Clear function naming

### ⚠️ Areas of Concern
- Missing input validation on user data
- Consider adding rate limiting
```

### Inline Comments

Comments are posted directly on relevant lines with:
- Severity emoji (🔴 critical, 🟡 warning, 🔵 suggestion, ⚪ nitpick)
- Category emoji (🔒 security, ✨ quality, 📝 docs, 🧪 testing, 📏 convention)
- Detailed explanation
- Code suggestion (when applicable)

```markdown
🟡 ✨ **WARNING** (quality)

This function has a cyclomatic complexity of 15. Consider breaking it into smaller functions for better maintainability.

```suggestion
// Extract validation logic
function validateInput(data) {
  // validation logic here
}
```
```

---

## Troubleshooting

### "AI Review Failed" Comment

Check the following:

1. **API Key**: Ensure `ANTHROPIC_API_KEY` is correctly set in repository secrets
2. **Permissions**: Workflow needs `contents: read` and `pull-requests: write`
3. **Rate Limits**: Large PRs may hit API rate limits; try a smaller PR
4. **Logs**: Check the Actions tab for detailed error messages

### No Comments Appearing

- Verify the diff contains reviewable files (not just lock files)
- Check if all comments were filtered by severity settings
- Ensure the PR has changes in supported file types
- Check if `enabled: false` is set in config

### Comments on Wrong Lines

This can happen when:
- The diff position calculation doesn't match GitHub's expectations
- The file was modified between review runs
- The line is not part of the diff (only added/changed lines can have comments)

---

## Development

### Project Structure

```
.github/
├── scripts/
│   ├── lib/
│   │   ├── utils.js       # Testable utility functions
│   │   └── utils.test.js  # Unit tests (120 tests)
│   ├── review-pr.js       # Main review script (~1700 lines)
│   └── package.json       # Dependencies and scripts
├── workflows/
│   └── pr-review.yml      # GitHub Action workflow
└── ai-review.yml          # Configuration file
```

### Running Tests

```bash
cd .github/scripts
npm test           # Run all tests
npm run test:watch # Run tests in watch mode
```

### Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@anthropic-ai/sdk` | ^0.32.1 | Claude API client |
| `@octokit/rest` | ^21.0.2 | GitHub API client |
| `js-yaml` | ^4.1.0 | YAML configuration parsing |

### API Usage and Costs

- **Model**: Uses `claude-sonnet-4-5-20250929` by default
- **Tokens**: Default max 4096 tokens per response
- **Chunking**: Large diffs split to avoid token limits
- **Rate Limiting**: Built-in exponential backoff

**Typical Costs (approximate):**
| PR Size | Lines Changed | Estimated Cost |
|---------|---------------|----------------|
| Small | < 500 | $0.01-0.03 |
| Medium | 500-2000 | $0.05-0.15 |
| Large | 2000+ | $0.15-0.50+ |

