// Code coverage excluded: this file uses vscode.workspace.createFileSystemWatcher,
// vscode.workspace.findFiles, and vscode.TreeDataProvider, all of which require the
// VS Code extension host. Unit testing requires @vscode/test-electron, deferred.
import * as vscode from 'vscode';
import * as path from 'path';
import { parseHttpFile, ParsedRequest } from './httpParser';

// ---------------------------------------------------------------------------
// Tree item types
// ---------------------------------------------------------------------------

export class HttpFileItem extends vscode.TreeItem {
  readonly resourceUri: vscode.Uri;

  constructor(uri: vscode.Uri) {
    super(path.basename(uri.fsPath), vscode.TreeItemCollapsibleState.Collapsed);
    this.resourceUri = uri;
    this.contextValue = 'httpFile';
    this.iconPath = new vscode.ThemeIcon('file-code');
    this.tooltip = uri.fsPath;
  }
}

export class RequestItem extends vscode.TreeItem {
  constructor(
    public readonly fileUri: vscode.Uri,
    public readonly parsed: ParsedRequest,
  ) {
    super(parsed.name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'request';
    this.description = parsed.method;
    this.iconPath = new vscode.ThemeIcon('arrow-right');
    this.tooltip = parsed.raw.slice(0, 300);
    this.command = {
      command: 'laika.sendRequest',
      title: 'Send Request',
      arguments: [this],
    };
  }
}

export type HttpTreeItem = HttpFileItem | RequestItem;

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class HttpFilesProvider implements vscode.TreeDataProvider<HttpTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<HttpTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.http');
    watcher.onDidCreate(() => this.refresh());
    watcher.onDidDelete(() => this.refresh());
    watcher.onDidChange(() => this.refresh());
    context.subscriptions.push(watcher);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: HttpTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: HttpTreeItem): Promise<HttpTreeItem[]> {
    if (!element) {
      return this.getHttpFiles();
    }
    if (element instanceof HttpFileItem) {
      return this.getRequests(element.resourceUri);
    }
    return [];
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async getHttpFiles(): Promise<HttpFileItem[]> {
    const uris = await vscode.workspace.findFiles('**/*.http', '**/node_modules/**');
    uris.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
    return uris.map(uri => new HttpFileItem(uri));
  }

  private async getRequests(fileUri: vscode.Uri): Promise<RequestItem[]> {
    let text: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      text = Buffer.from(bytes).toString('utf8');
    } catch {
      return [];
    }

    const { requests } = parseHttpFile(text);
    return requests.map(r => new RequestItem(fileUri, r));
  }
}
