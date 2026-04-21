// Code coverage excluded: this file creates vscode.WebviewPanel instances and uses
// vscode.window APIs that require the VS Code extension host at runtime.
// Unit testing requires @vscode/test-electron (integration tests), deferred.
import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { ParsedRequest, ParsedVariable, resolveRequest } from './httpParser';
import { EnvVariable } from './envLoader';
import { HistoryStore } from './historyStore';

// ---------------------------------------------------------------------------
// Panel manager
// ---------------------------------------------------------------------------

export class RequestPanel {
  private static current: RequestPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private request: ParsedRequest;
  private fileVars: ParsedVariable[];
  private envVars: EnvVariable[];
  private envName: string;
  private filePath: string;
  private historyStore: HistoryStore | undefined;
  private historyRefreshCallback: (() => void) | undefined;

  static show(
    request: ParsedRequest,
    fileVars: ParsedVariable[],
    filePath: string,
    context: vscode.ExtensionContext,
    envVars: EnvVariable[] = [],
    envName: string = '',
    historyStore?: HistoryStore,
    historyRefreshCallback?: () => void,
  ): void {
    if (RequestPanel.current) {
      // Reveal before updating so the webview is active when its HTML is replaced,
      // preventing the occasional blank-panel issue on request switches.
      RequestPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      RequestPanel.current.update(request, fileVars, filePath, envVars, envName);
      RequestPanel.current.historyStore = historyStore;
      RequestPanel.current.historyRefreshCallback = historyRefreshCallback;
      return;
    }
    RequestPanel.current = new RequestPanel(
      request, fileVars, filePath, context, envVars, envName, historyStore, historyRefreshCallback,
    );
  }

  /** Re-render the current panel with updated env data (called after environment switch). */
  static refresh(envVars: EnvVariable[], envName: string): void {
    if (!RequestPanel.current) { return; }
    RequestPanel.current.envVars = envVars;
    RequestPanel.current.envName = envName;
    // Sync synthetic placeholder values (line < 0) from the new environment.
    for (const v of RequestPanel.current.fileVars) {
      if (v.line < 0) {
        v.value = envVars.find(e => e.name === v.name)?.value ?? '';
      }
    }
    RequestPanel.current.render();
  }

  /** The file path of the .http file displayed in the current panel, if any. */
  static get currentFilePath(): string | undefined {
    return RequestPanel.current?.filePath;
  }

