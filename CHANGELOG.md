# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Removed incremental review feature for simplified review flow

### Fixed
- Improved incremental review messaging and logging
- Use full PR diff for comment positioning
- Added input validation for PR_NUMBER environment variable
- Added branch name sanitization in auto-fix feature to prevent command injection

### Added
- Production-ready documentation updates
- `.gitignore` file for proper file exclusions
- `LICENSE` file (MIT)
- `CONTRIBUTING.md` with contribution guidelines
- `CHANGELOG.md` for version tracking
- Unit tests for critical utility functions (46 tests)
- Extracted testable utility functions to `lib/utils.js`

## [1.0.0] - 2024-12-01

### Added
- Initial release of AI PR Reviewer
- Automated code review using Claude AI
- Inline comments on specific lines
- Summary reports with strengths and concerns
- Multi-language support (C#, TypeScript, Python)
- Configurable review focus areas
- Large PR handling with automatic chunking
- Skip options via labels and title prefixes

### Advanced Features
- Review caching by commit SHA
- Comment threading (update existing comments)
- PR size warnings
- Custom review instructions from PR description
- File-level ignore comments (`ai-review-ignore`)
- Metrics and analytics in GitHub Actions Summary

### High-Impact Features
- Feedback loop tracking (emoji reactions on comments)
- Contextual awareness (reads imported/related files)
- Auto-fix PR generation (disabled by default)
- Severity threshold filtering
- GitHub code suggestions in review comments

## [0.1.0] - 2024-11-15

### Added
- Basic PR review functionality
- Claude API integration
- GitHub Actions workflow
