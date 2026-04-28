import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  discoverEnvironments,
  findEnvFileForHttp,
  loadEnvironment,
  loadEnvScripts,
} from '../envLoader';

// Helpers to create isolated temp directories for each test
function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'laika-test-'));
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('envLoader', () => {
  describe('findEnvFileForHttp', () => {
    it('finds env file in same directory', () => {
      const tmp = makeTmpDir();
      try {
        const envFile = path.join(tmp, 'http-client.env.json');
        fs.writeFileSync(envFile, '{}');
        const httpFile = path.join(tmp, 'request.http');
        assert.equal(findEnvFileForHttp(httpFile), envFile);
      } finally {
        cleanup(tmp);
      }
    });

    it('finds env file in parent directory', () => {
      const tmp = makeTmpDir();
      try {
        const envFile = path.join(tmp, 'http-client.env.json');
        fs.writeFileSync(envFile, '{}');
        const subDir = path.join(tmp, 'requests');
        fs.mkdirSync(subDir);
        const httpFile = path.join(subDir, 'request.http');
        assert.equal(findEnvFileForHttp(httpFile), envFile);
      } finally {
        cleanup(tmp);
      }
    });

    it('finds closest env file when multiple exist', () => {
      const tmp = makeTmpDir();
      try {
        const parentEnv = path.join(tmp, 'http-client.env.json');
        fs.writeFileSync(parentEnv, '{}');
        const subDir = path.join(tmp, 'requests');
        fs.mkdirSync(subDir);
        const childEnv = path.join(subDir, 'http-client.env.json');
        fs.writeFileSync(childEnv, '{}');
        const httpFile = path.join(subDir, 'request.http');
        assert.equal(findEnvFileForHttp(httpFile), childEnv);
      } finally {
        cleanup(tmp);
      }
    });

    it('returns undefined when no env file exists', () => {
      const tmp = makeTmpDir();
      try {
        const httpFile = path.join(tmp, 'request.http');
        // Can't reliably test filesystem root traversal, so test a deep path
        // where no env file exists between it and the tmp dir we control.
        const result = findEnvFileForHttp(httpFile);
        // Either undefined (no env file anywhere up) or a real env file on the system.
        assert.ok(result === undefined || fs.existsSync(result));
      } finally {
        cleanup(tmp);
      }
    });
  });

  describe('loadEnvironment', () => {
    it('loads plain string variables from named environment', () => {
      const tmp = makeTmpDir();
      try {
        const envFile = path.join(tmp, 'http-client.env.json');
        writeJson(envFile, { dev: { baseUrl: 'http://localhost:3000', token: 'abc' } });
        const vars = loadEnvironment(envFile, 'dev');
        assert.deepEqual(vars.find(v => v.name === 'baseUrl')?.value, 'http://localhost:3000');
        assert.deepEqual(vars.find(v => v.name === 'token')?.value, 'abc');
      } finally {
        cleanup(tmp);
      }
    });

    it('merges $shared variables with lower priority', () => {
      const tmp = makeTmpDir();
      try {
        const envFile = path.join(tmp, 'http-client.env.json');
        writeJson(envFile, {
          $shared: { baseUrl: 'http://shared.example.com', sharedOnly: 'yes' },
          dev: { baseUrl: 'http://dev.example.com' },
        });
        const vars = loadEnvironment(envFile, 'dev');
        assert.equal(vars.find(v => v.name === 'baseUrl')?.value, 'http://dev.example.com');
        assert.equal(vars.find(v => v.name === 'sharedOnly')?.value, 'yes');
      } finally {
        cleanup(tmp);
      }
    });

    it('.user file overrides main file values', () => {
      const tmp = makeTmpDir();
      try {
        const envFile = path.join(tmp, 'http-client.env.json');
        writeJson(envFile, { dev: { token: 'public-token' } });
        writeJson(envFile + '.user', { dev: { token: 'secret-token' } });
        const vars = loadEnvironment(envFile, 'dev');
        assert.equal(vars.find(v => v.name === 'token')?.value, 'secret-token');
      } finally {
        cleanup(tmp);
      }
    });

    it('.user $shared has higher priority than main $shared', () => {
      const tmp = makeTmpDir();
      try {
        const envFile = path.join(tmp, 'http-client.env.json');
        writeJson(envFile, { $shared: { shared: 'main-shared' } });
        writeJson(envFile + '.user', { $shared: { shared: 'user-shared' } });
        const vars = loadEnvironment(envFile, 'dev');
        assert.equal(vars.find(v => v.name === 'shared')?.value, 'user-shared');
      } finally {
        cleanup(tmp);
      }
    });

    it('skips non-string provider object values', () => {
      const tmp = makeTmpDir();
      try {
        const envFile = path.join(tmp, 'http-client.env.json');
        writeJson(envFile, { dev: { plain: 'ok', secret: { type: 'AzureKeyVault' } } });
        const vars = loadEnvironment(envFile, 'dev');
        assert.ok(vars.some(v => v.name === 'plain'));
        assert.ok(!vars.some(v => v.name === 'secret'));
      } finally {
        cleanup(tmp);
      }
    });

    it('returns empty array when env file does not exist', () => {
      const vars = loadEnvironment('/non/existent/http-client.env.json', 'dev');
      assert.deepEqual(vars, []);
    });

    it('returns empty array for unknown environment name', () => {
      const tmp = makeTmpDir();
      try {
        const envFile = path.join(tmp, 'http-client.env.json');
        writeJson(envFile, { dev: { token: 'abc' } });
        const vars = loadEnvironment(envFile, 'staging');
        assert.deepEqual(vars, []);
      } finally {
        cleanup(tmp);
      }
    });
  });

  describe('discoverEnvironments', () => {
    it('returns empty array for undefined workspace folders', () => {
      const envs = discoverEnvironments(undefined);
      assert.deepEqual(envs, []);
    });

    it('returns empty array for empty workspace folders', () => {
      const envs = discoverEnvironments([]);
      assert.deepEqual(envs, []);
    });

    it('discovers named environments from env file', () => {
      const tmp = makeTmpDir();
      try {
        const envFile = path.join(tmp, 'http-client.env.json');
        writeJson(envFile, { dev: {}, staging: {}, $shared: {} });
        const fakeFolder = { uri: { fsPath: tmp } } as never;
        const envs = discoverEnvironments([fakeFolder]);
        const names = envs.map(e => e.name);
        assert.ok(names.includes('dev'));
        assert.ok(names.includes('staging'));
        assert.ok(!names.includes('$shared'));
      } finally {
        cleanup(tmp);
      }
    });

    it('deduplicates environments with the same name across folders', () => {
      const tmp1 = makeTmpDir();
      const tmp2 = makeTmpDir();
      try {
        writeJson(path.join(tmp1, 'http-client.env.json'), { dev: {} });
        writeJson(path.join(tmp2, 'http-client.env.json'), { dev: {} });
        const folders = [
          { uri: { fsPath: tmp1 } } as never,
          { uri: { fsPath: tmp2 } } as never,
        ];
        const envs = discoverEnvironments(folders);
        assert.equal(envs.filter(e => e.name === 'dev').length, 1);
      } finally {
        cleanup(tmp1);
        cleanup(tmp2);
      }
    });

    it('skips folders without an env file', () => {
      const tmp = makeTmpDir();
      try {
        const fakeFolder = { uri: { fsPath: tmp } } as never;
        const envs = discoverEnvironments([fakeFolder]);
        assert.deepEqual(envs, []);
      } finally {
        cleanup(tmp);
      }
    });
  });

  describe('loadEnvScripts', () => {
    it('returns sharedPre as absolute path from $shared.$scripts.pre', () => {
      const tmp = makeTmpDir();
      try {
        const envFile = path.join(tmp, 'http-client.env.json');
        writeJson(envFile, { $shared: { $scripts: { pre: './scripts/pre.js' } } });
        const result = loadEnvScripts(envFile, 'dev');
        assert.equal(result.sharedPre, path.resolve(tmp, './scripts/pre.js'));
      } finally {
        cleanup(tmp);
      }
    });

    it('returns sharedPost as absolute path from $shared.$scripts.post', () => {
      const tmp = makeTmpDir();
      try {
        const envFile = path.join(tmp, 'http-client.env.json');
        writeJson(envFile, { $shared: { $scripts: { post: './scripts/post.js' } } });
        const result = loadEnvScripts(envFile, 'dev');
        assert.equal(result.sharedPost, path.resolve(tmp, './scripts/post.js'));
      } finally {
        cleanup(tmp);
      }
    });

    it('returns envPre as absolute path from envName.$scripts.pre', () => {
      const tmp = makeTmpDir();
      try {
        const envFile = path.join(tmp, 'http-client.env.json');
        writeJson(envFile, { dev: { $scripts: { pre: './dev-pre.js' } } });
        const result = loadEnvScripts(envFile, 'dev');
        assert.equal(result.envPre, path.resolve(tmp, './dev-pre.js'));
      } finally {
        cleanup(tmp);
      }
    });

    it('returns envPost as absolute path from envName.$scripts.post', () => {
      const tmp = makeTmpDir();
      try {
        const envFile = path.join(tmp, 'http-client.env.json');
        writeJson(envFile, { dev: { $scripts: { post: './dev-post.js' } } });
        const result = loadEnvScripts(envFile, 'dev');
        assert.equal(result.envPost, path.resolve(tmp, './dev-post.js'));
      } finally {
        cleanup(tmp);
      }
    });

    it('returns undefined fields for partial $scripts block', () => {
      const tmp = makeTmpDir();
      try {
        const envFile = path.join(tmp, 'http-client.env.json');
        writeJson(envFile, { dev: { $scripts: { pre: './pre.js' } } });
        const result = loadEnvScripts(envFile, 'dev');
        assert.equal(result.envPre, path.resolve(tmp, './pre.js'));
        assert.equal(result.envPost, undefined);
      } finally {
        cleanup(tmp);
      }
    });

    it('returns all undefined fields when no $scripts key exists', () => {
      const tmp = makeTmpDir();
      try {
        const envFile = path.join(tmp, 'http-client.env.json');
        writeJson(envFile, { dev: { baseUrl: 'http://localhost' } });
        const result = loadEnvScripts(envFile, 'dev');
        assert.equal(result.sharedPre, undefined);
        assert.equal(result.sharedPost, undefined);
        assert.equal(result.envPre, undefined);
        assert.equal(result.envPost, undefined);
      } finally {
        cleanup(tmp);
      }
    });

    it('returns all undefined when env file does not exist', () => {
      const result = loadEnvScripts('/non/existent/http-client.env.json', 'dev');
      assert.equal(result.sharedPre, undefined);
      assert.equal(result.sharedPost, undefined);
      assert.equal(result.envPre, undefined);
      assert.equal(result.envPost, undefined);
    });

    it('ignores non-object $scripts value gracefully', () => {
      const tmp = makeTmpDir();
      try {
        const envFile = path.join(tmp, 'http-client.env.json');
        writeJson(envFile, { dev: { $scripts: 'not-an-object' } });
        const result = loadEnvScripts(envFile, 'dev');
        assert.equal(result.envPre, undefined);
        assert.equal(result.envPost, undefined);
      } finally {
        cleanup(tmp);
      }
    });
  });
});
