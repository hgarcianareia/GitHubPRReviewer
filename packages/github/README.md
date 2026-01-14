# AI PR Review - GitHub

GitHub Actions adapter for AI-powered PR reviews using Anthropic's Claude.

## Quick Setup

### Step 1: Add Repository Secret

1. Go to your repository **Settings** > **Secrets and variables** > **Actions**
2. Click **New repository secret**
3. Name: `ANTHROPIC_API_KEY`
4. Value: Your Anthropic API key ([get one here](https://console.anthropic.com))

### Step 2: Create Workflow File

Create `.github/workflows/pr-review.yml`:

```yaml
name: AI PR Review

on:
  pull_request:
    types: [opened, synchronize, reopened]
  workflow_dispatch:
    inputs:
      pr_number:
        description: 'PR number to review'
        required: true

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: AI Review
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: npx ai-pr-review-github
```

### Step 3: Create Your First PR

The action automatically runs when you:
- Open a new Pull Request
- Push commits to an existing PR
- Reopen a closed PR

You can also trigger manually from **Actions** > **AI PR Review** > **Run workflow**.

## Configuration

Create `.github/ai-review.yml` to customize behavior. All options are optional.

### Core Settings

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Enable/disable AI reviews |
| `model` | `claude-sonnet-4-5-20250929` | Claude model (`claude-sonnet-4-5-20250929` or `claude-opus-4-5-20251101`) |
| `maxTokens` | `4096` | Maximum response tokens |
| `temperature` | `0` | API temperature (0=deterministic, 1=creative) |
| `chunkSize` | `100000` | Max characters per API call |
| `maxFilesPerReview` | `50` | Max files to review per PR |

### Review Areas

| Option | Default | Description |
|--------|---------|-------------|
| `reviewAreas.codeQuality` | `true` | Clean code, readability, DRY, SOLID |
| `reviewAreas.security` | `true` | Vulnerabilities, injection risks |
| `reviewAreas.documentation` | `true` | Comments, function docs |
| `reviewAreas.testCoverage` | `true` | Test gaps, edge cases |
| `reviewAreas.conventions` | `true` | Language best practices |

### Severity Filtering

| Option | Default | Description |
|--------|---------|-------------|
| `severity.critical` | `true` | Security issues, bugs |
| `severity.warning` | `true` | Potential problems |
| `severity.suggestion` | `true` | Improvements |
| `severity.nitpick` | `false` | Minor style issues |

### Ignore Patterns

```yaml
ignorePatterns:
  - "*.lock"
  - "package-lock.json"
  - "yarn.lock"
  - "*.min.js"
  - "dist/**"
  - "node_modules/**"
```

### PR Size Warning

| Option | Default | Description |
|--------|---------|-------------|
| `prSizeWarning.enabled` | `true` | Enable PR size warnings |
| `prSizeWarning.maxLines` | `1000` | Warn if lines exceed this |
| `prSizeWarning.maxFiles` | `30` | Warn if files exceed this |

### Caching

| Option | Default | Description |
|--------|---------|-------------|
| `caching.enabled` | `true` | Skip re-review of same commit |

### Contextual Awareness

| Option | Default | Description |
|--------|---------|-------------|
| `contextualAwareness.enabled` | `true` | Read related files |
| `contextualAwareness.maxRelatedFiles` | `5` | Max related files to read |
| `contextualAwareness.includeImports` | `true` | Include imported files |
| `contextualAwareness.includeTests` | `false` | Include test files |

### Auto-fix PRs

| Option | Default | Description |
|--------|---------|-------------|
| `autoFix.enabled` | `false` | Create fix PRs automatically |
| `autoFix.createSeparatePR` | `true` | Create fixes in separate PR |
| `autoFix.branchPrefix` | `ai-fix/` | Branch prefix for fixes |

### Custom Instructions

| Option | Default | Description |
|--------|---------|-------------|
| `customInstructions.enabled` | `true` | Parse `<!-- ai-review: -->` from PR description |

### Inline Ignore

| Option | Default | Description |
|--------|---------|-------------|
| `inlineIgnore.enabled` | `true` | Enable inline ignore comments |

### Metrics

| Option | Default | Description |
|--------|---------|-------------|
| `metrics.enabled` | `true` | Enable metrics collection |
| `metrics.showInSummary` | `true` | Show in Actions Summary |
| `metrics.showInComment` | `true` | Show in PR comment |

### Full Configuration Example

```yaml
# .github/ai-review.yml

enabled: true
model: claude-sonnet-4-5-20250929
maxTokens: 4096
temperature: 0

reviewAreas:
  codeQuality: true
  security: true
  documentation: true
  testCoverage: true
  conventions: true

languages:
  - typescript
  - python
  - csharp

ignorePatterns:
  - "*.lock"
  - "package-lock.json"
  - "dist/**"
  - "node_modules/**"

severity:
  critical: true
  warning: true
  suggestion: true
  nitpick: false

prSizeWarning:
  enabled: true
  maxLines: 1000
  maxFiles: 30

caching:
  enabled: true

contextualAwareness:
  enabled: true
  maxRelatedFiles: 5
  includeImports: true

autoFix:
  enabled: false
  createSeparatePR: true
  branchPrefix: 'ai-fix/'

metrics:
  enabled: true
  showInSummary: true
  showInComment: true
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Yes | Provided automatically by Actions |
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |

## Skip Review

Skip AI review for specific PRs:

| Method | How to Use |
|--------|------------|
| Label | Add `skip-ai-review` label to PR |
| Title | Start PR title with `[no-review]` |
| Config | Set `enabled: false` in config |

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

Add instructions in your PR description:

```markdown
## Description
Adding authentication module.

<!-- ai-review: Focus on security vulnerabilities, especially SQL injection and XSS. Check for proper password hashing. -->
```

## Programmatic Usage

For custom integrations, install the package directly:

```bash
npm install @hgarcianareia/ai-pr-review-github
```

```javascript
import { ReviewEngine } from '@hgarcianareia/ai-pr-review-core';
import { GitHubAdapter } from '@hgarcianareia/ai-pr-review-github';

const adapter = await GitHubAdapter.create();
const engine = new ReviewEngine({
  platformAdapter: adapter,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY
});

const result = await engine.run();

if (result.skipped) {
  console.log(`Skipped: ${result.reason}`);
} else {
  console.log('Review completed');
}
```

## Troubleshooting

### "AI Review Failed" Comment

1. Check `ANTHROPIC_API_KEY` is set correctly in repository secrets
2. Verify workflow has `contents: read` and `pull-requests: write` permissions
3. Check Actions logs for detailed error messages

### No Comments Appearing

- Verify diff contains reviewable files (not just lock files)
- Check if all comments were filtered by severity settings
- Ensure `enabled: true` in config

### Comments on Wrong Lines

This can happen when:
- File was modified between review runs
- Line is not part of the diff (only changed lines can have comments)

## License

MIT
