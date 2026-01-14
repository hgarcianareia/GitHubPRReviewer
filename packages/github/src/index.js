/**
 * @hgarcianareia/ai-pr-review-github
 *
 * GitHub adapter for AI-powered PR reviews.
 * Use this package with @hgarcianareia/ai-pr-review-core to review
 * Pull Requests in GitHub Actions.
 *
 * Usage:
 *   import { GitHubAdapter } from '@hgarcianareia/ai-pr-review-github';
 *   import { ReviewEngine } from '@hgarcianareia/ai-pr-review-core';
 *
 *   const adapter = await GitHubAdapter.create();
 *   const engine = new ReviewEngine({
 *     platformAdapter: adapter,
 *     anthropicApiKey: process.env.ANTHROPIC_API_KEY
 *   });
 *
 *   await engine.run();
 */

export { GitHubAdapter } from './github-adapter.js';
