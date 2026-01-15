/**
 * Feedback Reporter
 *
 * Generates formatted reports from feedback analytics.
 * Outputs to GitHub Actions Summary and METRICS.md file.
 *
 * This module handles:
 * - Markdown formatting
 * - Text-based chart rendering
 * - File generation
 */

import fs from 'fs/promises';
import path from 'path';
import { FeedbackAnalytics } from './feedback-analytics.js';

const DEFAULT_METRICS_PATH = '.ai-review/METRICS.md';

export class FeedbackReporter {
  /**
   * @param {string} repoPath - Repository root path
   * @param {string} metricsPath - Path to METRICS.md relative to repo
   */
  constructor(repoPath = process.cwd(), metricsPath = DEFAULT_METRICS_PATH) {
    this.repoPath = repoPath;
    this.metricsPath = path.join(repoPath, metricsPath);
  }

  /**
   * Renders a simple text-based bar chart
   * @param {Array} data - Data points with value and label
   * @param {Object} options - Chart options
   * @returns {string} Text chart
   * @private
   */
  _renderTextChart(data, options = {}) {
    const { maxWidth = 20, showValues = true } = options;

    if (!data || data.length === 0) {
      return 'No data available';
    }

    const maxValue = Math.max(...data.map(d => d.value || 0));
    if (maxValue === 0) {
      return 'No data available';
    }

    const lines = data.map(d => {
      const barLength = Math.round((d.value / maxValue) * maxWidth);
      const bar = '█'.repeat(barLength) + '░'.repeat(maxWidth - barLength);
      const value = showValues ? ` ${d.value}` : '';
      return `${d.label.padEnd(12)} ${bar}${value}`;
    });

    return lines.join('\n');
  }

  /**
   * Renders an approval rate trend chart
   * @param {Array} trends - Temporal trend data
   * @returns {string} Text chart
   * @private
   */
  _renderTrendChart(trends) {
    if (!trends || trends.length === 0) {
      return 'No trend data available';
    }

    // Simple sparkline-style chart
    const heights = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    const rates = trends.map(t => t.approvalRate);
    const max = Math.max(...rates, 100);
    const min = Math.min(...rates, 0);
    const range = max - min || 1;

    const sparkline = rates.map(rate => {
      const normalized = (rate - min) / range;
      const index = Math.min(Math.floor(normalized * 8), 7);
      return heights[index];
    }).join('');

    // Labels for first and last period
    const firstLabel = trends[0].period;
    const lastLabel = trends[trends.length - 1].period;

    return `${sparkline}\n${firstLabel.padEnd(Math.floor(sparkline.length / 2))}${lastLabel}`;
  }

  /**
   * Formats severity emoji
   * @param {string} severity - Severity level
   * @returns {string} Emoji
   * @private
   */
  _severityEmoji(severity) {
    const emojis = {
      critical: '🔴',
      warning: '🟡',
      suggestion: '🔵',
      nitpick: '⚪'
    };
    return emojis[severity] || '⚪';
  }

  /**
   * Generates GitHub Actions Summary content
   * @param {Array} events - Feedback events
   * @param {Object} options - Generation options
   * @returns {string} Markdown content
   */
  generateActionsSummary(events, options = {}) {
    const metrics = FeedbackAnalytics.generateSummaryMetrics(events);

    let summary = `## 📊 AI Review Feedback Analytics\n\n`;

    // Overall metrics table
    summary += `### Overall Metrics\n\n`;
    summary += `| Metric | Value |\n`;
    summary += `|--------|-------|\n`;
    summary += `| Total Reviews | ${metrics.totalReviews} |\n`;
    summary += `| Total Comments | ${metrics.totalComments} |\n`;
    summary += `| Avg Comments/Review | ${metrics.avgCommentsPerReview} |\n`;
    summary += `| Overall Approval Rate | ${metrics.approvalRate.rate}% |\n`;
    summary += `| Last 7 Days | ${metrics.last7Days.rate}% (${metrics.last7Days.total} reactions) |\n`;
    summary += `| Last 30 Days | ${metrics.last30Days.rate}% (${metrics.last30Days.total} reactions) |\n\n`;

    // Approval rate trend
    if (metrics.weeklyTrends.length > 0) {
      summary += `### Approval Rate Trend (Weekly)\n\n`;
      summary += '```\n';
      summary += this._renderTrendChart(metrics.weeklyTrends);
      summary += '\n```\n\n';
    }

    // Severity breakdown
    summary += `### Comments by Severity\n\n`;
    const severities = ['critical', 'warning', 'suggestion', 'nitpick'];
    for (const severity of severities) {
      const data = metrics.severityBreakdown[severity];
      if (data) {
        const emoji = this._severityEmoji(severity);
        const feedback = data.positive + data.negative > 0
          ? ` (${data.approvalRate}% approval)`
          : '';
        summary += `${emoji} **${severity.charAt(0).toUpperCase() + severity.slice(1)}**: ${data.count}${feedback}\n`;
      }
    }
    summary += '\n';

    // Category breakdown
    if (metrics.categoryBreakdown.length > 0) {
      summary += `### Comments by Category\n\n`;
      summary += `| Category | Count | Approval Rate |\n`;
      summary += `|----------|-------|---------------|\n`;
      for (const cat of metrics.categoryBreakdown) {
        if (cat.count > 0) {
          const rate = cat.positive + cat.negative > 0
            ? `${cat.approvalRate}%`
            : 'N/A';
          summary += `| ${cat.category} | ${cat.count} | ${rate} |\n`;
        }
      }
      summary += '\n';
    }

    // Top authors
    if (metrics.topAuthors.length > 0) {
      summary += `### Top PR Authors (by reviews received)\n\n`;
      for (let i = 0; i < Math.min(5, metrics.topAuthors.length); i++) {
        const author = metrics.topAuthors[i];
        summary += `${i + 1}. @${author.author} (${author.count} PRs)\n`;
      }
      summary += '\n';
    }

    return summary;
  }

