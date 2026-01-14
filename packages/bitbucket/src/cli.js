#!/usr/bin/env node
/**
 * CLI entry point for Bitbucket AI PR Review
 *
 * This script is the main entry point when running the review
 * from Bitbucket Pipelines or the command line.
 */

import { ReviewEngine } from '@hgarcianareia/ai-pr-review-core';
import { BitbucketAdapter } from './bitbucket-adapter.js';

async function main() {
  // Validate required API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('='.repeat(60));
    console.error('[FATAL] ANTHROPIC_API_KEY is required');
    console.error('='.repeat(60));
    console.error('  Please add ANTHROPIC_API_KEY to your repository variables.');
    console.error('='.repeat(60));
    process.exit(1);
  }

  try {
    // Create the Bitbucket adapter
    const adapter = await BitbucketAdapter.create();

    // Create and run the review engine
    const engine = new ReviewEngine({
      platformAdapter: adapter,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY
    });

    const result = await engine.run();

    if (result.skipped) {
      console.log(`[INFO] Review skipped: ${result.reason}`);
      process.exit(0);
    }

    console.log('[INFO] Review completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('[FATAL] Review failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
