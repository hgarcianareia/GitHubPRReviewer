/**
 * Feedback Analytics
 *
 * Pure computation layer for analyzing feedback history.
 * All methods are static and have no side effects.
 *
 * This module provides:
 * - Approval rate calculations
 * - Grouping by severity/category
 * - Temporal trend analysis
 * - Summary metrics generation
 */

/**
 * @typedef {Object} ApprovalRateResult
 * @property {number} positive - Total positive reactions
 * @property {number} negative - Total negative reactions
 * @property {number} total - Total reactions
 * @property {number} rate - Approval rate percentage
 */

/**
 * @typedef {Object} SeverityBreakdown
 * @property {number} critical - Critical issues count
 * @property {number} warning - Warning issues count
 * @property {number} suggestion - Suggestion issues count
 * @property {number} nitpick - Nitpick issues count
 * @property {Object} feedback - Feedback by severity
 */

/**
 * @typedef {Object} CategoryBreakdown
 * @property {string} category - Category name
 * @property {number} count - Comment count
 * @property {number} positive - Positive reactions
 * @property {number} negative - Negative reactions
 * @property {number} approvalRate - Approval rate for this category
 */

/**
 * @typedef {Object} TemporalDataPoint
 * @property {string} period - Period label (e.g., "2026-W02", "2026-01")
 * @property {number} reviews - Number of reviews
 * @property {number} positive - Positive reactions
 * @property {number} negative - Negative reactions
 * @property {number} approvalRate - Approval rate for period
 */

export class FeedbackAnalytics {
  /**
   * Calculates overall approval rate from events
   * @param {Array} events - Feedback events
   * @param {number} [days] - Optional filter to last N days
   * @returns {ApprovalRateResult}
   */
  static calculateApprovalRate(events, days = null) {
    let filteredEvents = events;

    if (days) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      filteredEvents = events.filter(e => new Date(e.timestamp) >= cutoff);
    }

    const totals = filteredEvents.reduce(
      (acc, event) => ({
        positive: acc.positive + (event.feedback?.positive || 0),
        negative: acc.negative + (event.feedback?.negative || 0)
      }),
      { positive: 0, negative: 0 }
    );

    const total = totals.positive + totals.negative;
    const rate = total > 0
      ? parseFloat(((totals.positive / total) * 100).toFixed(1))
      : 0;

