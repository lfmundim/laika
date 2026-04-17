import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface HistoryEntry {
  id: string;
  timestamp: number;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
  };
  response?: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    duration: number;
  };
  error?: string;
  sourceFile?: string;
  requestName?: string;
}

export class HistoryStore {
  private entries: HistoryEntry[] = [];
  private readonly maxEntries = 100;
  private readonly storePath: string;

  constructor(globalStorageUri: vscode.Uri) {
    const dir = globalStorageUri.fsPath;
    fs.mkdirSync(dir, { recursive: true });
    this.storePath = path.join(dir, 'history.json');
    this.load();
  }

  add(entry: Omit<HistoryEntry, 'id' | 'timestamp'>): HistoryEntry {
    const full: HistoryEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      timestamp: Date.now(),
    };
    this.entries.unshift(full);
    if (this.entries.length > this.maxEntries) {
      this.entries.length = this.maxEntries;
    }
    this.persist();
    return full;
  }

  getAll(): HistoryEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
    this.persist();
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.storePath, 'utf8');
      this.entries = JSON.parse(raw) as HistoryEntry[];
    } catch {
      this.entries = [];
    }
  }

  private persist(): void {
    const tmp = this.storePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.entries), 'utf8');
    fs.renameSync(tmp, this.storePath);
  }
}
