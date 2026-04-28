// Code coverage excluded: depends on vscode APIs and vm module requiring the extension host.
import * as vm from 'vm';
import * as fs from 'fs';
import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Public context types
// ---------------------------------------------------------------------------

export interface ScriptRequestContext {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface ScriptResponseContext {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  duration: number;
  /** Parse the response body as JSON. Returns null if the body is not valid JSON. */
  json(): unknown;
}

export interface PreScriptContext {
  /** The outgoing request — all fields are mutable. */
  request: ScriptRequestContext;
  /** Combined variables map (env merged with file vars). Mutations are persisted back to the .http file. */
  variables: Record<string, string>;
  /** Read-only snapshot of the active environment variables. */
  env: Record<string, string>;
  /** Routes to the "Laika Scripts" output channel. */
  console: ScriptConsole;
}

export interface PostScriptContext {
  /** The request that was sent — read-only. */
  request: Readonly<ScriptRequestContext>;
  /** The received response. */
  response: ScriptResponseContext;
  /** Combined variables map. Mutations are persisted back to the .http file. */
  variables: Record<string, string>;
  /** Routes to the "Laika Scripts" output channel. */
  console: ScriptConsole;
}

interface ScriptConsole {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Run a .js script file in a sandboxed Node.js vm context.
 *
 * The script receives `context` as its global scope. All mutations to
 * `context.request`, `context.variables`, etc. are visible to the caller
 * after this function returns, because `vm.createContext` contextifies
 * the object in-place rather than copying it.
 *
 * Scripts are wrapped in an async IIFE so top-level `await` is supported.
 * The `laika.scriptTimeout` setting (seconds, default 10) guards the
 * synchronous portion of execution; async continuations run to completion.
 *
 * @returns `true` if the script ran successfully, `false` if the file was
 *          not found (the caller may choose to skip rather than abort).
 * @throws  Re-throws script exceptions after logging them to the output channel.
 */
export async function runScript(
  scriptPath: string,
  context: PreScriptContext | PostScriptContext,
  outputChannel: vscode.OutputChannel,
): Promise<boolean> {
  let code: string;
  try {
    code = fs.readFileSync(scriptPath, 'utf8');
  } catch {
    outputChannel.appendLine(`[Laika Scripts] File not found, skipping: ${scriptPath}`);
    return false;
  }

  const timeoutSeconds = vscode.workspace
    .getConfiguration('laika')
    .get<number>('scriptTimeout', 10);

  // Build the console implementation that routes to the output channel.
  const scriptConsole = {
    log:   (...args: unknown[]) => outputChannel.appendLine('[log]   ' + args.map(String).join(' ')),
    warn:  (...args: unknown[]) => outputChannel.appendLine('[warn]  ' + args.map(String).join(' ')),
    error: (...args: unknown[]) => outputChannel.appendLine('[error] ' + args.map(String).join(' ')),
  };

  // Inject before contextifying so the property exists on the object.
  (context as unknown as Record<string, unknown>)['console'] = scriptConsole;

  // vm.createContext contextifies the object in-place — property mutations
  // made inside the script are reflected on the original object after execution.
  const vmContext = vm.createContext(context as unknown as object);

  // Re-assign after createContext: Electron's runtime can set its own console
  // on the V8 context during contextification, overwriting what we injected above.
  (vmContext as unknown as Record<string, unknown>)['console'] = scriptConsole;

  outputChannel.appendLine(`[Laika Scripts] ▶ ${scriptPath}`);
  const wrapped = `(async () => { ${code} })()`;

  let resultPromise: Promise<unknown>;
  try {
    const script = new vm.Script(wrapped, { filename: scriptPath });
    resultPromise = script.runInContext(vmContext, {
      timeout: timeoutSeconds * 1000,
    }) as Promise<unknown>;
  } catch (err) {
    const msg = `[Laika Scripts] Error in ${scriptPath}: ${err instanceof Error ? err.message : String(err)}`;
    outputChannel.appendLine(msg);
    vscode.window.showErrorMessage(msg);
    throw err;
  }

  try {
    await resultPromise;
  } catch (err) {
    const msg = `[Laika Scripts] Error in ${scriptPath}: ${err instanceof Error ? err.message : String(err)}`;
    outputChannel.appendLine(msg);
    vscode.window.showErrorMessage(msg);
    throw err;
  }

  return true;
}
