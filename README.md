# Laika

[![Release](https://github.com/lfmundim/laika/actions/workflows/release.yml/badge.svg)](https://github.com/lfmundim/laika/actions/workflows/release.yml)
[![Visual Studio Marketplace Version](https://vsmarketplacebadges.dev/version/kimdim.laika.svg)](https://marketplace.visualstudio.com/items?itemName=kimdim.laika)
[![Visual Studio Marketplace Installs](https://vsmarketplacebadges.dev/installs/kimdim.laika.svg)](https://marketplace.visualstudio.com/items?itemName=kimdim.laika)
[![Visual Studio Marketplace Rating](https://vsmarketplacebadges.dev/rating-star/kimdim.laika.svg)](https://marketplace.visualstudio.com/items?itemName=kimdim.laika)

A VS Code extension for browsing and firing `.http` file requests — a visual companion to the plain-text HTTP workflow, without leaving the editor.

## Getting started

1. Install the extension.
2. Open any workspace that contains `.http` files.
3. Click the **Laika** icon in the Activity Bar (the astronaut helmet).
4. Expand a file in the sidebar to see its requests.
5. Click **▶** next to a request to open the request panel.
6. Click **Send Request** — the response appears below with the status code, headers, and highlighted body.

## The sidebar

The Laika panel lists every `.http` file found in the workspace. Files are watched automatically — add, delete, or save one and the tree updates instantly. Use the **↻** button at the top of the panel to force a refresh.

## The request panel

Opening a request shows the resolved URL, headers, and body (all `{{variables}}` already substituted) before you send anything. After sending:

- **Status** is colour-coded: green (2xx), yellow (3xx), orange (4xx), red (5xx)
- **Response headers** are collapsible
- **Body** is pretty-printed with JSON syntax highlighting

The panel stays open when you switch tabs. Clicking a different request updates it in place rather than opening a new tab.

## .http file format

Laika uses the same format as the [REST Client](https://github.com/Huachao/vscode-restclient) extension, so existing `.http` files work without changes.

```http
@baseUrl = https://api.example.com
@token   = abc123

### List users
# @name listUsers
GET {{baseUrl}}/users
Authorization: Bearer {{token}}
Accept: application/json

###

### Create user
# @name createUser
POST {{baseUrl}}/users
Content-Type: application/json

{
  "name": "Laika",
  "role": "first dog in space"
}
```

| Syntax | Meaning |
|---|---|
| `###` | Separator between requests |
| `### Label` | Separator with a display name |
| `# @name Foo` | Request name (overrides separator label) |
| `@var = value` | File-scoped variable declaration |
| `{{var}}` | Variable substitution (URL, headers, body) |
| `Key: Value` | Request header |
| *(blank line)* | Marks the end of headers; everything after is the body |

## Environments

Laika uses the same environment file format as Visual Studio 2022, so any existing `http-client.env.json` file works without changes.

### Environment file

Create a file named **`http-client.env.json`** in your workspace root (or anywhere in the directory tree above your `.http` files — Laika searches upward, just like Visual Studio). The file is a JSON object whose keys are environment names:

```json
{
  "$shared": {
    "API_VERSION": "v1"
  },
  "dev": {
    "BASE_URL": "http://localhost:3000",
    "API_KEY": "dev-key"
  },
  "staging": {
    "BASE_URL": "https://api.staging.example.com",
    "API_KEY": "stg-key"
  }
}
```

`$shared` is a special key whose variables act as defaults for every environment. A specific environment can override any `$shared` variable by re-defining it.

### User-specific overrides

Place a **`http-client.env.json.user`** file alongside the main file for values you don't want to commit (personal tokens, local ports, etc.). Variables in `.user` override the shared file for the same environment. Add `*.user` to `.gitignore`.

```json
{
  "dev": {
    "API_KEY": "my-local-key"
  }
}
```

### Selecting an environment

Click the environment button in the Laika toolbar (or run **Laika: Select Environment** from the Command Palette) and pick an environment. Choose **None** to clear it. The selection persists across sessions.

### Variable priority

When a request is sent, variables are resolved in this order (highest wins):

1. **Inline** `@var` declarations inside the request block
2. **File-level** `@var` declarations at the top of the `.http` file
3. **`.user` file** — active environment block
4. **`http-client.env.json`** — active environment block
5. **`.user` file** — `$shared` block
6. **`http-client.env.json`** — `$shared` block

### Example

```http
### Health check
GET {{BASE_URL}}/{{API_VERSION}}/health
Authorization: Bearer {{API_KEY}}
```

Switch to **dev** → sends to `http://localhost:3000/v1/health`. Switch to **staging** → sends to `https://api.staging.example.com/v1/health`. No file edits needed.

## Contributing

```sh
npm install
npm run compile   # type-check + lint + bundle
npm run watch     # rebuild on save
```

Press `F5` in VS Code to open an Extension Development Host with Laika loaded.
