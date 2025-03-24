# CLAUDE.md - Cloudflare Workers Project Guidelines

## Build Commands

- `npm run dev` - Start local development server
- `npm run deploy` - Deploy worker to Cloudflare
- `npm run cf-typegen` - Generate TypeScript types for Cloudflare bindings

## Code Style Guidelines

- **TypeScript**: Use strict mode with explicit types
- **Imports**: Sort alphabetically, group by third-party then local
- **Formatting**: 2-space indentation, semicolons required
- **Naming**: camelCase for variables/functions, PascalCase for classes/types
- **Error Handling**: Use `try/catch` blocks for async operations
- **Comments**: JSDoc for public APIs, inline comments for complex logic
- **Architecture**: Follow Cloudflare Workers patterns with fetch handler

## Project Structure

- `src/` - Source code
- `wrangler.toml` - Cloudflare configuration
