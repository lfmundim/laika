import * as vscode from 'vscode';
import { HttpFilesProvider, RequestItem } from './httpFilesProvider';
import { extractReferencedVarNames } from './httpParser';
import { RequestPanel } from './requestPanel';
import { discoverEnvironments, findEnvFileForHttp, loadEnvironment } from './envLoader';
import { HistoryStore } from './historyStore';
import { HistoryProvider } from './historyProvider';
import { HistoryPanel } from './historyPanel';

const ACTIVE_ENV_KEY = 'laika.activeEnvironment';
/** Sentinel value meaning "no environment — use only in-file variables". */
const NONE_ENV = '<none>';

/** Returns true when the given env name represents the explicit no-env state. */
function isNoneEnv(name: string): boolean {
  return !name || name === NONE_ENV;
}

export function activate(context: vscode.ExtensionContext) {
  const debugEnabled = vscode.workspace.getConfiguration('laika').get<boolean>('enableDebugLog', false);
  const log = debugEnabled ? vscode.window.createOutputChannel('Laika Debug') : undefined;
  if (log) { context.subscriptions.push(log); }

  const provider = new HttpFilesProvider(
    context,
    () => context.workspaceState.get(ACTIVE_ENV_KEY, NONE_ENV) as string,
    log,
  );
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

      const activeEnvName: string = context.workspaceState.get(ACTIVE_ENV_KEY, NONE_ENV);
      const items = [
        { label: NONE_ENV, description: 'Use only in-file variables (default)', picked: isNoneEnv(activeEnvName) },
        ...environments.map(e => ({ label: e.name, description: e.envFilePath, picked: e.name === activeEnvName })),
      ];

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select an environment',
      });

      if (!picked) { return; }

      const selectedName = picked.label === NONE_ENV ? NONE_ENV : picked.label;
      await context.workspaceState.update(ACTIVE_ENV_KEY, selectedName);

      // Refresh the open panel — resolve its env file from its .http file path
      const panelFilePath = RequestPanel.currentFilePath;
      if (panelFilePath && !isNoneEnv(selectedName)) {
        const envFilePath = findEnvFileForHttp(panelFilePath);
        const envVars = envFilePath ? loadEnvironment(envFilePath, selectedName) : [];
        RequestPanel.refresh(envVars, selectedName);
      } else {
        RequestPanel.refresh([], selectedName);
      }

      // Refresh the tree so the EnvItem reflects the new selection.
      provider.refresh();

      if (!isNoneEnv(selectedName)) {
        vscode.window.showInformationMessage(`Laika: environment set to "${selectedName}".`);
      } else {
        vscode.window.showInformationMessage('Laika: environment set to <none> (in-file variables only).');
      }
    }),

    vscode.commands.registerCommand('laika.sendRequest', (item?: RequestItem) => {
      if (!item) {
        vscode.window.showInformationMessage('Select a request from the Laika panel to send it.');
        return;
      }

      // File vars are cached on the RequestItem when the tree is built, so no
      // second file-read is needed here. Spread to get a mutable working copy.
      const fileVars: import('./httpParser').ParsedVariable[] = [...(item.fileVars ?? [])];

      log?.appendLine(`[sendRequest] request="${item.parsed?.name}" fileVars=${fileVars.length} uri="${item.fileUri?.fsPath}"`);

      const activeEnvName: string = context.workspaceState.get(ACTIVE_ENV_KEY, NONE_ENV);
      let envVars: import('./envLoader').EnvVariable[] = [];
      if (!isNoneEnv(activeEnvName)) {
        const envFilePath = findEnvFileForHttp(item.fileUri.fsPath);
        if (envFilePath) {
          envVars = loadEnvironment(envFilePath, activeEnvName);
        }
      }

      // Add editable placeholders for any {{varName}} tokens not backed by a
      // file-level @var declaration so they're always visible and resolvable
      // even without an environment file. line:-1 marks them as synthetic.
      const fileVarNames = new Set(fileVars.map(v => v.name));
      for (const name of extractReferencedVarNames(item.parsed)) {
        if (!fileVarNames.has(name)) {
          fileVars.push({ name, value: envVars.find(v => v.name === name)?.value ?? '', line: -1 });
        }
      }

      RequestPanel.show(
        item.parsed, fileVars, item.fileUri.fsPath, context, envVars, activeEnvName,
        historyStore, () => historyProvider.refresh(),
      );
    }),

    vscode.commands.registerCommand('laika.openFile', (item: import('./httpFilesProvider').HttpFileItem) => {
      vscode.window.showTextDocument(item.resourceUri);
    }),
  );

  // Watch for changes to http-client.env.json and its .user override so the
  // open request panel always reflects the latest values without a manual refresh.
  const reloadEnvIntoPanel = () => {
    const activeEnvName: string = context.workspaceState.get(ACTIVE_ENV_KEY, NONE_ENV);
    if (isNoneEnv(activeEnvName)) { return; }
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