    return {
      positive: totals.positive,
      negative: totals.negative,
      total,
      rate
    };
  }

  /**
   * Groups feedback by comment severity
   * @param {Array} events - Feedback events
   * @returns {SeverityBreakdown}
   */
  static groupBySeverity(events) {
    const result = {
      critical: { count: 0, positive: 0, negative: 0 },
      warning: { count: 0, positive: 0, negative: 0 },
      suggestion: { count: 0, positive: 0, negative: 0 },
      nitpick: { count: 0, positive: 0, negative: 0 }
    };

    for (const event of events) {
      // Count findings by severity
      if (event.findings) {
        result.critical.count += event.findings.critical || 0;
        result.warning.count += event.findings.warning || 0;
        result.suggestion.count += event.findings.suggestion || 0;
        result.nitpick.count += event.findings.nitpick || 0;
      }

      // Aggregate feedback by severity from top comments
      if (event.topComments) {
        for (const comment of event.topComments) {
          const severity = comment.severity?.toLowerCase() || 'suggestion';
          if (result[severity]) {
            result[severity].positive += comment.positive || 0;
            result[severity].negative += comment.negative || 0;
          }
        }
      }
    }

    // Calculate approval rates
    for (const severity of Object.keys(result)) {
      const total = result[severity].positive + result[severity].negative;
      result[severity].approvalRate = total > 0
        ? parseFloat(((result[severity].positive / total) * 100).toFixed(1))
        : 0;
    }

    return result;
  }

  /**
   * Groups feedback by review area category
   * @param {Array} events - Feedback events
   * @returns {CategoryBreakdown[]}
   */
  static groupByCategory(events) {
    const categories = {
      security: { count: 0, positive: 0, negative: 0 },
      codeQuality: { count: 0, positive: 0, negative: 0 },
      documentation: { count: 0, positive: 0, negative: 0 },
      testCoverage: { count: 0, positive: 0, negative: 0 },
      conventions: { count: 0, positive: 0, negative: 0 }
    };

    for (const event of events) {
      // Count comments by category
      if (event.commentsByCategory) {
        for (const [category, count] of Object.entries(event.commentsByCategory)) {
          if (categories[category]) {
            categories[category].count += count;
          }
        }
      }

      // Aggregate feedback by category from top comments
      if (event.topComments) {
        for (const comment of event.topComments) {
          const category = comment.category || 'codeQuality';
          if (categories[category]) {
            categories[category].positive += comment.positive || 0;
            categories[category].negative += comment.negative || 0;
          }
        }
      }
    }

    // Convert to array with approval rates
    return Object.entries(categories)
      .map(([category, data]) => {
        const total = data.positive + data.negative;
        return {
          category,
          count: data.count,
          positive: data.positive,
          negative: data.negative,
          approvalRate: total > 0
            ? parseFloat(((data.positive / total) * 100).toFixed(1))
            : 0
        };
      })
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Generates temporal trend data
   * @param {Array} events - Feedback events
   * @param {'week'|'month'} interval - Grouping interval
   * @returns {TemporalDataPoint[]}
   */
  static getTemporalTrends(events, interval = 'week') {
    const groups = new Map();

    for (const event of events) {
      const date = new Date(event.timestamp);
      let period;

      if (interval === 'week') {
        // Get ISO week number
        const yearStart = new Date(date.getFullYear(), 0, 1);
        const weekNum = Math.ceil(
          ((date.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7
        );
        period = `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
      } else {
        // Monthly grouping
        period = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      }

      if (!groups.has(period)) {
        groups.set(period, {
          period,
          reviews: 0,
          positive: 0,
          negative: 0
        });
      }

      const group = groups.get(period);
      group.reviews++;
      group.positive += event.feedback?.positive || 0;
      group.negative += event.feedback?.negative || 0;
    }

    // Convert to array and calculate approval rates
    const result = Array.from(groups.values())
      .map(group => {
        const total = group.positive + group.negative;
        return {
          ...group,
          approvalRate: total > 0
            ? parseFloat(((group.positive / total) * 100).toFixed(1))
            : 0
        };
      })
      .sort((a, b) => a.period.localeCompare(b.period));

    return result;
  }

  /**
   * Generates comprehensive summary metrics
   * @param {Array} events - Feedback events
   * @returns {Object} Summary metrics
   */
  static generateSummaryMetrics(events) {
    if (!events || events.length === 0) {
      return {
        totalReviews: 0,
        totalComments: 0,
        avgCommentsPerReview: 0,
        approvalRate: this.calculateApprovalRate([]),
        last7Days: this.calculateApprovalRate([]),
        last30Days: this.calculateApprovalRate([]),
        severityBreakdown: this.groupBySeverity([]),
        categoryBreakdown: this.groupByCategory([]),
        weeklyTrends: [],
        monthlyTrends: [],
        topAuthors: [],
        mostCommentedFiles: []
      };
    }

    // Calculate total comments
    const totalComments = events.reduce((sum, event) => {
      const findings = event.findings || {};
      return sum +
        (findings.critical || 0) +
        (findings.warning || 0) +
        (findings.suggestion || 0) +
        (findings.nitpick || 0);
    }, 0);

    // Get top authors by number of reviewed PRs
    const authorCounts = new Map();
    for (const event of events) {
      const author = event.prAuthor || 'unknown';
      authorCounts.set(author, (authorCounts.get(author) || 0) + 1);
    }
    const topAuthors = Array.from(authorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([author, count]) => ({ author, count }));

    // Get most commented files
    const fileCounts = new Map();
    for (const event of events) {
      if (event.topComments) {
        for (const comment of event.topComments) {
          const file = comment.file || 'unknown';
          fileCounts.set(file, (fileCounts.get(file) || 0) + 1);
        }
      }
    }
    const mostCommentedFiles = Array.from(fileCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([file, count]) => ({ file, count }));

    return {
      totalReviews: events.length,
      totalComments,
      avgCommentsPerReview: events.length > 0
        ? parseFloat((totalComments / events.length).toFixed(1))
        : 0,
      approvalRate: this.calculateApprovalRate(events),
      last7Days: this.calculateApprovalRate(events, 7),
      last30Days: this.calculateApprovalRate(events, 30),
      severityBreakdown: this.groupBySeverity(events),
      categoryBreakdown: this.groupByCategory(events),
      weeklyTrends: this.getTemporalTrends(events, 'week').slice(-12), // Last 12 weeks
      monthlyTrends: this.getTemporalTrends(events, 'month').slice(-6), // Last 6 months
      topAuthors,
      mostCommentedFiles
    };
  }
}
