/**
 * @hgarcianareia/ai-pr-review-bitbucket
 *
 * Bitbucket Cloud adapter for AI-powered PR reviews.
 * Use this package with @hgarcianareia/ai-pr-review-core to review
 * Pull Requests in Bitbucket Pipelines.
 *
 * Usage:
 *   import { BitbucketAdapter } from '@hgarcianareia/ai-pr-review-bitbucket';
 *   import { ReviewEngine } from '@hgarcianareia/ai-pr-review-core';
 *
 *   const adapter = await BitbucketAdapter.create();
 *   const engine = new ReviewEngine({
 *     platformAdapter: adapter,
 *     anthropicApiKey: process.env.ANTHROPIC_API_KEY
 *   });
 *
 *   await engine.run();
 */

export { BitbucketAdapter } from './bitbucket-adapter.js';
