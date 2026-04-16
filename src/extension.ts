import * as vscode from 'vscode';
import { HttpFilesProvider, RequestItem } from './httpFilesProvider';

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
      // WebView panel lives in step 4 — placeholder for now
      vscode.window.showInformationMessage(`[Laika] Sending: ${item.label}`);
    }),
  );
}

export function deactivate() {}
