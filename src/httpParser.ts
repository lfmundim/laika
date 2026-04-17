/**
 * Parser for .http files (REST Client format).
 *
 * Supported syntax:
 *   - Requests separated by `###` (optional label after the `###`)
 *   - `# @name <label>` or `// @name <label>` request names
 *   - `@varName = value` file-level variable declarations
 *   - `{{varName}}` variable substitution in URLs, headers, and bodies
 *   - Standard HTTP request line: `METHOD URL [HTTP/version]`
 *   - Headers: `Key: Value` lines immediately after the request line
 *   - Body: everything after the first blank line following the headers
 */

import type { EnvVariable } from './envLoader';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ParsedVariable {
  name: string;
  value: string;
  /** 0-based line index in the original file */
  line: number;
}

export interface ParsedHeader {
  name: string;
  value: string;
}

export interface ParsedRequest {
  /** Display name — from `# @name`, the `###` label, or derived from method+url */
  name: string;
  method: string;
  url: string;
  httpVersion: string;
  headers: ParsedHeader[];
  body: string | undefined;
  /** Optional markdown description extracted from comment lines before the request line */
  description: string | undefined;
  /** 0-based index of this request within the file */
  index: number;
  /** Raw text of the block (after variable substitution is NOT applied here; use resolveRequest) */
  raw: string;
}

