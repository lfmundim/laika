import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HistoryStore, HistoryEntry } from '../historyStore';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'laika-history-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// HistoryStore only uses vscode.Uri's fsPath property, so a plain object suffices.
function makeStore(dir: string): HistoryStore {
  return new HistoryStore({ fsPath: dir } as never);
}

function makeEntry(): Omit<HistoryEntry, 'id' | 'timestamp'> {
  return {
    request: { method: 'GET', url: 'https://example.com', headers: {} },
    response: { status: 200, statusText: 'OK', headers: {}, body: '{}', duration: 42 },
  };
}

describe('HistoryStore', () => {
  describe('add', () => {
    it('returns the full entry with id and timestamp', () => {
      const tmp = makeTmpDir();
      try {
        const store = makeStore(tmp);
        const entry = store.add(makeEntry());
        assert.ok(entry.id);
        assert.ok(entry.timestamp > 0);
        assert.equal(entry.request.method, 'GET');
      } finally {
        cleanup(tmp);
      }
    });

    it('prepends entries so newest is first', () => {
      const tmp = makeTmpDir();
      try {
        const store = makeStore(tmp);
        const a = store.add({ request: { method: 'GET', url: 'https://a.com', headers: {} } });
        const b = store.add({ request: { method: 'POST', url: 'https://b.com', headers: {} } });
        const all = store.getAll();
        assert.equal(all[0].id, b.id);
        assert.equal(all[1].id, a.id);
      } finally {
        cleanup(tmp);
      }
    });

    it('caps entries at 100', () => {
      const tmp = makeTmpDir();
      try {
        const store = makeStore(tmp);
        for (let i = 0; i < 105; i++) {
          store.add({ request: { method: 'GET', url: `https://example.com/${i}`, headers: {} } });
        }
        assert.equal(store.getAll().length, 100);
      } finally {
        cleanup(tmp);
      }
    });
  });

  describe('getAll', () => {
    it('returns empty array on fresh store', () => {
      const tmp = makeTmpDir();
      try {
        const store = makeStore(tmp);
        assert.deepEqual(store.getAll(), []);
      } finally {
        cleanup(tmp);
      }
    });

    it('returns all added entries', () => {
      const tmp = makeTmpDir();
      try {
        const store = makeStore(tmp);
        store.add(makeEntry());
        store.add(makeEntry());
        assert.equal(store.getAll().length, 2);
      } finally {
        cleanup(tmp);
      }
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      const tmp = makeTmpDir();
      try {
        const store = makeStore(tmp);
        store.add(makeEntry());
        store.add(makeEntry());
        store.clear();
        assert.deepEqual(store.getAll(), []);
      } finally {
        cleanup(tmp);
      }
    });
  });

  describe('persistence', () => {
    it('persists entries to disk and reloads them', () => {
      const tmp = makeTmpDir();
      try {
        const store1 = makeStore(tmp);
        store1.add(makeEntry());

        const store2 = makeStore(tmp);
        assert.equal(store2.getAll().length, 1);
        assert.equal(store2.getAll()[0].request.url, 'https://example.com');
      } finally {
        cleanup(tmp);
      }
    });

    it('persists clear to disk', () => {
      const tmp = makeTmpDir();
      try {
        const store1 = makeStore(tmp);
        store1.add(makeEntry());
        store1.clear();

        const store2 = makeStore(tmp);
        assert.deepEqual(store2.getAll(), []);
      } finally {
        cleanup(tmp);
      }
    });

    it('starts empty when history file is corrupt', () => {
      const tmp = makeTmpDir();
      try {
        fs.mkdirSync(tmp, { recursive: true });
        fs.writeFileSync(path.join(tmp, 'history.json'), 'not valid json');
        const store = makeStore(tmp);
        assert.deepEqual(store.getAll(), []);
      } finally {
        cleanup(tmp);
      }
    });
  });
});
