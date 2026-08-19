// oxide-sloc VS Code extension entry point.

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawnSloc, binaryStatus, autodetectCandidates } from './binary';
import { analyzeArgs, mapExit } from './runner';
import { readReport } from './metrics';
import { SlocStatusBar } from './statusBar';
import { SlocTreeProvider } from './tree';
import { ReportStore } from './store';
import { surfaceOutcome } from './diagnostics';
import { parsePlain } from './plain';
import { openReport } from './report';
import { startServe, stopServe } from './serve';
import { configureOptions } from './options';

let store: ReportStore;
let statusBar: SlocStatusBar;
let output: vscode.OutputChannel;
let reportDir: string;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('Oxide SLOC');
  store = new ReportStore(context.workspaceState);
  statusBar = new SlocStatusBar(store);

  const tree = new SlocTreeProvider(store);
  context.subscriptions.push(
    output,
    statusBar,
    store,
    vscode.window.registerTreeDataProvider('oxideSloc.panel', tree),
  );

  // Reports go to extension storage, never the workspace tree.
  reportDir = path.join(context.globalStorageUri.fsPath, 'reports');
  fs.mkdirSync(reportDir, { recursive: true });

  context.subscriptions.push(
    vscode.commands.registerCommand('oxideSloc.analyzeWorkspace', analyzeWorkspace),
    vscode.commands.registerCommand('oxideSloc.analyzeCurrent', analyzeCurrent),
    vscode.commands.registerCommand('oxideSloc.openReport', openLastReport),
    vscode.commands.registerCommand('oxideSloc.startServe', () => startServe(output)),
    vscode.commands.registerCommand('oxideSloc.stopServe', () => stopServe()),
    vscode.commands.registerCommand('oxideSloc.refreshStatus', () => refreshAnalysis({ silent: true })),
    vscode.commands.registerCommand('oxideSloc.locateBinary', locateBinary),
    vscode.commands.registerCommand('oxideSloc.configureOptions', configureOptions),
  );

  // Refresh on save when the user opted in.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      const auto = vscode.workspace
        .getConfiguration('oxideSloc')
        .get<boolean>('statusBar.autoRefresh', false);
      if (auto) {
        void refreshAnalysis({ silent: true });
      }
    }),
  );

  // React to relevant setting changes.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('oxideSloc.statusBar.enabled')) {
        statusBar.applyVisibility();
      }
      if (e.affectsConfiguration('oxideSloc.binaryPath')) {
        store.setBinary(binaryStatus());
      }
    }),
  );

  // Seed binary status and, if it's runnable, do an initial silent scan.
  store.setBinary(binaryStatus());
  statusBar.applyVisibility();
  if (store.binary?.ok) {
    void refreshAnalysis({ silent: true });
  }
}

export function deactivate(): void {
  stopServe();
}

/** Timestamped report path pair under the extension storage dir. */
function reportPaths(label: string): { json: string; html: string } {
  const safe = label.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60) || 'report';
  const stamp = Date.now();
  return {
    json: path.join(reportDir, `${safe}-${stamp}.json`),
    html: path.join(reportDir, `${safe}-${stamp}.html`),
  };
}

interface RunOpts {
  /** Suppress the outcome toast (used for background/status-bar refreshes). */
  silent?: boolean;
}

/**
 * Run analyze over the given paths, store the parsed JSON report, and (unless
 * silent) surface the outcome. Central path used by commands, the status bar,
 * and save-triggered refreshes.
 */