  private constructor(
    request: ParsedRequest,
    fileVars: ParsedVariable[],
    filePath: string,
    context: vscode.ExtensionContext,
    envVars: EnvVariable[],
    envName: string,
    historyStore?: HistoryStore,
    historyRefreshCallback?: () => void,
  ) {
    this.request = request;
    this.fileVars = fileVars;
    this.filePath = filePath;
    this.envVars = envVars;
    this.envName = envName;
    this.historyStore = historyStore;
    this.historyRefreshCallback = historyRefreshCallback;

    this.panel = vscode.window.createWebviewPanel(
      'laikaRequest',
      `Laika: ${request.name}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    this.panel.onDidDispose(() => {
      RequestPanel.current = undefined;
    }, null, context.subscriptions);

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'send') {
        await this.executeRequest();
      } else if (msg.type === 'updateVariable') {
        await this.updateVariable(msg.name, msg.value);
      }
    }, null, context.subscriptions);

    this.render();
  }

  private update(
    request: ParsedRequest,
    fileVars: ParsedVariable[],
    filePath: string,
    envVars: EnvVariable[],
    envName: string,
  ): void {
    this.request = request;
    this.fileVars = fileVars;
    this.filePath = filePath;
    this.envVars = envVars;
    this.envName = envName;
    this.panel.title = `Laika: ${request.name}`;
    this.render();
  }

  private render(): void {
    this.panel.webview.html = buildWebviewHtml(this.request, this.fileVars, this.envVars, this.envName);
  }

  private async executeRequest(): Promise<void> {
    const resolved = resolveRequest(this.request, this.fileVars, this.envVars);

    const headers: Record<string, string> = {};
    for (const h of resolved.headers) {
      headers[h.name] = h.value;
    }

    try {
      const t0 = Date.now();
      const { status, statusText, responseHeaders, body } = await this.makeRequest(resolved.url, resolved.method, headers, resolved.body);
      const duration = Date.now() - t0;

      const contentType = responseHeaders['content-type'] ?? '';
      const isJson = contentType.includes('application/json');

      this.panel.webview.postMessage({
        type: 'response',
        status,
        statusText,
        headers: responseHeaders,
        body,
        isJson,
        duration,
      });

      this.historyStore?.add({
        request: { method: resolved.method, url: resolved.url, headers, body: resolved.body },
        response: { status, statusText, headers: responseHeaders, body, duration },
        sourceFile: this.filePath,
        requestName: this.request.name,
      });
      this.historyRefreshCallback?.();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const message = `Failed to fetch ${resolved.url}\n\nError: ${errorMsg}\n\n(Check certificate validity for HTTPS, firewall, or if the server is running)`;
      this.panel.webview.postMessage({ type: 'error', message });

      this.historyStore?.add({
        request: { method: resolved.method, url: resolved.url, headers, body: resolved.body },
        error: message,
        sourceFile: this.filePath,
        requestName: this.request.name,
      });
      this.historyRefreshCallback?.();
    }
  }

  private makeRequest(
    urlString: string,
    method: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<{ status: number; statusText: string; responseHeaders: Record<string, string>; body: string }> {
    return new Promise((resolve, reject) => {
      const url = new URL(urlString);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;

      const options = {
        method,
        headers,
        rejectUnauthorized: false, // Allow self-signed certs for localhost/development
      };

      const req = client.request(url, options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          const responseHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === 'string') {
              responseHeaders[key] = value;
            } else if (Array.isArray(value)) {
              responseHeaders[key] = value.join(', ');
            }
          }
          resolve({
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? '',
            responseHeaders,
            body: data,
          });
        });
      });

      req.on('error', reject);
      if (body) {
        req.write(body);
      }
      req.end();
    });
  }

  private async updateVariable(name: string, newValue: string): Promise<void> {
    const varEntry = this.fileVars.find(v => v.name === name);
    if (!varEntry) { return; }
    varEntry.value = newValue;

    // Synthetic placeholders (line < 0) have no backing declaration in the file.
    if (varEntry.line < 0) { return; }

    try {
      const uri = vscode.Uri.file(this.filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const line = doc.lineAt(varEntry.line);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, line.range, `@${name} = ${newValue}`);
      await vscode.workspace.applyEdit(edit);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Laika: failed to update @${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// HTML / CSS
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMarkdown(text: string): string {
  return text
    .split('\n')
    .map(line => {
      const e = esc(line);
      const formatted = e
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
      if (/^[-*]\s+/.test(line)) {
        return '<li>' + formatted.replace(/^[-*]\s+/, '') + '</li>';
      }
      return '<p>' + formatted + '</p>';
    })
    .join('');
}

function buildWebviewHtml(
  request: ParsedRequest,
  fileVars: ParsedVariable[],
  envVars: EnvVariable[],
  envName: string,
): string {
  const resolved = resolveRequest(request, fileVars, envVars);

  // Description block (markdown)
  const descriptionHtml = request.description
    ? '<div class="description">' + renderMarkdown(request.description) + '</div>\n'
    : '';

  // Environment badge — treat empty string and '<none>' as the explicit no-env state
  const isNoneEnv = !envName || envName === '<none>';
  const envLabel = isNoneEnv
    ? 'Environment: <span class="muted">&lt;none&gt;</span>'
    : `Environment: <strong>${esc(envName)}</strong>`;

  // Variables section
  const varsHtml = fileVars.length > 0
    ? fileVars.map(v =>
        '<div class="var-row">' +
        '<span class="var-name">@' + esc(v.name) + '</span>' +
        '<input class="var-input" data-name="' + esc(v.name) + '" type="text" value="' + esc(v.value) + '" spellcheck="false">' +
        '</div>'
      ).join('')
    : '<span class="muted">No variables defined</span>';

  // Headers — store raw (unresolved) value so JS can live-update
  const headersHtml = resolved.headers.length > 0
    ? resolved.headers.map((h, i) =>
        '<div class="kv-row">' +
        '<span class="kv-key">' + esc(h.name) + '</span>' +
        '<span class="kv-sep">:</span>' +
        '<span class="kv-val resolved-header" data-raw="' + esc(request.headers[i]?.value ?? h.value) + '">' + esc(h.value) + '</span>' +
        '</div>'
      ).join('')
    : '<span class="muted">None</span>';

  const bodyHtml = request.body
    ? '<pre class="code" id="resolved-body" data-raw="' + esc(request.body) + '">' + esc(resolved.body ?? '') + '</pre>'
    : '<span class="muted">No body</span>';

  // Init data passed to client-side JS for live resolution
  // Env vars are base layer; file vars override them for the live preview
  const varMap: Record<string, string> = {};
  for (const v of envVars) { varMap[v.name] = v.value; }
  for (const v of fileVars) { varMap[v.name] = v.value; }
  const initData = JSON.stringify({ rawUrl: request.url, vars: varMap });

  return (
    '<!DOCTYPE html>\n' +
    '<html lang="en">\n' +
    '<head>\n' +
    '<meta charset="UTF-8">\n' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\';">\n' +
    '<style>\n' +
    CSS +
    '\n</style>\n' +
    '</head>\n' +
    '<body>\n' +
    '<div class="request-section">\n' +
    '  <div class="env-banner">' + envLabel + '</div>\n' +
    (descriptionHtml ? '  ' + descriptionHtml : '') +
    '  <div class="section-label">Variables</div>\n' +
    '  <div class="section-body">' + varsHtml + '</div>\n' +
    '  <div class="request-line">\n' +
    '    <span class="badge">' + esc(resolved.method) + '</span>\n' +
    '    <span class="url" id="resolved-url">' + esc(resolved.url) + '</span>\n' +
    '  </div>\n' +
    '  <div class="section-label">Headers</div>\n' +
    '  <div class="section-body">' + headersHtml + '</div>\n' +
    '  <div class="section-label">Body</div>\n' +
    '  <div class="section-body">' + bodyHtml + '</div>\n' +
    '  <button id="btn-send">&#9654;&nbsp; Send Request</button>\n' +
    '</div>\n' +
    '<hr class="divider">\n' +
    '<div id="response">\n' +
    '  <div id="response-content"></div>\n' +
    '</div>\n' +
    '<script>\nvar INIT_DATA = ' + initData + ';\n' +
    SCRIPT +
    '\n</script>\n' +
    '</body>\n' +
    '</html>'
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const CSS = [
  '* { box-sizing: border-box; }',
  'body {',
  '  font-family: var(--vscode-font-family);',
  '  font-size: var(--vscode-font-size);',
  '  color: var(--vscode-foreground);',
  '  background: var(--vscode-editor-background);',
  '  padding: 20px 24px; margin: 0; line-height: 1.5;',
  '}',
  '.request-section { margin-bottom: 4px; }',
  '.env-banner {',
  '  font-size: 0.8em; margin-bottom: 14px;',
  '  color: var(--vscode-descriptionForeground);',
  '}',
  '.env-banner strong { color: var(--vscode-foreground); }',
  '.request-line { display: flex; align-items: baseline; gap: 10px; margin-bottom: 18px; }',
  '.badge {',
  '  font-size: 0.78em; font-weight: 700; padding: 2px 9px; border-radius: 3px;',
  '  letter-spacing: 0.06em; white-space: nowrap;',
  '  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);',
  '}',
  '.url { font-family: var(--vscode-editor-font-family); font-size: 0.9em; word-break: break-all; }',
  '.section-label {',
  '  font-size: 0.75em; font-weight: 700; text-transform: uppercase;',
  '  letter-spacing: 0.08em; color: var(--vscode-descriptionForeground); margin-bottom: 6px;',
  '}',
  '.section-body { margin-bottom: 14px; }',
  '.kv-row { font-family: var(--vscode-editor-font-family); font-size: 0.85em; line-height: 1.9; display: flex; }',
  '.kv-key { color: #9cdcfe; min-width: 180px; }',
  '.kv-sep { color: var(--vscode-descriptionForeground); padding: 0 4px; }',
  '.kv-val { color: #ce9178; }',
  '.var-row { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }',
  '.var-name {',
  '  font-family: var(--vscode-editor-font-family); font-size: 0.85em;',
  '  color: #9cdcfe; min-width: 140px; white-space: nowrap;',
  '}',
  '.var-input {',
  '  flex: 1; font-family: var(--vscode-editor-font-family); font-size: 0.85em;',
  '  background: var(--vscode-input-background); color: var(--vscode-input-foreground);',
  '  border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px;',
  '  padding: 2px 6px; outline: none;',
  '}',
  '.var-input:focus { border-color: var(--vscode-focusBorder); }',
  '.code {',
  '  margin: 0; padding: 12px; border-radius: 4px;',
  '  background: var(--vscode-textCodeBlock-background);',
  '  font-family: var(--vscode-editor-font-family); font-size: 0.85em;',
  '  overflow-x: auto; white-space: pre-wrap; word-break: break-word;',
  '}',
  '.muted { color: var(--vscode-descriptionForeground); font-style: italic; font-size: 0.9em; }',
  '.divider { border: none; border-top: 1px solid var(--vscode-panel-border); margin: 20px 0; }',
  'button#btn-send {',
  '  display: inline-flex; align-items: center; gap: 7px; padding: 6px 16px;',
  '  border: none; border-radius: 3px; cursor: pointer;',
  '  font-family: var(--vscode-font-family); font-size: 0.9em;',
  '  background: var(--vscode-button-background); color: var(--vscode-button-foreground);',
  '}',
  'button#btn-send:hover { background: var(--vscode-button-hoverBackground); }',
  'button#btn-send:disabled { opacity: 0.5; cursor: default; }',
  '.spinner {',
  '  display: inline-block; width: 12px; height: 12px;',
  '  border: 2px solid currentColor; border-top-color: transparent;',
  '  border-radius: 50%; animation: spin .65s linear infinite;',
  '}',
  '@keyframes spin { to { transform: rotate(360deg); } }',
  '#response { display: none; }',
  '.status { font-size: 1.1em; font-weight: 700; margin-bottom: 10px; }',
  '.s2 { color: #4ec9b0; } .s3 { color: #dcdcaa; } .s4 { color: #f48771; } .s5 { color: #f14c4c; }',
  '.duration { font-size: 0.82em; color: var(--vscode-descriptionForeground); margin-left: 8px; font-weight: 400; }',
  'details { margin: 10px 0; }',
  'details > summary { cursor: pointer; }',
  'details > summary:hover { color: var(--vscode-textLink-activeForeground); }',
  '.error {',
  '  padding: 10px 14px; border-radius: 4px;',
  '  font-family: var(--vscode-editor-font-family); font-size: 0.85em;',
  '  background: var(--vscode-inputValidation-errorBackground);',
  '  border: 1px solid var(--vscode-inputValidation-errorBorder);',
  '  color: var(--vscode-inputValidation-errorForeground);',
  '}',
  '.json-key { color: #9cdcfe; } .json-str { color: #ce9178; }',
  '.json-num { color: #b5cea8; } .json-bool, .json-null { color: #569cd6; }',
  '.description {',
  '  margin-bottom: 16px; padding: 10px 14px; line-height: 1.6;',
  '  border-left: 3px solid var(--vscode-textLink-foreground);',
  '  background: var(--vscode-textBlockQuote-background);',
  '  color: var(--vscode-foreground); font-size: 0.9em;',
  '}',
  '.description p { margin: 0 0 4px; }',
  '.description li { margin: 0 0 2px; list-style: disc; margin-left: 16px; }',
  '.inline-code {',
  '  font-family: var(--vscode-editor-font-family);',
  '  background: var(--vscode-textCodeBlock-background);',
  '  padding: 1px 4px; border-radius: 2px; font-size: 0.9em;',
  '}',
].join('\n');

// ---------------------------------------------------------------------------
// Client-side script — plain string, no template literals, avoids nesting
// ---------------------------------------------------------------------------

const SCRIPT = [
  'var vscode = acquireVsCodeApi();',
  'var btn = document.getElementById("btn-send");',
  'var responseDiv = document.getElementById("response");',
  'var responseContent = document.getElementById("response-content");',
  '',
  '// ---- Live variable resolution ----',
  'var currentVars = Object.assign({}, INIT_DATA.vars);',
  '',
  'function resolveVars(template) {',
  '  return template.replace(/\\{\\{(\\w+)\\}\\}/g, function(match, name) {',
  '    return Object.prototype.hasOwnProperty.call(currentVars, name) ? currentVars[name] : match;',
  '  });',
  '}',
  '',
  'function updateResolvedDisplay() {',
  '  var urlEl = document.getElementById("resolved-url");',
  '  if (urlEl) { urlEl.textContent = resolveVars(INIT_DATA.rawUrl); }',
  '  document.querySelectorAll(".resolved-header").forEach(function(el) {',
  '    var raw = el.getAttribute("data-raw");',
  '    if (raw !== null) { el.textContent = resolveVars(raw); }',
  '  });',
  '  var bodyEl = document.getElementById("resolved-body");',
  '  if (bodyEl) {',
  '    var raw = bodyEl.getAttribute("data-raw");',
  '    if (raw !== null) { bodyEl.textContent = resolveVars(raw); }',
  '  }',
  '}',
  '',
  'document.querySelectorAll(".var-input").forEach(function(input) {',
  '  input.addEventListener("input", function() {',
  '    currentVars[this.dataset.name] = this.value;',
  '    updateResolvedDisplay();',
  '  });',
  '  input.addEventListener("change", function() {',
  '    vscode.postMessage({ type: "updateVariable", name: this.dataset.name, value: this.value });',
  '  });',
  '  input.addEventListener("keydown", function(e) {',
  '    if (e.key === "Enter") { this.blur(); }',
  '  });',
  '});',
  '',
  '// ---- Send request ----',
  'btn.addEventListener("click", function() {',
  '  btn.disabled = true;',
  '  btn.innerHTML = "<span class=\\"spinner\\"></span>&nbsp;Sending\u2026";',
  '  vscode.postMessage({ type: "send" });',
  '});',
  '',
  'window.addEventListener("message", function(e) {',
  '  var msg = e.data;',
  '  btn.disabled = false;',
  '  btn.innerHTML = "&#9654;&nbsp; Send Request";',
  '  responseDiv.style.display = "block";',
  '',
  '  if (msg.type === "response") {',
  '    var sc = msg.status;',
  '    var cls = sc < 300 ? "s2" : sc < 400 ? "s3" : sc < 500 ? "s4" : "s5";',
  '',
  '    var hdrHtml = Object.entries(msg.headers).map(function(p) {',
  '      return "<div class=\\"kv-row\\"><span class=\\"kv-key\\">" + esc(p[0]) + "</span>"',
  '           + "<span class=\\"kv-sep\\">:</span><span class=\\"kv-val\\">" + esc(p[1]) + "</span></div>";',
  '    }).join("");',
  '',
  '    var bodyHtml;',
  '    if (msg.body) {',
  '      var content;',
  '      if (msg.isJson) {',
  '        try { content = renderJson(JSON.parse(msg.body), 0); }',
  '        catch(e) { content = esc(msg.body); }',
  '      } else {',
  '        content = esc(msg.body);',
  '      }',
  '      bodyHtml = "<pre class=\\"code\\">" + content + "</pre>";',
  '    } else {',
  '      bodyHtml = "<span class=\\"muted\\">No body</span>";',
  '    }',
  '',
  '    responseContent.innerHTML =',
  '      "<div class=\\"status " + cls + "\\">" + sc + " " + esc(msg.statusText)',
  '      + "<span class=\\"duration\\">" + msg.duration + "ms</span></div>"',
  '      + (hdrHtml',
  '          ? "<details><summary class=\\"section-label\\" style=\\"display:inline-flex\\">Response Headers</summary>" + hdrHtml + "</details>"',
  '          : "")',
  '      + "<div class=\\"section-label\\" style=\\"margin-top:12px\\">Body</div>"',
  '      + bodyHtml;',
  '',
  '  } else if (msg.type === "error") {',
  '    responseContent.innerHTML = "<div class=\\"error\\">" + esc(msg.message) + "</div>";',
  '  }',
  '});',
  '',
  'function esc(s) {',
  '  return String(s)',
  '    .replace(/&/g, "&amp;")',
  '    .replace(/</g, "&lt;")',
  '    .replace(/>/g, "&gt;")',
  '    .replace(/"/g, "&quot;");',
  '}',
  '',
  'function renderJson(val, depth) {',
  '  var pad = "  ".repeat(depth);',
  '  var inner = "  ".repeat(depth + 1);',
  '  if (val === null) return "<span class=\\"json-null\\">null</span>";',
  '  if (typeof val === "boolean") return "<span class=\\"json-bool\\">" + val + "</span>";',
  '  if (typeof val === "number") return "<span class=\\"json-num\\">" + val + "</span>";',
  '  if (typeof val === "string") return "<span class=\\"json-str\\">\\"" + esc(val) + "\\"</span>";',
  '  if (Array.isArray(val)) {',
  '    if (!val.length) return "[]";',
  '    var items = val.map(function(v) { return inner + renderJson(v, depth + 1); });',
  '    return "[\\n" + items.join(",\\n") + "\\n" + pad + "]";',
  '  }',
  '  var entries = Object.entries(val);',
  '  if (!entries.length) return "{}";',
  '  var fields = entries.map(function(p) {',
  '    return inner + "<span class=\\"json-key\\">\\"" + esc(p[0]) + "\\"</span>: " + renderJson(p[1], depth + 1);',
  '  });',
  '  return "{\\n" + fields.join(",\\n") + "\\n" + pad + "}";',
  '}',
].join('\n');
