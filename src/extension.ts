import * as fs from 'fs';
import * as vscode from 'vscode';
import { HttpFilesProvider, RequestItem } from './httpFilesProvider';
import { parseHttpFile } from './httpParser';
import { RequestPanel } from './requestPanel';
import { discoverEnvironments, findEnvFileForHttp, loadEnvironment } from './envLoader';
import { HistoryStore } from './historyStore';
import { HistoryProvider } from './historyProvider';
import { HistoryPanel } from './historyPanel';

const ACTIVE_ENV_KEY = 'laika.activeEnvironment';

export function activate(context: vscode.ExtensionContext) {
  const provider = new HttpFilesProvider(context);
  const historyStore = new HistoryStore(context.globalStorageUri);
  const historyProvider = new HistoryProvider(historyStore);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('laikaHttpFiles', provider),
    vscode.window.createTreeView('laikaHistory', { treeDataProvider: historyProvider }),

    vscode.commands.registerCommand('laika.refreshFiles', () => {
      provider.refresh();
    }),

    vscode.commands.registerCommand('laika.clearHistory', () => {
      historyStore.clear();
      historyProvider.refresh();
    }),

    vscode.commands.registerCommand('laika.showHistoryEntry', (item: import('./historyProvider').HistoryEntryItem) => {
      HistoryPanel.show(item.entry, context);
    }),

    vscode.commands.registerCommand('laika.selectEnvironment', async () => {
      const environments = discoverEnvironments(vscode.workspace.workspaceFolders);

      if (environments.length === 0) {
        vscode.window.showInformationMessage(
          'No http-client.env.json found in workspace roots.',
        );
        return;
      }

      const items = [
        { label: 'None', description: 'Clear active environment' },
        ...environments.map(e => ({ label: e.name, description: e.envFilePath })),
      ];

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select an environment',
      });

      if (!picked) { return; }

      const selectedName = picked.label === 'None' ? '' : picked.label;
      await context.workspaceState.update(ACTIVE_ENV_KEY, selectedName);

      // Refresh the open panel — resolve its env file from its .http file path
      const panelFilePath = RequestPanel.currentFilePath;
      if (panelFilePath && selectedName) {
        const envFilePath = findEnvFileForHttp(panelFilePath);
        const envVars = envFilePath ? loadEnvironment(envFilePath, selectedName) : [];
        RequestPanel.refresh(envVars, selectedName);
      } else {
        RequestPanel.refresh([], selectedName);
      }

      if (selectedName) {
        vscode.window.showInformationMessage(`Laika: environment set to "${selectedName}".`);
      } else {
        vscode.window.showInformationMessage('Laika: environment cleared.');
      }
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

      const activeEnvName: string = context.workspaceState.get(ACTIVE_ENV_KEY, '');
      let envVars: import('./envLoader').EnvVariable[] = [];
      if (activeEnvName) {
        const envFilePath = findEnvFileForHttp(item.fileUri.fsPath);
        if (envFilePath) {
          envVars = loadEnvironment(envFilePath, activeEnvName);
        }
      }

      RequestPanel.show(
        item.parsed, fileVars, item.fileUri.fsPath, context, envVars, activeEnvName,
        historyStore, () => historyProvider.refresh(),
      );
    }),
  );

  // Watch for changes to http-client.env.json and its .user override so the
  // open request panel always reflects the latest values without a manual refresh.
  const reloadEnvIntoPanel = () => {
    const activeEnvName: string = context.workspaceState.get(ACTIVE_ENV_KEY, '');
    if (!activeEnvName) { return; }
    const panelFilePath = RequestPanel.currentFilePath;
    if (!panelFilePath) { return; }
    const envFilePath = findEnvFileForHttp(panelFilePath);
    if (!envFilePath) { return; }
    RequestPanel.refresh(loadEnvironment(envFilePath, activeEnvName), activeEnvName);
  };

  const watcher = vscode.workspace.createFileSystemWatcher('**/http-client.env.json{,.user}');
  watcher.onDidChange(reloadEnvIntoPanel, null, context.subscriptions);
  watcher.onDidCreate(reloadEnvIntoPanel, null, context.subscriptions);
  watcher.onDidDelete(reloadEnvIntoPanel, null, context.subscriptions);
  context.subscriptions.push(watcher);
}

export function deactivate() {}
