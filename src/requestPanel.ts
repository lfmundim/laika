import * as vscode from 'vscode';
import { ParsedRequest, ParsedVariable, resolveRequest } from './httpParser';

// ---------------------------------------------------------------------------
// Panel manager
// ---------------------------------------------------------------------------

export class RequestPanel {
  private static current: RequestPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private request: ParsedRequest;
  private fileVars: ParsedVariable[];

  static show(
    request: ParsedRequest,
    fileVars: ParsedVariable[],
    context: vscode.ExtensionContext,
  ): void {
    if (RequestPanel.current) {
      RequestPanel.current.update(request, fileVars);
      RequestPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    RequestPanel.current = new RequestPanel(request, fileVars, context);
  }

  private constructor(
    request: ParsedRequest,
    fileVars: ParsedVariable[],
    context: vscode.ExtensionContext,
  ) {
    this.request = request;
    this.fileVars = fileVars;

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
      }
    }, null, context.subscriptions);

    this.render();
  }

  private update(request: ParsedRequest, fileVars: ParsedVariable[]): void {
    this.request = request;
    this.fileVars = fileVars;
    this.panel.title = `Laika: ${request.name}`;
    this.render();
  }

  private render(): void {
    const resolved = resolveRequest(this.request, this.fileVars);
    this.panel.webview.html = buildWebviewHtml(resolved);
  }

  private async executeRequest(): Promise<void> {
    const resolved = resolveRequest(this.request, this.fileVars);

    const headers: Record<string, string> = {};
    for (const h of resolved.headers) {
      headers[h.name] = h.value;
    }

    try {
      const init: RequestInit = { method: resolved.method, headers };
      if (resolved.body && resolved.method !== 'GET' && resolved.method !== 'HEAD') {
        init.body = resolved.body;
      }

      const t0 = Date.now();
      const res = await fetch(resolved.url, init);
      const duration = Date.now() - t0;

      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => { resHeaders[k] = v; });

      const contentType = res.headers.get('content-type') ?? '';
      const isJson = contentType.includes('application/json');
      const body = await res.text();

      this.panel.webview.postMessage({
        type: 'response',
        status: res.status,
        statusText: res.statusText,
        headers: resHeaders,
        body,
        isJson,
        duration,
      });
    } catch (err) {
      this.panel.webview.postMessage({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
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

function buildWebviewHtml(request: ParsedRequest): string {
  const headersHtml = request.headers.length > 0
    ? request.headers.map(h =>
        '<div class="kv-row">' +
        '<span class="kv-key">' + esc(h.name) + '</span>' +
        '<span class="kv-sep">:</span>' +
        '<span class="kv-val">' + esc(h.value) + '</span>' +
        '</div>'
      ).join('')
    : '<span class="muted">None</span>';

  const bodyHtml = request.body
    ? '<pre class="code">' + esc(request.body) + '</pre>'
    : '<span class="muted">No body</span>';

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
    '  <div class="request-line">\n' +
    '    <span class="badge">' + esc(request.method) + '</span>\n' +
    '    <span class="url">' + esc(request.url) + '</span>\n' +
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
    '<script>\n' +
    SCRIPT +
    '\n</script>\n' +
    '</body>\n' +
    '</html>'
  );
}

// ---------------------------------------------------------------------------
// Styles — kept as a constant so the function above stays readable
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
