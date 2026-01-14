# AI PR Reviewer

AI-powered Pull Request reviews using Anthropic's Claude. Automatically analyzes code changes and provides feedback on code quality, security, documentation, and best practices.

## Supported Platforms

| Platform | Package | Status |
|----------|---------|--------|
| GitHub | [@hgarcianareia/ai-pr-review-github](https://www.npmjs.com/package/@hgarcianareia/ai-pr-review-github) | Stable |
| Bitbucket Cloud | [@hgarcianareia/ai-pr-review-bitbucket](https://www.npmjs.com/package/@hgarcianareia/ai-pr-review-bitbucket) | Stable |

## Quick Start

Choose your platform:

- **GitHub**: See [GitHub Setup Guide](packages/github/README.md)
- **Bitbucket Cloud**: See [Bitbucket Setup Guide](packages/bitbucket/README.md)

## Features

### Code Analysis
- Security vulnerability detection
- Code quality assessment (DRY, SOLID, readability)
- Documentation review
- Test coverage analysis
- Language-specific best practices

### Smart Review
- Contextual awareness (reads related/imported files)
- Custom review instructions via PR description
- Inline ignore comments (`ai-review-ignore`)
- PR size warnings
- Duplicate comment prevention

### Review States
- **APPROVE**: No critical issues found
- **REQUEST_CHANGES**: Critical issues require attention
- **COMMENT**: Suggestions for improvement

### Auto-fix PRs
Optionally create separate PRs with AI-suggested code fixes (disabled by default).

## Architecture

This is a monorepo with three packages:

```
packages/
├── core/       # Shared review engine and utilities
├── github/     # GitHub Actions adapter
└── bitbucket/  # Bitbucket Pipelines adapter
```

### Core Package

The `@hgarcianareia/ai-pr-review-core` package contains:
- `ReviewEngine` - Main review orchestration
- `PlatformAdapter` - Abstract base class for platform integrations
- Utilities for validation, diff parsing, and configuration

### Platform Adapters

Each platform adapter implements the `PlatformAdapter` interface:

```javascript
import { ReviewEngine } from '@hgarcianareia/ai-pr-review-core';
import { GitHubAdapter } from '@hgarcianareia/ai-pr-review-github';
// or
import { BitbucketAdapter } from '@hgarcianareia/ai-pr-review-bitbucket';

const adapter = await GitHubAdapter.create();
const engine = new ReviewEngine({
  platformAdapter: adapter,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY
});

await engine.run();
```

## Configuration

Create a configuration file in your repository:
- GitHub: `.github/ai-review.yml`
- Bitbucket: `.bitbucket/ai-review.yml`

### Core Settings

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Enable/disable reviews |
| `model` | `claude-sonnet-4-5-20250929` | Claude model to use |
| `maxTokens` | `4096` | Max response tokens |
| `temperature` | `0` | API temperature (0=deterministic) |

### Review Areas

```yaml
reviewAreas:
  codeQuality: true    # Clean code, readability
  security: true       # Vulnerabilities, injection risks
  documentation: true  # Comments, docs
  testCoverage: true   # Test gaps, edge cases
  conventions: true    # Language best practices
```

### Severity Filtering

```yaml
severity:
  critical: true   # Security issues, bugs
  warning: true    # Potential problems
  suggestion: true # Improvements
  nitpick: false   # Minor style issues
```

### Ignore Patterns

```yaml
ignorePatterns:
  - "*.lock"
  - "package-lock.json"
  - "dist/**"
  - "node_modules/**"
```

### Full Configuration Example

See platform-specific READMEs for complete configuration options:
- [GitHub Configuration](packages/github/README.md#configuration)
- [Bitbucket Configuration](packages/bitbucket/README.md#configuration)

## Review Output

### Summary Comment

```markdown
## AI Code Review Summary

**Recommendation**: APPROVE

### Findings
| Severity | Count |
|----------|-------|
| Critical | 0 |
| Warning | 2 |
| Suggestion | 5 |

### Strengths
- Good separation of concerns
- Proper error handling

### Areas of Concern
- Missing input validation
```

### Inline Comments

Comments are posted on specific lines with:
- Severity indicator
- Category (security, quality, docs, testing)
- Detailed explanation
- Code suggestion (when applicable)

## Skip Review

Skip AI review for specific PRs:

| Method | How |
|--------|-----|
| Label | Add `skip-ai-review` label |
| Title | Start with `[no-review]` |
| Config | Set `enabled: false` |

## Inline Ignore

Exclude specific code from review:

```javascript
// Skip this line
const hack = doSomething(); // ai-review-ignore

// Skip next line
// ai-review-ignore-next-line
const deprecated = oldMethod();

// Skip entire file (at top)
// ai-review-ignore-file
```

## Custom Instructions

Guide the AI focus via PR description:

```markdown
## Description
Adding authentication module.

<!-- ai-review: Focus on security vulnerabilities, especially SQL injection and XSS. -->
```

## Development

### Prerequisites
- Node.js >= 20.0.0
- npm

### Install Dependencies

```bash
npm install
```

### Run Tests

```bash
npm test              # All packages
npm run test:core     # Core only
npm run test:github   # GitHub only
npm run test:bitbucket # Bitbucket only
```

### Publish Packages

```bash
npm run publish:all   # Publish all packages
```

## API Costs

| PR Size | Lines | Estimated Cost |
|---------|-------|----------------|
| Small | < 500 | $0.01-0.03 |
| Medium | 500-2000 | $0.05-0.15 |
| Large | 2000+ | $0.15-0.50+ |

## License

MIT
