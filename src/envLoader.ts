import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Environment {
  name: string;       // e.g. "dev", "staging", "remote"
  envFilePath: string; // absolute path to the http-client.env.json that defines it
}

export interface EnvVariable {
  name: string;
  value: string;
}

// ---------------------------------------------------------------------------
// Internal JSON shape
// ---------------------------------------------------------------------------

// Values can be plain strings or provider objects (AspnetUserSecrets, AzureKeyVault,
// Encrypted). We only support plain strings; provider objects are silently skipped.
type EnvBlock = Record<string, string | object>;
type EnvJson  = Record<string, EnvBlock>;

function readJson(filePath: string): EnvJson | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as EnvJson;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Discover all named environments by scanning workspace root folders for
 * `http-client.env.json`. The `$shared` key is a defaults namespace, not a
 * selectable environment, so it is excluded from results.
 */
export function discoverEnvironments(
  workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined,
): Environment[] {
  if (!workspaceFolders || workspaceFolders.length === 0) { return []; }

  const envs: Environment[] = [];
  const seen = new Set<string>();

  for (const folder of workspaceFolders) {
    const envFilePath = path.join(folder.uri.fsPath, 'http-client.env.json');
    const json = readJson(envFilePath);
    if (!json) { continue; }

    for (const name of Object.keys(json)) {
      if (name === '$shared') { continue; }
      if (!seen.has(name)) {
        seen.add(name);
        envs.push({ name, envFilePath });
      }
    }
  }

  return envs;
}

/**
 * Find the closest `http-client.env.json` by walking up from the directory
 * that contains the given `.http` file, stopping at the filesystem root.
 * This mirrors Visual Studio's own search strategy.
 */
export function findEnvFileForHttp(httpFilePath: string): string | undefined {
  let dir = path.dirname(httpFilePath);
  while (true) {
    const candidate = path.join(dir, 'http-client.env.json');
    if (fs.existsSync(candidate)) { return candidate; }
    const parent = path.dirname(dir);
    if (parent === dir) { break; }
    dir = parent;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Load variables for a specific environment from an `http-client.env.json` file.
 *
 * Merge order (highest priority wins):
 *   1. `http-client.env.json.user` — environment block
 *   2. `http-client.env.json`      — environment block
 *   3. `http-client.env.json.user` — `$shared` block
 *   4. `http-client.env.json`      — `$shared` block  (lowest)
 *
 * Only plain string values are returned. Provider-based secrets
 * (AspnetUserSecrets, AzureKeyVault, Encrypted) are silently skipped —
 * resolving them requires runtime infrastructure Laika doesn't have.
 */
export function loadEnvironment(envFilePath: string, envName: string): EnvVariable[] {
  const main = readJson(envFilePath) ?? {};
  const user = readJson(envFilePath + '.user') ?? {};

  const merged: Record<string, string> = {};
  applyBlock(main['$shared'], merged);
  applyBlock(user['$shared'], merged);
  applyBlock(main[envName],   merged);
  applyBlock(user[envName],   merged);

  return Object.entries(merged).map(([name, value]) => ({ name, value }));
}

function applyBlock(block: EnvBlock | undefined, target: Record<string, string>): void {
  if (!block || typeof block !== 'object') { return; }
  for (const [key, val] of Object.entries(block)) {
    if (typeof val === 'string') { target[key] = val; }
  }
}
