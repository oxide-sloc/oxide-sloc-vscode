// Status-bar item showing the workspace code-line count.
//
// It is a pure view of the shared ReportStore: it never runs the binary itself,
// it just re-renders whenever the store changes (analysis, binary status, busy).

import * as vscode from 'vscode';
import { ReportStore } from './store';
import { fmt } from './plain';

export class SlocStatusBar {
  private item: vscode.StatusBarItem;

  constructor(private readonly store: ReportStore) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'oxideSloc.analyzeWorkspace';
    this.item.name = 'Oxide SLOC';
    store.onDidChange(() => this.render());
  }

  dispose(): void {
    this.item.dispose();
  }

  /** Show/hide based on the `oxideSloc.statusBar.enabled` setting, then render. */
  applyVisibility(): void {
    const enabled = vscode.workspace
      .getConfiguration('oxideSloc')
      .get<boolean>('statusBar.enabled', true);
    if (enabled) {
      this.render();
    } else {
      this.item.hide();
    }
  }

  private enabled(): boolean {
    return vscode.workspace.getConfiguration('oxideSloc').get<boolean>('statusBar.enabled', true);
  }

  private render(): void {
    if (!this.enabled() || !vscode.workspace.workspaceFolders?.length) {
      this.item.hide();
      return;
    }

    if (this.store.analyzing) {
      this.item.text = '$(sync~spin) SLOC';
      this.item.tooltip = 'Oxide SLOC: analyzing…';
      this.item.show();
      return;
    }

    if (this.store.binary && !this.store.binary.ok) {
      this.item.text = '$(error) SLOC';
      this.item.tooltip = 'Oxide SLOC: binary not found. Click to set it up.';
      this.item.command = 'oxideSloc.locateBinary';
      this.item.show();
      return;
    }

    const r = this.store.report;
    this.item.command = 'oxideSloc.analyzeWorkspace';
    if (!r) {
      this.item.text = '$(code) SLOC';
      this.item.tooltip = 'Oxide SLOC: click to analyze the workspace.';
      this.item.show();
      return;
    }

    this.item.text = `$(code) ${fmt(r.codeLines)} SLOC`;
    const lines = [
      `Code lines: ${r.codeLines.toLocaleString('en-US')}`,
      `Files analyzed: ${r.filesAnalyzed.toLocaleString('en-US')}`,
      r.warnings.length > 0 ? `Warnings: ${r.warnings.length}` : undefined,
      'Click to re-analyze the workspace.',
    ].filter(Boolean) as string[];
    this.item.tooltip = lines.join('\n');
    this.item.show();
  }
}