export interface ParsedFile {
  variables: ParsedVariable[];
  requests: ParsedRequest[];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Parse a full .http file and return all variable declarations and requests.
 * Variables are NOT yet substituted into request fields; call `resolveRequest`
 * to get a request with `{{var}}` tokens replaced.
 */
export function parseHttpFile(text: string): ParsedFile {
  const variables = extractVariables(text);
  const blocks = splitIntoBlocks(text);
  const requests = blocks
    .map((block, index) => parseBlock(block, index))
    .filter((r): r is ParsedRequest => r !== null);
  return { variables, requests };
}

/**
 * Return a copy of `request` with all `{{varName}}` tokens replaced.
 *
 * Variable priority (highest wins):
 *   1. Inline `@var` declarations within the request block
 *   2. File-level `@var` declarations
 *   3. Environment variables from the active `.env` file
 */
export function resolveRequest(
  request: ParsedRequest,
  fileVariables: ParsedVariable[],
  envVariables?: EnvVariable[],
): ParsedRequest {
  // Lowest priority: env file variables
  const vars: Record<string, string> = {};
  if (envVariables) {
    for (const v of envVariables) { vars[v.name] = v.value; }
  }

  // File-level variables override env variables
  for (const v of fileVariables) { vars[v.name] = v.value; }

  // Inline @var declarations within the block take highest priority
  const inlineVars = extractVariables(request.raw);
  for (const v of inlineVars) {
    vars[v.name] = v.value;
  }

  const substitute = (s: string) => applySubstitution(s, vars);

  return {
    ...request,
    url: substitute(request.url),
    headers: request.headers.map(h => ({ name: h.name, value: substitute(h.value) })),
    body: request.body !== undefined ? substitute(request.body) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Block splitting
// ---------------------------------------------------------------------------

/**
 * Split raw file text into request blocks on `###` separator lines.
 * Returns each block trimmed, paired with the optional inline label from `###`.
 */
function splitIntoBlocks(text: string): Array<{ content: string; separatorLabel: string }> {
  const parts = text.split(/^###[^\S\r\n]*(.*)$/m);
  // parts = [before-first-###, label1, block1, label2, block2, ...]
  const blocks: Array<{ content: string; separatorLabel: string }> = [];

  if (parts.length === 1) {
    // No ### separators — whole file is one block
    const trimmed = parts[0].trim();
    if (trimmed) {
      blocks.push({ content: trimmed, separatorLabel: '' });
    }
    return blocks;
  }

  // First segment before any ### (may be empty)
  const first = parts[0].trim();
  if (first) {
    blocks.push({ content: first, separatorLabel: '' });
  }

  // Remaining pairs: [label, content, label, content, ...]
  for (let i = 1; i < parts.length; i += 2) {
    const label = (parts[i] ?? '').trim();
    const content = (parts[i + 1] ?? '').trim();
    if (content) {
      blocks.push({ content, separatorLabel: label });
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Variable extraction
// ---------------------------------------------------------------------------

/** Extract all `@varName = value` declarations from text (file or block scope). */
function extractVariables(text: string): ParsedVariable[] {
  const vars: ParsedVariable[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^@(\w+)\s*=\s*(.*)$/);
    if (match) {
      vars.push({ name: match[1], value: match[2].trim(), line: i });
    }
  }
  return vars;
}

/**
 * Return the distinct set of variable names referenced as `{{varName}}` tokens
 * in a request's URL, header values, and body. Used to synthesize editable
 * placeholder entries when no file-level declaration exists.
 */
export function extractReferencedVarNames(request: ParsedRequest): string[] {
  const pattern = /\{\{(\w+)\}\}/g;
  const names = new Set<string>();
  const addMatches = (text: string) => { for (const m of text.matchAll(pattern)) { names.add(m[1]); } };
  addMatches(request.url);
  for (const h of request.headers) { addMatches(h.value); }
  if (request.body) { addMatches(request.body); }
  return [...names];
}

/** Replace all `{{varName}}` tokens using the provided map. Unknown vars are left as-is. */
function applySubstitution(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : match,
  );
}

// ---------------------------------------------------------------------------
// Block parsing
// ---------------------------------------------------------------------------

const HTTP_METHODS = new Set([
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE',
  'HEAD', 'OPTIONS', 'CONNECT', 'TRACE',
]);

function parseBlock(
  block: { content: string; separatorLabel: string },
  index: number,
): ParsedRequest | null {
  const lines = block.content.split('\n');
  let nameAnnotation = '';
  let requestLineIndex = -1;

  // Scan for `# @name` annotation and the first HTTP method line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // @name annotation
    const nameMatch = line.match(/^(?:#|\/\/)\s*@name\s+(.+)/);
    if (nameMatch) {
      nameAnnotation = nameMatch[1].trim();
      continue;
    }

    // Skip comment lines and @var declarations
    if (line.startsWith('#') || line.startsWith('//') || line.startsWith('@')) {
      continue;
    }

    // HTTP request line: METHOD URL [HTTP/version]
    const methodMatch = line.match(/^([A-Z]+)\s+(\S+)(?:\s+(HTTP\/[\d.]+))?/);
    if (methodMatch && HTTP_METHODS.has(methodMatch[1])) {
      requestLineIndex = i;
      break;
    }
  }

  if (requestLineIndex === -1) {
    return null; // No valid request line found
  }

  const requestLine = lines[requestLineIndex].trim();
  const methodMatch = requestLine.match(/^([A-Z]+)\s+(\S+)(?:\s+(HTTP\/[\d.]+))?/)!;
  const method = methodMatch[1];
  const url = methodMatch[2];
  const httpVersion = methodMatch[3] ?? 'HTTP/1.1';

  // Parse headers: lines immediately after the request line, up to the first blank line
  const headers: ParsedHeader[] = [];
  let bodyStartIndex = -1;

  for (let i = requestLineIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      bodyStartIndex = i + 1;
      break;
    }

    // Skip comment lines within headers
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
      continue;
    }

    const headerMatch = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (headerMatch) {
      headers.push({ name: headerMatch[1].trim(), value: headerMatch[2].trim() });
    }
  }

  // Everything after the blank line is the body
  let body: string | undefined;
  if (bodyStartIndex !== -1 && bodyStartIndex < lines.length) {
    const bodyText = lines.slice(bodyStartIndex).join('\n').trim();
    if (bodyText) {
      body = bodyText;
    }
  }

  // Derive display name
  const name =
    nameAnnotation ||
    block.separatorLabel ||
    deriveNameFromRequestLine(method, url);

  // Collect description from non-annotation comment lines before the request line
  const descLines: string[] = [];
  for (let i = 0; i < requestLineIndex; i++) {
    const line = lines[i].trim();
    if (!line) { continue; }
    if (line.match(/^(?:#|\/\/)\s*@\w+/)) { continue; } // skip annotations like @name
    if (line.startsWith('@')) { continue; }               // skip @var declarations
    if (!line.startsWith('#') && !line.startsWith('//')) { continue; }
    const stripped = line.replace(/^(?:\/\/\s?|#\s?)/, '');
    if (stripped) { descLines.push(stripped); }
  }
  const description = descLines.length > 0 ? descLines.join('\n') : undefined;

  return {
    name,
    method,
    url,
    httpVersion,
    headers,
    body,
    description,
    index,
    raw: block.content,
  };
}

function deriveNameFromRequestLine(method: string, url: string): string {
  const label = `${method} ${url}`;
  return label.length > 60 ? label.slice(0, 57) + '…' : label;
}
