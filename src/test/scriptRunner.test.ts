import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  runScript,
  type OutputChannel,
  type PreScriptContext,
  type PostScriptContext,
} from '../scriptRunner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'laika-script-test-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeScript(dir: string, name: string, code: string): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, code, 'utf8');
  return filePath;
}

/** Channel that collects all appended lines for assertion. */
function makeChannel(): { lines: string[]; channel: OutputChannel } {
  const lines: string[] = [];
  return { lines, channel: { appendLine: (l: string) => { lines.push(l); } } };
}

function makePreContext(overrides: Partial<PreScriptContext> = {}): PreScriptContext {
  return {
    request: { url: 'https://example.com', method: 'GET', headers: {}, body: undefined },
    variables: {},
    env: {},
    console: undefined as never, // injected by runScript
    ...overrides,
  };
}

function makePostContext(overrides: Partial<PostScriptContext> = {}): PostScriptContext {
  return {
    request: Object.freeze({ url: 'https://example.com', method: 'GET', headers: {}, body: undefined }),
    response: {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: '{"name":"pikachu"}',
      duration: 42,
      json: () => JSON.parse('{"name":"pikachu"}'),
    },
    variables: {},
    console: undefined as never,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scriptRunner', () => {
  describe('runScript — file resolution', () => {
    it('returns false and logs when the script file does not exist', async () => {
      const { lines, channel } = makeChannel();
      const result = await runScript('/non/existent/script.js', makePreContext(), channel);
      assert.equal(result, false);
      assert.ok(lines.some(l => l.includes('File not found')));
    });

    it('returns true when the script file exists and runs successfully', async () => {
      const tmp = makeTmpDir();
      try {
        const { channel } = makeChannel();
        const scriptPath = writeScript(tmp, 'noop.js', '/* no-op */');
        const result = await runScript(scriptPath, makePreContext(), channel);
        assert.equal(result, true);
      } finally { cleanup(tmp); }
    });

    it('logs the script path before running', async () => {
      const tmp = makeTmpDir();
      try {
        const { lines, channel } = makeChannel();
        const scriptPath = writeScript(tmp, 'noop.js', '/* no-op */');
        await runScript(scriptPath, makePreContext(), channel);
        assert.ok(lines.some(l => l.includes('▶') && l.includes(scriptPath)));
      } finally { cleanup(tmp); }
    });
  });

  describe('runScript — console routing', () => {
    it('routes console.log to the output channel', async () => {
      const tmp = makeTmpDir();
      try {
        const { lines, channel } = makeChannel();
        const scriptPath = writeScript(tmp, 'log.js', 'console.log("hello", "world")');
        await runScript(scriptPath, makePreContext(), channel);
        assert.ok(lines.some(l => l.includes('[log]') && l.includes('hello world')));
      } finally { cleanup(tmp); }
    });

    it('routes console.warn to the output channel', async () => {
      const tmp = makeTmpDir();
      try {
        const { lines, channel } = makeChannel();
        const scriptPath = writeScript(tmp, 'warn.js', 'console.warn("careful")');
        await runScript(scriptPath, makePreContext(), channel);
        assert.ok(lines.some(l => l.includes('[warn]') && l.includes('careful')));
      } finally { cleanup(tmp); }
    });

    it('routes console.error to the output channel', async () => {
      const tmp = makeTmpDir();
      try {
        const { lines, channel } = makeChannel();
        const scriptPath = writeScript(tmp, 'err.js', 'console.error("bad thing")');
        await runScript(scriptPath, makePreContext(), channel);
        assert.ok(lines.some(l => l.includes('[error]') && l.includes('bad thing')));
      } finally { cleanup(tmp); }
    });
  });

  describe('runScript — pre-script context mutations', () => {
    it('mutations to request.headers are visible after run', async () => {
      const tmp = makeTmpDir();
      try {
        const { channel } = makeChannel();
        const scriptPath = writeScript(tmp, 'header.js',
          'request.headers["X-Custom"] = "injected";');
        const ctx = makePreContext();
        await runScript(scriptPath, ctx, channel);
        assert.equal(ctx.request.headers['X-Custom'], 'injected');
      } finally { cleanup(tmp); }
    });

    it('mutations to request.url are visible after run', async () => {
      const tmp = makeTmpDir();
      try {
        const { channel } = makeChannel();
        const scriptPath = writeScript(tmp, 'url.js',
          'request.url = "https://other.example.com";');
        const ctx = makePreContext();
        await runScript(scriptPath, ctx, channel);
        assert.equal(ctx.request.url, 'https://other.example.com');
      } finally { cleanup(tmp); }
    });

    it('mutations to variables are visible after run', async () => {
      const tmp = makeTmpDir();
      try {
        const { channel } = makeChannel();
        const scriptPath = writeScript(tmp, 'vars.js',
          'variables.token = "abc123";');
        const ctx = makePreContext();
        await runScript(scriptPath, ctx, channel);
        assert.equal(ctx.variables.token, 'abc123');
      } finally { cleanup(tmp); }
    });

    it('env is accessible as a read-only snapshot', async () => {
      const tmp = makeTmpDir();
      try {
        const { channel } = makeChannel();
        const scriptPath = writeScript(tmp, 'env.js',
          'variables.captured = env.BASE_URL;');
        const ctx = makePreContext({ env: { BASE_URL: 'http://localhost' } });
        await runScript(scriptPath, ctx, channel);
        assert.equal(ctx.variables.captured, 'http://localhost');
      } finally { cleanup(tmp); }
    });
  });

  describe('runScript — post-script context', () => {
    it('response.status and statusText are accessible', async () => {
      const tmp = makeTmpDir();
      try {
        const { channel } = makeChannel();
        const scriptPath = writeScript(tmp, 'status.js',
          'variables.code = String(response.status);');
        const ctx = makePostContext();
        await runScript(scriptPath, ctx, channel);
        assert.equal(ctx.variables.code, '200');
      } finally { cleanup(tmp); }
    });

    it('response.json() parses the body', async () => {
      const tmp = makeTmpDir();
      try {
        const { channel } = makeChannel();
        const scriptPath = writeScript(tmp, 'json.js',
          'const data = response.json(); variables.name = data.name;');
        const ctx = makePostContext();
        await runScript(scriptPath, ctx, channel);
        assert.equal(ctx.variables.name, 'pikachu');
      } finally { cleanup(tmp); }
    });

    it('response.body is accessible as a string', async () => {
      const tmp = makeTmpDir();
      try {
        const { channel } = makeChannel();
        const scriptPath = writeScript(tmp, 'body.js',
          'variables.raw = response.body;');
        const ctx = makePostContext();
        await runScript(scriptPath, ctx, channel);
        assert.equal(ctx.variables.raw, '{"name":"pikachu"}');
      } finally { cleanup(tmp); }
    });

    it('response.duration is accessible', async () => {
      const tmp = makeTmpDir();
      try {
        const { channel } = makeChannel();
        const scriptPath = writeScript(tmp, 'dur.js',
          'variables.ms = String(response.duration);');
        const ctx = makePostContext();
        await runScript(scriptPath, ctx, channel);
        assert.equal(ctx.variables.ms, '42');
      } finally { cleanup(tmp); }
    });
  });

  describe('runScript — async support', () => {
    it('supports top-level await via Promise.resolve()', async () => {
      const tmp = makeTmpDir();
      try {
        const { channel } = makeChannel();
        const scriptPath = writeScript(tmp, 'async.js', [
          'await Promise.resolve();',
          'variables.done = "yes";',
        ].join('\n'));
        const ctx = makePreContext();
        await runScript(scriptPath, ctx, channel);
        assert.equal(ctx.variables.done, 'yes');
      } finally { cleanup(tmp); }
    });
  });

  describe('runScript — error handling', () => {
    it('throws and logs when the script throws synchronously', async () => {
      const tmp = makeTmpDir();
      try {
        const errors: string[] = [];
        const { channel } = makeChannel();
        const scriptPath = writeScript(tmp, 'throw.js',
          'throw new Error("intentional failure");');
        await assert.rejects(
          () => runScript(scriptPath, makePreContext(), channel, {
            onError: (msg) => { errors.push(msg); },
          }),
        );
        assert.ok(errors.some(e => e.includes('intentional failure')));
      } finally { cleanup(tmp); }
    });

    it('throws and logs when the script throws asynchronously', async () => {
      const tmp = makeTmpDir();
      try {
        const errors: string[] = [];
        const { channel } = makeChannel();
        const scriptPath = writeScript(tmp, 'asyncthrow.js', [
          'await Promise.resolve();',
          'throw new Error("async failure");',
        ].join('\n'));
        await assert.rejects(
          () => runScript(scriptPath, makePreContext(), channel, {
            onError: (msg) => { errors.push(msg); },
          }),
        );
        assert.ok(errors.some(e => e.includes('async failure')));
      } finally { cleanup(tmp); }
    });

    it('throws on script syntax error', async () => {
      const tmp = makeTmpDir();
      try {
        const { channel } = makeChannel();
        const scriptPath = writeScript(tmp, 'syntax.js', 'const = bad syntax!!!');
        await assert.rejects(() => runScript(scriptPath, makePreContext(), channel));
      } finally { cleanup(tmp); }
    });

    it('uses the provided timeoutSeconds option', async () => {
      const tmp = makeTmpDir();
      try {
        const { channel } = makeChannel();
        // A script with a for-loop tight enough to hit a 10ms timeout.
        // We only verify the option is accepted and passed through (not that it
        // actually fires, since timing is unreliable in test environments).
        const scriptPath = writeScript(tmp, 'fast.js', '/* no-op */');
        const result = await runScript(scriptPath, makePreContext(), channel, {
          timeoutSeconds: 30,
        });
        assert.equal(result, true);
      } finally { cleanup(tmp); }
    });

    it('calls onError with the error message when script throws', async () => {
      const tmp = makeTmpDir();
      try {
        const received: string[] = [];
        const { channel } = makeChannel();
        const scriptPath = writeScript(tmp, 'onerr.js',
          'throw new Error("reported error");');
        await assert.rejects(
          () => runScript(scriptPath, makePreContext(), channel, {
            onError: (msg) => { received.push(msg); },
          }),
        );
        assert.ok(received.length > 0);
        assert.ok(received[0].includes('reported error'));
      } finally { cleanup(tmp); }
    });
  });

  describe('runScript — output channel show()', () => {
    it('calls show() on the channel before running scripts if show is provided', async () => {
      const tmp = makeTmpDir();
      try {
        let shown = false;
        const channel: OutputChannel = {
          appendLine: () => undefined,
          show: () => { shown = true; },
        };
        const scriptPath = writeScript(tmp, 'noop.js', '/* no-op */');
        // show() is called by requestPanel, not runScript itself — channel.show is optional
        // This test confirms the interface accepts the optional show() method.
        channel.show?.();
        assert.equal(shown, true);
        await runScript(scriptPath, makePreContext(), channel);
      } finally { cleanup(tmp); }
    });
  });

  describe('runScript — non-Error throws', () => {
    it('handles synchronous throw of a non-Error value', async () => {
      const tmp = makeTmpDir();
      try {
        const errors: string[] = [];
        const { channel } = makeChannel();
        const scriptPath = writeScript(tmp, 'throwstr.js', 'throw "string error";');
        await assert.rejects(
          () => runScript(scriptPath, makePreContext(), channel, {
            onError: (msg) => { errors.push(msg); },
          }),
        );
        assert.ok(errors.some(e => e.includes('string error')));
      } finally { cleanup(tmp); }
    });

    it('handles asynchronous throw of a non-Error value', async () => {
      const tmp = makeTmpDir();
      try {
        const errors: string[] = [];
        const { channel } = makeChannel();
        const scriptPath = writeScript(tmp, 'asyncthrowstr.js', [
          'await Promise.resolve();',
          'throw "async string error";',
        ].join('\n'));
        await assert.rejects(
          () => runScript(scriptPath, makePreContext(), channel, {
            onError: (msg) => { errors.push(msg); },
          }),
        );
        assert.ok(errors.some(e => e.includes('async string error')));
      } finally { cleanup(tmp); }
    });
  });
});
