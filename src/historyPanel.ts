// Code coverage excluded: this file creates vscode.WebviewPanel instances via
// vscode.window.createWebviewPanel, which requires the VS Code extension host.
// Unit testing requires @vscode/test-electron (integration tests), deferred.
import * as vscode from 'vscode';
import { HistoryEntry } from './historyStore';

export class HistoryPanel {
  private static current: HistoryPanel | undefined;

  private readonly panel: vscode.WebviewPanel;

  static show(entry: HistoryEntry, context: vscode.ExtensionContext): void {
    if (HistoryPanel.current) {
      HistoryPanel.current.panel.dispose();
    }
    HistoryPanel.current = new HistoryPanel(entry, context);
  }

  private constructor(entry: HistoryEntry, context: vscode.ExtensionContext) {
    const shortUrl = entry.request.url.length > 50
      ? entry.request.url.slice(0, 47) + '…'
      : entry.request.url;
    const title = entry.requestName
      ? `History: ${entry.requestName}`
      : `History: ${entry.request.method} ${shortUrl}`;

    this.panel = vscode.window.createWebviewPanel(
      'laikaHistoryEntry',
      title,
      vscode.ViewColumn.Beside,
      { enableScripts: false },
    );

    this.panel.onDidDispose(() => {
      HistoryPanel.current = undefined;
    }, null, context.subscriptions);

    this.panel.webview.html = buildHistoryHtml(entry);
  }
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHistoryHtml(entry: HistoryEntry): string {
  const { request, response, error, timestamp, requestName } = entry;

  const ts = new Date(timestamp).toLocaleString();
  const methodBadge = `<span class="badge">${esc(request.method)}</span>`;

  const reqHeadersHtml = Object.entries(request.headers).length > 0
    ? Object.entries(request.headers).map(([k, v]) =>
        `<div class="kv-row"><span class="kv-key">${esc(k)}</span><span class="kv-sep">:</span><span class="kv-val">${esc(v)}</span></div>`,
      ).join('')
    : '<span class="muted">None</span>';

  const reqBodyHtml = request.body
    ? `<pre class="code">${esc(request.body)}</pre>`
    : '<span class="muted">No body</span>';

  let responseSection: string;
  if (error) {
    responseSection = `<div class="error">${esc(error)}</div>`;
  } else if (response) {
    const sc = response.status;
    const cls = sc < 300 ? 's2' : sc < 400 ? 's3' : sc < 500 ? 's4' : 's5';

    const resHeadersHtml = Object.entries(response.headers).length > 0
      ? `<details><summary class="section-label" style="display:inline-flex">Response Headers</summary>` +
        Object.entries(response.headers).map(([k, v]) =>
          `<div class="kv-row"><span class="kv-key">${esc(k)}</span><span class="kv-sep">:</span><span class="kv-val">${esc(v)}</span></div>`,
        ).join('') +
        `</details>`
      : '';

    let bodyContent: string;
    if (response.body) {
      let rendered: string;
      if (response.headers['content-type']?.includes('application/json')) {
        try {
          rendered = syntaxHighlightJson(response.body);
        } catch {
          rendered = esc(response.body);
        }
      } else {
        rendered = esc(response.body);
      }
      bodyContent = `<pre class="code">${rendered}</pre>`;
    } else {
      bodyContent = '<span class="muted">No body</span>';
    }

    responseSection =
      `<div class="status ${cls}">${sc} ${esc(response.statusText)}<span class="duration">${response.duration}ms</span></div>` +
      resHeadersHtml +
      `<div class="section-label" style="margin-top:12px">Body</div>` +
      bodyContent;
  } else {
    responseSection = '<span class="muted">No response recorded</span>';
  }

  return (
    '<!DOCTYPE html>\n' +
    '<html lang="en">\n' +
    '<head>\n' +
    '<meta charset="UTF-8">\n' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\';">\n' +
    '<style>\n' + HISTORY_CSS + '\n</style>\n' +
    '</head>\n' +
    '<body>\n' +
    `<div class="meta">${esc(ts)}${requestName ? ` &mdash; <strong>${esc(requestName)}</strong>` : ''}</div>\n` +
    `<div class="request-line">${methodBadge}<span class="url">${esc(request.url)}</span></div>\n` +
    '<div class="section-label">Request Headers</div>\n' +
    `<div class="section-body">${reqHeadersHtml}</div>\n` +
    '<div class="section-label">Request Body</div>\n' +
    `<div class="section-body">${reqBodyHtml}</div>\n` +
    '<hr class="divider">\n' +
    '<div class="section-label">Response</div>\n' +
    `<div class="section-body">${responseSection}</div>\n` +
    '</body>\n' +
    '</html>'
  );
}

function syntaxHighlightJson(raw: string): string {
  // Simple token-based highlighter — avoids regex on full JSON
  const parsed = JSON.parse(raw);
  return renderJsonValue(parsed, 0);
}

function renderJsonValue(val: unknown, depth: number): string {
  const pad = '  '.repeat(depth);
  const inner = '  '.repeat(depth + 1);
  if (val === null) { return '<span class="json-null">null</span>'; }
  if (typeof val === 'boolean') { return `<span class="json-bool">${val}</span>`; }
  if (typeof val === 'number') { return `<span class="json-num">${val}</span>`; }
  if (typeof val === 'string') { return `<span class="json-str">&quot;${esc(val)}&quot;</span>`; }
  if (Array.isArray(val)) {
    if (!val.length) { return '[]'; }
    const items = val.map(v => inner + renderJsonValue(v, depth + 1));
    return `[\n${items.join(',\n')}\n${pad}]`;
  }
  const entries = Object.entries(val as Record<string, unknown>);
  if (!entries.length) { return '{}'; }
  const fields = entries.map(([k, v]) =>
    `${inner}<span class="json-key">&quot;${esc(k)}&quot;</span>: ${renderJsonValue(v, depth + 1)}`,
  );
  return `{\n${fields.join(',\n')}\n${pad}}`;
}

const HISTORY_CSS = [
  '* { box-sizing: border-box; }',
  'body {',
  '  font-family: var(--vscode-font-family);',
  '  font-size: var(--vscode-font-size);',
  '  color: var(--vscode-foreground);',
  '  background: var(--vscode-editor-background);',
  '  padding: 20px 24px; margin: 0; line-height: 1.5;',
  '}',
  '.meta { font-size: 0.8em; color: var(--vscode-descriptionForeground); margin-bottom: 14px; }',
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
