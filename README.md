# AI PR Reviewer with Claude

Automatically review Pull Requests using Anthropic's Claude AI. This GitHub Action analyzes code changes and provides comprehensive feedback on code quality, security, documentation, and best practices.

## Features

### Core Features
- **Automated Code Review**: Triggers automatically on PR events (opened, synchronize, reopened)
- **Inline Comments**: Posts specific feedback directly on relevant lines
- **Summary Reports**: Provides an overall assessment with strengths and concerns
- **Multi-Language Support**: Specialized feedback for C#, TypeScript, and Python
- **Configurable**: Customize review focus, severity levels, and ignored files
- **Large PR Handling**: Automatically chunks large diffs for processing
- **Skip Options**: Disable reviews with labels or title prefixes

### Advanced Features
- **Review Caching**: Skips re-review if the commit has already been reviewed
- **Comment Threading**: Updates existing comments instead of creating duplicates
- **PR Size Warnings**: Alerts when PRs exceed recommended size thresholds
- **Custom Instructions**: Authors can request specific review focus via PR description
- **File-Level Ignores**: Skip specific lines/files with `ai-review-ignore` comments
- **Metrics & Analytics**: Tracks review performance and displays in GitHub Actions Summary

### High-Impact Features
- **Feedback Loop**: Tracks emoji reactions on review comments to measure effectiveness
- **Contextual Awareness**: Reads imported/related files for more accurate reviews
- **Auto-fix PRs**: Can automatically create separate PRs with suggested fixes (disabled by default)
- **Severity Threshold**: Optionally skip posting reviews for "clean" PRs with only minor issues

## Quick Start

### 1. Add the API Key Secret

