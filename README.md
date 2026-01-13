# AI PR Reviewer with Claude

Automatically review Pull Requests using Anthropic's Claude AI. This GitHub Action analyzes code changes and provides comprehensive feedback on code quality, security, documentation, and best practices.

## Features

- **Automated Code Review**: Triggers automatically on PR events (opened, synchronize, reopened)
- **Inline Comments**: Posts specific feedback directly on relevant lines
- **Summary Reports**: Provides an overall assessment with strengths and concerns
- **Multi-Language Support**: Specialized feedback for C#, TypeScript, and Python
- **Configurable**: Customize review focus, severity levels, and ignored files
- **Large PR Handling**: Automatically chunks large diffs for processing
- **Skip Options**: Disable reviews with labels or title prefixes

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
```

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

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a Pull Request (it will be reviewed by this action!)

## License

MIT License - see LICENSE file for details.
