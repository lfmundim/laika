# Changelog

All notable changes to Laika will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.2.x-beta] — 2026-04-17

### Added
- Environment management using Visual Studio's `http-client.env.json` format:
  - Create `http-client.env.json` in your workspace with named environments (`dev`, `staging`, etc.) — fully compatible with Visual Studio 2022
  - `$shared` key provides default variables inherited by every environment
  - `http-client.env.json.user` sibling file for local overrides that stay out of source control
  - Laika searches upward from the `.http` file's directory to find the nearest env file (same strategy as Visual Studio)
  - New **Select Environment** command (`laika.selectEnvironment`) in the TreeView toolbar and command palette
  - Active environment persists across sessions via workspace state
  - Environment variables fill `{{variable}}` substitutions at the lowest priority (inline `@var` > file-level `@var` > `.user` env > env file > `.user` `$shared` > `$shared`)
  - Request panel shows an **Environment** badge (e.g. `Environment: staging`) so the active context is always visible
  - Switching environments instantly refreshes an open request panel

---

## [0.1.x-beta] — 2026-04-17

### Added
- Activity Bar sidebar with a TreeView listing all `.http` files in the workspace
- `.http` file parser supporting:
  - `###` request separators (with optional inline label)
  - `# @name` / `// @name` request name annotations
  - `@varName = value` file-level variable declarations
  - `{{varName}}` variable substitution in URLs, headers, and bodies
  - Standard HTTP request line (`METHOD URL [HTTP/version]`)
  - Header parsing (`Key: Value` lines after the request line)
  - Body parsing (content after the first blank line)
- WebView request panel (opens beside the editor) with:
  - Resolved URL and method badge display
  - Inline request headers display
  - Request body display
  - Live `{{variable}}` substitution as variables are edited
  - Editable file-level variables that persist back to the `.http` file on change
  - Send Request button with loading spinner
  - JSON response highlighting (keys, strings, numbers, booleans, nulls)
  - Response status badge (colour-coded by 2xx / 3xx / 4xx / 5xx)
  - Response headers (collapsible) and body display
  - Request timing in milliseconds
- Refresh command in the TreeView toolbar
- Send Request inline button on each request node in the TreeView
- CI workflow (`release.yml`) that builds, packages, publishes to the VS Code Marketplace, and creates a GitHub release on pushes to `main` (pre-release) and `release/**` (stable)
