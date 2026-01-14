# AI PR Review - Bitbucket Cloud

Bitbucket Pipelines adapter for AI-powered PR reviews using Anthropic's Claude.

## Quick Setup

### Step 1: Create App Password

1. Go to **Personal Settings** > **App passwords** in Bitbucket
2. Click **Create app password**
3. Name: `AI PR Review`
4. Permissions:
   - **Repositories**: Read
   - **Pull requests**: Read and Write
5. Copy the generated password

### Step 2: Add Repository Variables

1. Go to your repository **Settings** > **Repository variables**
2. Add these variables (mark as **Secured**):

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key ([get one here](https://console.anthropic.com)) |
| `BITBUCKET_USERNAME` | Your Bitbucket username (the one you created the App Password with) |
| `BITBUCKET_TOKEN` | The App Password you created in Step 1 |

### Step 3: Create Pipeline File

Create `bitbucket-pipelines.yml` in your repository root:

```yaml
image: node:20

pipelines:
  pull-requests:
    '**':
      - step:
          name: AI PR Review
          caches:
            - npm
          script:
            - npm install @hgarcianareia/ai-pr-review-bitbucket@latest

            # Fetch PR data
            - |
              curl -s -u "${BITBUCKET_USERNAME}:${BITBUCKET_TOKEN}" \
                "https://api.bitbucket.org/2.0/repositories/${BITBUCKET_WORKSPACE}/${BITBUCKET_REPO_SLUG}/pullrequests/${BITBUCKET_PR_ID}/diff" \
                > pr_diff.txt

              curl -s -u "${BITBUCKET_USERNAME}:${BITBUCKET_TOKEN}" \
                "https://api.bitbucket.org/2.0/repositories/${BITBUCKET_WORKSPACE}/${BITBUCKET_REPO_SLUG}/pullrequests/${BITBUCKET_PR_ID}/diffstat" \
                | jq -r '.values[].new.path // .values[].old.path' > changed_files.txt

              curl -s -u "${BITBUCKET_USERNAME}:${BITBUCKET_TOKEN}" \
                "https://api.bitbucket.org/2.0/repositories/${BITBUCKET_WORKSPACE}/${BITBUCKET_REPO_SLUG}/pullrequests/${BITBUCKET_PR_ID}/comments" \
                > pr_comments.json

            # Check for skip flag
            - |
              PR_TITLE=$(curl -s -u "${BITBUCKET_USERNAME}:${BITBUCKET_TOKEN}" \
                "https://api.bitbucket.org/2.0/repositories/${BITBUCKET_WORKSPACE}/${BITBUCKET_REPO_SLUG}/pullrequests/${BITBUCKET_PR_ID}" \
                | jq -r '.title')

              if echo "$PR_TITLE" | grep -qi "skip-ai-review"; then
                echo "Skipping AI review"
                exit 0
              fi

            # Run review
            - npx ai-pr-review-bitbucket

          artifacts:
            - pr_diff.txt
            - changed_files.txt
            - pr_comments.json
```

### Step 4: Create Your First PR

The pipeline automatically runs when you:
- Open a new Pull Request
- Push commits to an existing PR

## Configuration

Create `.bitbucket/ai-review.yml` to customize behavior. All options are optional.

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

### Full Configuration Example

```yaml
# .bitbucket/ai-review.yml

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
  - java

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
```

## Environment Variables

| Variable | Required | Source | Description |
|----------|----------|--------|-------------|
| `BITBUCKET_WORKSPACE` | Yes | Built-in | Workspace slug (automatic) |
| `BITBUCKET_REPO_SLUG` | Yes | Built-in | Repository slug (automatic) |
| `BITBUCKET_PR_ID` | Yes | Built-in | PR number (automatic) |
| `BITBUCKET_COMMIT` | Yes | Built-in | Commit SHA (automatic) |
| `BITBUCKET_USERNAME` | Yes | Manual | Your Bitbucket username |
| `BITBUCKET_TOKEN` | Yes | Manual | App Password |
| `ANTHROPIC_API_KEY` | Yes | Manual | Anthropic API key |

## Review States

The adapter supports Bitbucket's review states:

| State | When Used |
|-------|-----------|
| **APPROVE** | No critical issues found |
| **REQUEST_CHANGES** | Critical issues require attention |

## Skip Review

Skip AI review for specific PRs:

| Method | How to Use |
|--------|------------|
| Title | Include `skip-ai-review` in PR title |
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

## Programmatic Usage

For custom integrations, install the package directly:

```bash
npm install @hgarcianareia/ai-pr-review-bitbucket
```

```javascript
import { ReviewEngine } from '@hgarcianareia/ai-pr-review-core';
import { BitbucketAdapter } from '@hgarcianareia/ai-pr-review-bitbucket';

const adapter = await BitbucketAdapter.create();
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

### Pipeline Fails with Authentication Error

1. Verify `BITBUCKET_USERNAME` is set correctly (your Bitbucket username)
2. Verify `BITBUCKET_TOKEN` is your App Password (not your account password)
3. Check App Password has correct permissions (Repositories: Read, Pull requests: Read/Write)

### "ANTHROPIC_API_KEY is required" Error

Add `ANTHROPIC_API_KEY` to your repository variables with your Anthropic API key.

### No Comments Appearing

- Verify diff contains reviewable files (not just lock files)
- Check if all comments were filtered by severity settings
- Ensure `enabled: true` in config

### Comments on Wrong Lines

Bitbucket uses line numbers directly (not diff positions). This can happen when:
- File was modified between review runs
- Line numbers in diff don't match actual file

## Differences from GitHub Adapter

| Feature | GitHub | Bitbucket |
|---------|--------|-----------|
| Reactions/Emoji | Supported | Not supported |
| Review States | APPROVE, REQUEST_CHANGES, COMMENT | APPROVE, REQUEST_CHANGES |
| Comment Position | Diff position | Line number |
| Skip via Label | Yes | No (title only) |

## License

MIT
