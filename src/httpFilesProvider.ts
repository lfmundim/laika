import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

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
    public readonly label: string,
    public readonly fileUri: vscode.Uri,
    public readonly requestIndex: number,
    public readonly rawBlock: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'request';
    this.iconPath = new vscode.ThemeIcon('arrow-right');
    this.tooltip = rawBlock.slice(0, 200);
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

  private fileWatcher: vscode.FileSystemWatcher | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.http');
    this.fileWatcher.onDidCreate(() => this.refresh());
    this.fileWatcher.onDidDelete(() => this.refresh());
    this.fileWatcher.onDidChange(() => this.refresh());
    context.subscriptions.push(this.fileWatcher);
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

  private getRequests(fileUri: vscode.Uri): RequestItem[] {
    let text: string;
    try {
      text = fs.readFileSync(fileUri.fsPath, 'utf8');
    } catch {
      return [];
    }

    const blocks = splitIntoBlocks(text);
    return blocks
      .map((block, index) => {
        const label = extractRequestLabel(block, index);
        return new RequestItem(label, fileUri, index, block);
      })
      .filter(item => item.label.length > 0);
  }
}

// ---------------------------------------------------------------------------
// .http parsing helpers (minimal — enough for the tree)
// ---------------------------------------------------------------------------

/**
 * Split file content into request blocks separated by `###` dividers.
 * Strips leading/trailing whitespace from each block.
 */
function splitIntoBlocks(text: string): string[] {
  return text
    .split(/^###[^\n]*$/m)
    .map(b => b.trim())
    .filter(b => b.length > 0);
}

/**
 * Derive a display label for a request block.
 * Priority:
 *   1. `# @name <label>` annotation
 *   2. First non-comment, non-variable line that looks like `METHOD URL`
 *   3. Fallback to `Request N`
 */
function extractRequestLabel(block: string, index: number): string {
  const lines = block.split('\n');

  // 1. Named annotation: # @name MyRequest  or  // @name MyRequest
  for (const line of lines) {
    const nameMatch = line.match(/^(?:#|\/\/)\s*@name\s+(.+)/);
    if (nameMatch) {
      return nameMatch[1].trim();
    }
  }

  // 2. First HTTP method line
  const HTTP_METHODS = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|CONNECT|TRACE)\s+\S+/i;
  for (const line of lines) {
    const trimmed = line.trim();
    if (HTTP_METHODS.test(trimmed)) {
      // Truncate if long
      return trimmed.length > 60 ? trimmed.slice(0, 57) + '…' : trimmed;
    }
  }

  // 3. Fallback
  return `Request ${index + 1}`;
}