1. Go to your repository **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `ANTHROPIC_API_KEY`
4. Value: Your Anthropic API key (get one at https://console.anthropic.com)

### 2. Install Dependencies

The action requires Node.js packages. Run this once to generate the lock file:

```bash
cd .github/scripts
npm install
```

Commit the generated `package-lock.json` file.

### 3. Create Your First PR

The action will automatically run when you:
- Open a new Pull Request
- Push commits to an existing PR
- Reopen a closed PR

## Configuration

### Skipping Reviews

You can skip the AI review in several ways:

1. **Label**: Add the `skip-ai-review` label to your PR
2. **Title Prefix**: Start your PR title with `[no-review]`
3. **Config File**: Set `enabled: false` in `.github/ai-review.yml`

### Configuration File

Create or modify `.github/ai-review.yml` to customize the review:

```yaml
# Enable/disable reviews globally
enabled: true

# Claude model to use
model: claude-sonnet-4-5-20250929

# Review focus areas
reviewAreas:
  codeQuality: true
  security: true
  documentation: true
  testCoverage: true
  conventions: true

# Languages for specialized feedback
languages:
  - csharp
  - typescript
  - python

# Files to ignore (glob patterns)
ignorePatterns:
  - "*.lock"
  - "dist/**"
  - "*.min.js"

# Severity levels to show
severity:
  critical: true
  warning: true
  suggestion: true
  nitpick: false  # Hide minor style issues

# PR Size Warning
prSizeWarning:
  enabled: true
  maxLines: 1000
  maxFiles: 30

# Review Caching
caching:
  enabled: true

# Custom Instructions (use <!-- ai-review: focus on X --> in PR description)
customInstructions:
  enabled: true

# File-level ignore comments
inlineIgnore:
  enabled: true
  patterns:
    - "ai-review-ignore"
    - "ai-review-ignore-next-line"
    - "ai-review-ignore-file"

# Metrics and Analytics
metrics:
  enabled: true
  showInSummary: true
  showInComment: true

# Feedback Loop - track reactions on comments
feedbackLoop:
  enabled: true

# Contextual Awareness - read related files
contextualAwareness:
  enabled: true
  maxRelatedFiles: 5
  includeImports: true
  includeTests: false

# Auto-fix PRs (disabled by default)
autoFix:
  enabled: false
  createSeparatePR: true
  branchPrefix: 'ai-fix/'

# Severity Threshold
severityThreshold:
  enabled: false
  minSeverityToComment: 'warning'
  skipCleanPRs: false
```

## Using Advanced Features

### Custom Review Instructions

Add special instructions in your PR description to guide the review:

```markdown
<!-- ai-review: Focus on security vulnerabilities and SQL injection risks -->
```

### Inline Ignore Comments

Skip specific lines from review:

```typescript
// ai-review-ignore-next-line
const legacyCode = doSomethingWeird(); // This line won't be reviewed

const anotherLine = something(); // ai-review-ignore - skip this line too
```

Skip an entire file by adding at the top:
```typescript
// ai-review-ignore-file
```

### Auto-fix PRs

When enabled, the action can automatically create a separate PR with suggested fixes:

1. Set `autoFix.enabled: true` in your config
2. The action will collect all `suggestedCode` from the review
3. A new PR will be created with the fixes applied
4. Review and merge the fix PR into your feature branch

### Feedback Loop

React to review comments with emojis to provide feedback:
- **Helpful**: :+1: :heart: :rocket:
- **Not helpful**: :-1: :confused:

Feedback statistics are displayed in the GitHub Actions Summary.

## Review Output

### Summary Comment

The action posts a summary comment on every PR:

```
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

Inline comments are posted directly on relevant lines:

```
🟡 **WARNING** (security)

User input is used directly in the SQL query. Consider using parameterized
queries to prevent SQL injection:

```csharp
// Instead of:
var query = $"SELECT * FROM users WHERE id = {userId}";

// Use:
var query = "SELECT * FROM users WHERE id = @userId";
cmd.Parameters.AddWithValue("@userId", userId);
```
```

## File Structure

```
.github/
├── workflows/
│   └── pr-review.yml      # GitHub Action workflow
├── scripts/
│   ├── review-pr.js       # Main review script
│   ├── package.json       # Node.js dependencies
│   └── package-lock.json  # Lock file (generated)
└── ai-review.yml          # Configuration (optional)
```

## How It Works

1. **Trigger**: The workflow triggers on PR events
2. **Fetch Diff**: Gets the unified diff of all changes
3. **Filter Files**: Removes ignored files and applies limits
4. **Chunk (if needed)**: Splits large diffs into manageable pieces
5. **Claude Review**: Sends code to Claude API with specialized prompts
6. **Parse Response**: Extracts structured feedback from Claude's response
7. **Post Comments**: Creates a PR review with inline and summary comments

## Troubleshooting

### "AI Review Failed" Comment

If you see this comment, check:

1. **API Key**: Ensure `ANTHROPIC_API_KEY` is set correctly in repository secrets
2. **Permissions**: The workflow needs `contents: read` and `pull-requests: write`
3. **Rate Limits**: Large PRs may hit API rate limits; try a smaller PR
4. **Logs**: Check the Actions tab for detailed error messages

### No Comments Appearing

- Verify the diff contains reviewable files (not just lock files, etc.)
- Check if all comments were filtered by severity settings
- Ensure the PR has changes in supported file types

### Comments on Wrong Lines

This can happen when:
- The diff position calculation doesn't match GitHub's expectations
- The file was modified between review runs

## API Usage and Costs

- **Model**: Uses `claude-sonnet-4-5-20250929` by default (configurable)
- **Tokens**: Default max 4096 tokens per response
- **Chunking**: Large diffs are split to avoid token limits
- **Rate Limiting**: Built-in exponential backoff for rate limits

Typical costs (approximate):
- Small PR (< 500 lines): ~$0.01-0.03
- Medium PR (500-2000 lines): ~$0.05-0.15
- Large PR (2000+ lines): ~$0.15-0.50+

## Security Considerations

- The API key is stored as a GitHub Secret (encrypted)
- The action only reads PR content; it doesn't execute code
- Reviews are posted using the GitHub token with limited permissions
- Consider reviewing the action's permissions in your organization settings

## Development

### Running Tests

The project includes unit tests for critical utility functions:

```bash
cd .github/scripts
npm test           # Run all tests
npm run test:watch # Run tests in watch mode
```

### Project Structure

```
.github/
├── scripts/
│   ├── lib/
│   │   ├── utils.js       # Testable utility functions
│   │   └── utils.test.js  # Unit tests (120 tests)
│   ├── review-pr.js       # Main review script
│   └── package.json       # Dependencies and scripts
├── workflows/
│   └── pr-review.yml      # GitHub Action workflow
└── ai-review.yml          # Configuration file
```

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm test` to ensure tests pass
5. Submit a Pull Request (it will be reviewed by this action!)
