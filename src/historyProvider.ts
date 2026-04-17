import * as vscode from 'vscode';
import { HistoryEntry, HistoryStore } from './historyStore';

export class HistoryEntryItem extends vscode.TreeItem {
  constructor(public readonly entry: HistoryEntry) {
    const label = entry.requestName ?? `${entry.request.method} ${entry.request.url}`;
    super(label, vscode.TreeItemCollapsibleState.None);

    this.description = `${entry.response?.status ?? 'ERR'} · ${new Date(entry.timestamp).toLocaleTimeString()}`;
    this.iconPath = new vscode.ThemeIcon(
      entry.error
        ? 'error'
        : entry.response && entry.response.status >= 400
          ? 'warning'
          : 'check',
    );
    this.tooltip = `${entry.request.method} ${entry.request.url}\n${new Date(entry.timestamp).toLocaleString()}`;
    this.command = {
      command: 'laika.showHistoryEntry',
      title: 'Show',
      arguments: [this],
    };
  }
}

export class HistoryProvider implements vscode.TreeDataProvider<HistoryEntryItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData: vscode.Event<void> = this._onDidChangeTreeData.event;

  constructor(private readonly store: HistoryStore) {}

  getTreeItem(element: HistoryEntryItem): vscode.TreeItem {
    return element;
  }

  getChildren(): HistoryEntryItem[] {
    return this.store.getAll().map(entry => new HistoryEntryItem(entry));
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
}