  /**
   * Generates METRICS.md file content
   * @param {Array} events - Feedback events
   * @param {Object} metadata - History metadata
   * @returns {string} Markdown content
   */
  generateMetricsFile(events, metadata = {}) {
    const metrics = FeedbackAnalytics.generateSummaryMetrics(events);
    const now = new Date().toISOString();

    let content = `# AI PR Review Metrics\n\n`;
    content += `> Auto-generated on ${now.split('T')[0]}\n\n`;

    // Summary section
    content += `## Summary\n\n`;
    content += `- **Total Reviews**: ${metrics.totalReviews}\n`;
    content += `- **Total Comments**: ${metrics.totalComments}\n`;
    content += `- **Average Comments per Review**: ${metrics.avgCommentsPerReview}\n`;
    content += `- **Overall Approval Rate**: ${metrics.approvalRate.rate}%\n`;
    content += `- **Last Updated**: ${now}\n\n`;

    // Recent performance
    content += `## Recent Performance\n\n`;
    content += `### Last 7 Days\n`;
    content += `- Reviews: ${metrics.last7Days.total > 0 ? Math.ceil(metrics.last7Days.total / 2) : 0}\n`;
    content += `- Approval Rate: ${metrics.last7Days.rate}%\n`;
    content += `- Total Reactions: ${metrics.last7Days.total}\n\n`;

    content += `### Last 30 Days\n`;
    content += `- Approval Rate: ${metrics.last30Days.rate}%\n`;
    content += `- Total Reactions: ${metrics.last30Days.total}\n\n`;

    // Severity breakdown
    content += `## Issues by Severity\n\n`;
    content += `| Severity | Count | Approval Rate |\n`;
    content += `|----------|-------|---------------|\n`;
    for (const severity of ['critical', 'warning', 'suggestion', 'nitpick']) {
      const data = metrics.severityBreakdown[severity];
      if (data) {
        const emoji = this._severityEmoji(severity);
        const rate = data.positive + data.negative > 0
          ? `${data.approvalRate}%`
          : 'N/A';
        content += `| ${emoji} ${severity} | ${data.count} | ${rate} |\n`;
      }
    }
    content += '\n';

    // Category breakdown
    content += `## Issues by Category\n\n`;
    content += `| Category | Count | Feedback |\n`;
    content += `|----------|-------|----------|\n`;
    for (const cat of metrics.categoryBreakdown) {
      const feedback = cat.positive + cat.negative > 0
        ? `👍 ${cat.positive} / 👎 ${cat.negative}`
        : '-';
      content += `| ${cat.category} | ${cat.count} | ${feedback} |\n`;
    }
    content += '\n';

    // Weekly trends
    if (metrics.weeklyTrends.length > 0) {
      content += `## Weekly Trends\n\n`;
      content += `| Week | Reviews | 👍 | 👎 | Approval |\n`;
      content += `|------|---------|----|----|----------|\n`;
      for (const week of metrics.weeklyTrends.slice(-8)) {
        content += `| ${week.period} | ${week.reviews} | ${week.positive} | ${week.negative} | ${week.approvalRate}% |\n`;
      }
      content += '\n';
    }

    // Top commented files
    if (metrics.mostCommentedFiles.length > 0) {
      content += `## Most Commented Files\n\n`;
      content += `| File | Comments |\n`;
      content += `|------|----------|\n`;
      for (const file of metrics.mostCommentedFiles.slice(0, 10)) {
        content += `| \`${file.file}\` | ${file.count} |\n`;
      }
      content += '\n';
    }

    // Footer
    content += `---\n\n`;
    content += `*Generated by [AI PR Review](https://github.com/hgarcianareia/ai-pr-review)*\n`;

    return content;
  }

  /**
   * Writes the METRICS.md file
   * @param {Array} events - Feedback events
   * @param {Object} metadata - History metadata
   * @returns {Promise<void>}
   */
  async writeMetricsFile(events, metadata = {}) {
    const dir = path.dirname(this.metricsPath);
    await fs.mkdir(dir, { recursive: true });

    const content = this.generateMetricsFile(events, metadata);
    await fs.writeFile(this.metricsPath, content, 'utf-8');

    console.log(`[INFO] Generated METRICS.md at ${this.metricsPath}`);
  }

  /**
   * Gets the relative path to METRICS.md
   * @returns {string}
   */
  getMetricsRelativePath() {
    return path.relative(this.repoPath, this.metricsPath);
  }
}
