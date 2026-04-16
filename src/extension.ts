import * as fs from 'fs';
import * as vscode from 'vscode';
import { HttpFilesProvider, RequestItem } from './httpFilesProvider';
import { parseHttpFile } from './httpParser';
import { RequestPanel } from './requestPanel';

export function activate(context: vscode.ExtensionContext) {
  const provider = new HttpFilesProvider(context);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('laikaHttpFiles', provider),

    vscode.commands.registerCommand('laika.refreshFiles', () => {
      provider.refresh();
    }),

    vscode.commands.registerCommand('laika.sendRequest', (item?: RequestItem) => {
      if (!item) {
        vscode.window.showInformationMessage('Select a request from the Laika panel to send it.');
        return;
      }

      let fileVars: import('./httpParser').ParsedVariable[] = [];
      try {
        const text = fs.readFileSync(item.fileUri.fsPath, 'utf8');
        fileVars = parseHttpFile(text).variables;
      } catch {
        // proceed without file-level variables
      }

      RequestPanel.show(item.parsed, fileVars, item.fileUri.fsPath, context);
    }),
  );
}

export function deactivate() {}
