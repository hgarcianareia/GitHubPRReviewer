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
    types: [opened, synchronize, reopened, closed]  # 'closed' captures final feedback
  workflow_dispatch:
    inputs:
      pr_number:
        description: 'PR number to review'
        required: true
        type: number

concurrency:
  group: pr-review-${{ github.event.inputs.pr_number || github.event.pull_request.number }}
  cancel-in-progress: true

permissions:
  contents: write        # Required for auto-fix PRs and feedback tracking
  pull-requests: write

jobs:
  ai-review:
    name: Claude Code Review
    runs-on: ubuntu-latest
    timeout-minutes: 15

    if: |
      github.event_name == 'workflow_dispatch' ||
      (!contains(github.event.pull_request.labels.*.name, 'skip-ai-review') &&
      !startsWith(github.event.pull_request.title, '[no-review]'))

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install AI Review package
        run: npm install @hgarcianareia/ai-pr-review-github@latest

      - name: Set PR number
        id: pr
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          if [ "${{ github.event_name }}" == "workflow_dispatch" ]; then
            PR_NUM="${{ github.event.inputs.pr_number }}"
            HEAD_SHA=$(gh pr view "$PR_NUM" --json headRefOid -q '.headRefOid')
            echo "number=$PR_NUM" >> $GITHUB_OUTPUT
            echo "head_sha=$HEAD_SHA" >> $GITHUB_OUTPUT
          else
            echo "number=${{ github.event.pull_request.number }}" >> $GITHUB_OUTPUT
            echo "head_sha=${{ github.event.pull_request.head.sha }}" >> $GITHUB_OUTPUT
          fi

      - name: Restore review cache
        id: cache
        uses: actions/cache@v4
        with:
          path: .ai-review-cache
          key: ai-review-${{ steps.pr.outputs.number }}-${{ steps.pr.outputs.head_sha }}
          restore-keys: |
            ai-review-${{ steps.pr.outputs.number }}-

      - name: Get PR diff
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          PR_NUM: ${{ steps.pr.outputs.number }}
        run: |
          gh pr diff "$PR_NUM" > pr_diff.txt
          gh pr view "$PR_NUM" --json files -q '.files[].path' > changed_files.txt
          gh api "repos/${{ github.repository }}/pulls/$PR_NUM/comments" > pr_comments.json || echo "[]" > pr_comments.json
          gh api "repos/${{ github.repository }}/pulls/$PR_NUM/reviews" > pr_reviews.json || echo "[]" > pr_reviews.json
          if [ "${{ github.event_name }}" == "workflow_dispatch" ]; then
            gh pr view "$PR_NUM" --json title,body,author,baseRefOid,headRefOid > pr_metadata.json
          fi

      - name: Run AI Review
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          PR_NUMBER: ${{ steps.pr.outputs.number }}
          PR_TITLE: ${{ github.event.pull_request.title || '' }}
          PR_BODY: ${{ github.event.pull_request.body || '' }}
          PR_AUTHOR: ${{ github.event.pull_request.user.login || '' }}
          REPO_OWNER: ${{ github.repository_owner }}
          REPO_NAME: ${{ github.event.repository.name }}
          BASE_SHA: ${{ github.event.pull_request.base.sha || '' }}
          HEAD_SHA: ${{ steps.pr.outputs.head_sha }}
          AI_REVIEW_TRIGGER: ${{ github.event_name == 'workflow_dispatch' && 'manual' || github.event.action }}
          CACHE_HIT: ${{ steps.cache.outputs.cache-hit }}
        run: npx ai-pr-review-github

      - name: Save review cache
        if: always()
        run: |
          mkdir -p .ai-review-cache
          echo "${{ steps.pr.outputs.head_sha }}" >> .ai-review-cache/reviewed-commits.txt

      - name: Handle review failure
        if: failure()
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          PR_NUM: ${{ steps.pr.outputs.number }}
        run: |
          gh pr comment "$PR_NUM" --body "⚠️ **AI Review Failed**

          The automated code review encountered an error. Please check the workflow logs for details.

          You can:
          - Re-run the workflow from the Actions tab
          - Add the \`skip-ai-review\` label to skip automated review
          - Prefix your PR title with \`[no-review]\` to skip review"
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

> **Important**: Auto-fix requires `contents: write` permission to push branches. Update your workflow permissions:
> ```yaml
> permissions:
>   contents: write       # Required for auto-fix (git push)
>   pull-requests: write
> ```

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

### Feedback Tracking

Track review effectiveness over time with persistent analytics. Developers can provide feedback on AI review comments, and the system tracks this to improve metrics over time.

| Option | Default | Description |
|--------|---------|-------------|
| `feedbackTracking.enabled` | `true` | Enable persistent feedback tracking |
| `feedbackTracking.autoCommit` | `true` | Auto-commit feedback history to repo |
| `feedbackTracking.generateMetricsFile` | `true` | Generate `.ai-review/METRICS.md` |
| `feedbackTracking.historyPath` | `.ai-review/feedback-history.json` | Path to history file |
| `feedbackTracking.metricsPath` | `.ai-review/METRICS.md` | Path to metrics file |

When enabled, this feature:
- Stores feedback history in `.ai-review/feedback-history.json`
- Generates a `METRICS.md` file with analytics (approval rates, trends, etc.)
- Shows analytics in GitHub Actions Summary
- Auto-commits changes after each review
- Captures final reactions when PR is closed/merged

#### Providing Feedback

Developers can provide feedback on AI review comments by reacting with:
- 👍 (thumbs up) - The comment was helpful/accurate
- 👎 (thumbs down) - The comment was not helpful/inaccurate

Each review summary includes a reminder:
> *💡 React with 👍 or 👎 on inline comments to help improve future reviews.*

#### Feedback Capture on PR Close

The workflow automatically captures feedback reactions when a PR is closed or merged. This ensures that reactions added after the initial review are not lost.

**How it works:**
1. PR is reviewed → comments posted with 0 reactions
2. Developer reacts to comments with 👍/👎
3. PR is merged/closed → workflow triggers in "feedback-only" mode
4. Final reactions are captured and saved to history
5. Metrics are updated with the new feedback data

This requires the `closed` trigger in your workflow:
```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]
```

#### Auto-commit Behavior

When `autoCommit` is enabled, the system automatically commits feedback files to your repository's default branch (`main` or `master`). This works for both PR triggers and manual workflow dispatches.

**Files committed:**
- `.ai-review/feedback-history.json` - Raw feedback data (JSON)
- `.ai-review/METRICS.md` - Human-readable analytics dashboard

**How it works:**
1. After each review, the system detects your default branch (tries `main` first, then `master`)
2. Checks out the default branch, pulls latest changes
3. Commits the updated feedback files
4. Pushes to the default branch

This ensures feedback data is always committed to the main branch, even when the review was triggered from a PR on a different branch.

> **Important**: Feedback tracking requires `contents: write` permission to commit the history file:
> ```yaml
> permissions:
>   contents: write       # Required for feedback tracking (auto-commit)
>   pull-requests: write
> ```

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

feedbackTracking:
  enabled: true
  autoCommit: true
  generateMetricsFile: true
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
2. Verify workflow has `contents: write` and `pull-requests: write` permissions
3. Check Actions logs for detailed error messages

### No Comments Appearing

- Verify diff contains reviewable files (not just lock files)
- Check if all comments were filtered by severity settings
- Ensure `enabled: true` in config

### Comments on Wrong Lines

This can happen when:
- File was modified between review runs
- Line is not part of the diff (only changed lines can have comments)

### Auto-fix PR Not Created

If `autoFix.enabled: true` but no PR is created:

1. **Check permissions**: Workflow needs `contents: write` permission to push branches
   ```yaml
   permissions:
     contents: write       # Required for auto-fix
     pull-requests: write
   ```

2. **Check suggested fixes count**: Look for `Suggested Fixes | N` in the metrics. If `0`, Claude didn't provide any fixable code suggestions (only single-line fixes with high confidence are included).

3. **Check logs**: Look for `[ERROR] Failed to create auto-fix PR:` in the workflow logs for the specific error.

### Feedback History Not Saving

If feedback tracking is enabled but `.ai-review/feedback-history.json` is not being created:

1. **Check permissions**: Workflow needs `contents: write` permission to commit files
   ```yaml
   permissions:
     contents: write       # Required for feedback tracking
     pull-requests: write
   ```

2. **Check default branch**: The system auto-detects `main` or `master` as the default branch. If your repository uses a different default branch name, auto-commit may fail.

3. **Check logs**: Look for `[WARN] Failed to commit feedback history:` or `[WARN] Could not detect default branch` in the workflow logs.

4. **Disable auto-commit**: If you don't want auto-commits, set `feedbackTracking.autoCommit: false`. The analytics will still show in the GitHub Actions Summary.

## License

MIT
