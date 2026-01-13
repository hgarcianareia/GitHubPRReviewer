# Contributing to AI PR Reviewer

Thank you for your interest in contributing to AI PR Reviewer! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please be respectful and constructive in all interactions. We're all here to build something useful together.

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](../../issues)
2. If not, create a new issue with:
   - A clear, descriptive title
   - Steps to reproduce the problem
   - Expected vs actual behavior
   - Your environment (Node.js version, OS, etc.)
   - Relevant logs or error messages

### Suggesting Features

1. Check existing issues and discussions for similar suggestions
2. Create a new issue with:
   - A clear description of the feature
   - The problem it solves or use case it enables
   - Any implementation ideas you have

### Submitting Changes

1. **Fork the repository** and create your branch from `main`
2. **Make your changes** following our coding standards (below)
3. **Test your changes** thoroughly
4. **Create a Pull Request** with:
   - A clear title and description
   - Reference to any related issues
   - Screenshots or examples if applicable

## Development Setup

### Prerequisites

- Node.js 20.x or higher
- npm
- An Anthropic API key (for testing)

### Local Development

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/GitHubPRReviewer.git
cd GitHubPRReviewer

# Install dependencies
cd .github/scripts
npm install

# Set up environment variables for testing
export ANTHROPIC_API_KEY="your-api-key"
export GITHUB_TOKEN="your-github-token"
# ... other required env vars
```

### Testing Changes

Since this is a GitHub Action, testing requires either:

1. **Local simulation**: Set up all required environment variables and run:
   ```bash
   node .github/scripts/review-pr.js
   ```

2. **Fork testing**: Push your changes to a fork and create a test PR

## Coding Standards

### JavaScript Style

- Use ES modules (`import`/`export`)
- Use `const` by default, `let` when reassignment is needed
- Use meaningful variable and function names
- Add JSDoc comments for public functions
- Use the existing logging pattern (`log('level', 'message', data)`)

### Code Organization

The main script is organized into sections:
- Configuration
- Initialization
- Utility Functions
- Feature sections (caching, threading, etc.)
- GitHub API Functions
- Claude API Integration
- Main Execution

When adding new features, follow this pattern and add a clear section header.

### Commit Messages

Use clear, descriptive commit messages:
- `feat: Add new feature X`
- `fix: Resolve issue with Y`
- `docs: Update README with Z`
- `refactor: Improve performance of W`

### Testing

Before submitting a PR, ensure all tests pass:

```bash
cd .github/scripts
npm test
```

When adding new utility functions to `lib/utils.js`, please add corresponding tests to `lib/utils.test.js`.

**Note:** Tests require Node.js 20+ for the built-in test runner. Check your version with `node --version`.

### Pull Request Guidelines

1. Keep PRs focused on a single change
2. Update documentation if needed
3. Add configuration options for new features (in `ai-review.yml`)
4. Ensure backward compatibility or document breaking changes
5. **Run `npm test` and ensure all tests pass**
6. Your PR will be reviewed by this very action!

## Configuration Changes

When adding new features:

1. Add default values to `DEFAULT_CONFIG` in `review-pr.js`
2. Document the option in `.github/ai-review.yml`
3. Update `README.md` with usage instructions

## Questions?

Feel free to open an issue for any questions about contributing. We're happy to help!

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