async function runAnalyze(paths: string[], label: string, opts: RunOpts = {}): Promise<void> {
  if (paths.length === 0) {
    if (!opts.silent) {
      void vscode.window.showWarningMessage('Oxide SLOC: nothing to analyze.');
    }
    return;
  }
  const { json, html } = reportPaths(label);

  store.setAnalyzing(true);
  try {
    const result = await spawnSloc(analyzeArgs(paths, { jsonOut: json, htmlOut: html }), paths[0]);

    output.appendLine(`\n$ oxide-sloc analyze ${paths.join(' ')}`);
    if (result.stdout) {
      output.append(result.stdout);
    }

    if (result.spawnError) {
      output.appendLine(`[error] ${result.spawnError.message}`);
      store.setBinary(binaryStatus());
      if (!opts.silent) {
        void vscode.window.showErrorMessage(
          `Oxide SLOC: could not run the binary (${result.spawnError.message}). ` +
            'Set it up from the Oxide SLOC panel or via "Oxide SLOC: Locate / Auto-detect Binary".',
          'Set Up Binary',
        ).then((c) => c === 'Set Up Binary' && vscode.commands.executeCommand('oxideSloc.locateBinary'));
      }
      return;
    }
    if (result.stderr) {
      output.appendLine(result.stderr.trimEnd());
    }

    const htmlPath = fs.existsSync(html) ? html : undefined;
    const report = readReport(json, Date.now(), htmlPath);
    if (report) {
      store.setReport(report);
    }

    if (!opts.silent) {
      const metrics = parsePlain(result.stdout);
      await surfaceOutcome(mapExit(result.code), metrics, htmlPath, output);
    }
  } finally {
    store.setAnalyzing(false);
  }
}

/** Analyze all workspace folders. `silent` skips the outcome toast. */
async function refreshAnalysis(opts: RunOpts = {}): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    if (!opts.silent) {
      void vscode.window.showWarningMessage('Oxide SLOC: no workspace folder is open.');
    }
    return;
  }
  await runAnalyze(folders.map((f) => f.uri.fsPath), 'workspace', opts);
}

async function analyzeWorkspace(): Promise<void> {
  await refreshAnalysis();
}

async function analyzeCurrent(target?: vscode.Uri): Promise<void> {
  const uri = target ?? vscode.window.activeTextEditor?.document.uri;
  if (!uri) {
    void vscode.window.showWarningMessage('Oxide SLOC: no file or folder selected.');
    return;
  }
  await runAnalyze([uri.fsPath], path.basename(uri.fsPath));
}

async function openLastReport(): Promise<void> {
  const htmlPath = store.report?.htmlPath;
  if (!htmlPath || !fs.existsSync(htmlPath)) {
    void vscode.window.showInformationMessage(
      'Oxide SLOC: no report yet. Run "Oxide SLOC: Analyze Workspace" first.',
    );
    return;
  }
  await openReport(htmlPath);
}

/**
 * Guided binary setup: offer any auto-detected local builds, plus a file
 * picker, and persist the choice to `oxideSloc.binaryPath`.
 */
async function locateBinary(): Promise<void> {
  const detected = autodetectCandidates();

  interface Pick extends vscode.QuickPickItem {
    action: 'use' | 'browse';
    value?: string;
  }
  const items: Pick[] = detected.map((p) => ({
    label: `$(check) ${p}`,
    description: 'detected build',
    action: 'use',
    value: p,
  }));
  items.push({ label: '$(folder-opened) Browse…', description: 'pick the oxide-sloc executable', action: 'browse' });

  const choice = await vscode.window.showQuickPick(items, {
    title: 'Oxide SLOC — Locate Binary',
    placeHolder: detected.length ? 'Select a detected build or browse' : 'No local build found — browse to the executable',
  });
  if (!choice) {
    return;
  }

  let picked = choice.value;
  if (choice.action === 'browse') {
    const uris = await vscode.window.showOpenDialog({
      title: 'Select the oxide-sloc executable',
      canSelectMany: false,
      openLabel: 'Use this binary',
    });
    picked = uris?.[0]?.fsPath;
  }
  if (!picked) {
    return;
  }

  await vscode.workspace
    .getConfiguration('oxideSloc')
    .update('binaryPath', picked, vscode.ConfigurationTarget.Workspace);
  const status = binaryStatus();
  store.setBinary(status);
  if (status.ok) {
    void vscode.window.showInformationMessage(`Oxide SLOC: using ${status.command} (v${status.version}).`);
    void refreshAnalysis({ silent: true });
  } else {
    void vscode.window.showWarningMessage(`Oxide SLOC: "${picked}" did not run. Check the path.`);
  }
}
