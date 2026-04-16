# Laika

A VS Code extension that adds a sidebar panel for browsing and sending `.http` file requests — a visual companion to the plain-text HTTP workflow, without leaving the editor.

## Features

### HTTP Files sidebar
A dedicated Activity Bar tab lists every `.http` file in your workspace. Expand any file to see its individual requests. The tree refreshes automatically when files are created, deleted, or changed.

### .http file format
Laika follows the same format used by the [REST Client](https://github.com/Huachao/vscode-restclient) extension:

```http
@baseUrl = https://api.example.com
@token = abc123

### Get all users
# @name listUsers
GET {{baseUrl}}/users
Authorization: Bearer {{token}}
Accept: application/json

###

# @name createUser
POST {{baseUrl}}/users
Content-Type: application/json

{
  "name": "Laika",
  "role": "first dog in space"
}
```

**Supported syntax:**
| Syntax | Description |
|---|---|
| `###` | Separates requests within a file |
| `### Label` | Optional label on the separator (used as request name) |
| `# @name MyRequest` | Named request annotation (takes priority over separator label) |
| `@varName = value` | Declares a file-scoped variable |
| `{{varName}}` | Substitutes a variable in URLs, headers, and bodies |
| `Key: Value` | Request header |
| *(blank line)* | Separates headers from the request body |

### Request panel
Click the **▶** button on any request in the tree to open a side panel. The panel shows the resolved request (with variables substituted) and a **Send Request** button. After sending, the response is displayed inline: status code (colour-coded), response headers (collapsible), and body with recursive JSON syntax highlighting.

## Usage

1. Open a workspace containing `.http` files.
2. Click the **Laika** icon in the Activity Bar (astronaut helmet).
3. Expand any file to see its individual requests.
4. Click **▶** on a request (or the play button in the tree) to open the request panel.
5. Click **Send Request** — the response appears below with status, headers, and highlighted body.

## Development

```sh
npm install
npm run compile   # type-check + lint + bundle
npm run watch     # incremental rebuild
```

Press `F5` in VS Code to launch an Extension Development Host.

## Roadmap

- [x] Activity Bar sidebar
- [x] TreeView — `.http` files and their requests
- [x] HTTP parser — variables, substitution, headers, body
- [x] WebView panel — send requests, display status / headers / body with JSON highlighting
