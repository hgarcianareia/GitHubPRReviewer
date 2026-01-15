# AI PR Review - Bitbucket Cloud

Bitbucket Pipelines adapter for AI-powered PR reviews using Anthropic's Claude.

## Quick Setup

### Step 1: Create API Token

> **Note**: App Passwords are deprecated. Use API tokens with scopes instead.

1. Go to **Bitbucket** > Click your avatar > **Personal settings**
2. Click **Atlassian account settings**
3. Go to **Security** tab > **API tokens**
4. Click **Create API token with scopes**
5. Name: `AI PR Review`
6. Select scopes:
   - **Repositories**: Read
   - **Pull requests**: Read and Write
7. Set expiry (max 1 year)
8. Click **Create** and copy the token

### Step 2: Add Repository Variables

1. Go to your repository **Settings** > **Repository variables**
2. Add these variables (mark as **Secured**):

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key ([get one here](https://console.anthropic.com)) |
| `BITBUCKET_API_EMAIL` | Your Atlassian account email (found in Personal settings > Email Aliases) |
| `BITBUCKET_API_TOKEN` | The API token you created in Step 1 |

### Step 3: Create Pipeline File

Create `bitbucket-pipelines.yml` in your repository root:

```yaml
image: node:20

definitions:
  caches:
    npm: ~/.npm

pipelines:
  pull-requests:
    '**':
      - step:
          name: AI PR Review
          caches:
            - npm
          script:
            # Install jq for JSON parsing
            - apt-get update && apt-get install -y jq

            # Install the AI review package
            - npm install @hgarcianareia/ai-pr-review-bitbucket@latest

            # Fetch PR data using Bitbucket API
            - |
              echo "Fetching PR #${BITBUCKET_PR_ID} data..."

              # Get PR diff
              curl -sL -u "${BITBUCKET_API_EMAIL}:${BITBUCKET_API_TOKEN}" \
                "https://api.bitbucket.org/2.0/repositories/${BITBUCKET_WORKSPACE}/${BITBUCKET_REPO_SLUG}/pullrequests/${BITBUCKET_PR_ID}/diff" \
                > pr_diff.txt

              # Get changed files
              curl -sL -u "${BITBUCKET_API_EMAIL}:${BITBUCKET_API_TOKEN}" \
                "https://api.bitbucket.org/2.0/repositories/${BITBUCKET_WORKSPACE}/${BITBUCKET_REPO_SLUG}/pullrequests/${BITBUCKET_PR_ID}/diffstat" \
                | jq -r '.values[].new.path // .values[].old.path' > changed_files.txt

              # Get existing comments
              curl -sL -u "${BITBUCKET_API_EMAIL}:${BITBUCKET_API_TOKEN}" \
                "https://api.bitbucket.org/2.0/repositories/${BITBUCKET_WORKSPACE}/${BITBUCKET_REPO_SLUG}/pullrequests/${BITBUCKET_PR_ID}/comments" \
                > pr_comments.json

            # Check for skip flag in PR title
            - |
              PR_TITLE=$(curl -s -u "${BITBUCKET_API_EMAIL}:${BITBUCKET_API_TOKEN}" \
                "https://api.bitbucket.org/2.0/repositories/${BITBUCKET_WORKSPACE}/${BITBUCKET_REPO_SLUG}/pullrequests/${BITBUCKET_PR_ID}" \
                | jq -r '.title')

              if echo "$PR_TITLE" | grep -qi "skip-ai-review"; then
                echo "Skipping AI review (skip-ai-review found in PR title)"
                exit 0
              fi

            # Run the AI review
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
| `BITBUCKET_API_EMAIL` | Yes | Manual | Your Atlassian account email |
| `BITBUCKET_API_TOKEN` | Yes | Manual | API token with scopes |
| `ANTHROPIC_API_KEY` | Yes | Manual | Anthropic API key |

## Review States

The adapter supports Bitbucket's review states:

| State | When Used |
|-------|-----------|
| **APPROVE** | No critical issues found |
| **REQUEST_CHANGES** | Critical issues require attention |

> **Note**: Bitbucket does not allow users to request changes on their own PRs. If the API token belongs to the PR author, the REQUEST_CHANGES state will be silently ignored. For REQUEST_CHANGES to work, use a separate service account or bot account for the API token.

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

1. Verify `BITBUCKET_API_EMAIL` is your Atlassian account email (not username)
2. Verify `BITBUCKET_API_TOKEN` is an API token with scopes (not an App Password)
3. Check API token has correct scopes (Repositories: Read, Pull requests: Read/Write)
4. Check API token hasn't expired (max 1 year validity)

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
