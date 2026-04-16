# Laika

[![Release](https://github.com/lfmundim/laika/actions/workflows/release.yml/badge.svg)](https://github.com/lfmundim/laika/actions/workflows/release.yml)
[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/lfmundim.laika)](https://marketplace.visualstudio.com/items?itemName=lfmundim.laika)
[![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/lfmundim.laika)](https://marketplace.visualstudio.com/items?itemName=lfmundim.laika)

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

## Contributing

```sh
npm install
npm run compile   # type-check + lint + bundle
npm run watch     # rebuild on save
```

Press `F5` in VS Code to open an Extension Development Host with Laika loaded.
