// Activity Bar tree: a persistent home for setup status and the last analysis.
//
// Three sections render from the shared ReportStore:
//   Setup     - binary status + version, or a call-to-action to fix it
//   Metrics   - summary totals from the last run
//   Languages - per-language code-line breakdown
// Everything re-renders on the store's change event.

import * as vscode from 'vscode';
import { ReportStore } from './store';
import { fmt } from './plain';

/** A single row. Leaf rows may carry an inline value shown as the description. */
class Node extends vscode.TreeItem {
  constructor(
    label: string,
    collapsible: vscode.TreeItemCollapsibleState,
    opts: {
      value?: string;
      icon?: string;
      tooltip?: string;
      command?: vscode.Command;
      contextValue?: string;
      children?: Node[];
    } = {},
  ) {
    super(label, collapsible);
    if (opts.value !== undefined) {
      this.description = opts.value;
    }
    if (opts.icon) {
      this.iconPath = new vscode.ThemeIcon(opts.icon);
    }
    this.tooltip = opts.tooltip;
    this.command = opts.command;
    this.contextValue = opts.contextValue;
    this.children = opts.children;
  }
  children?: Node[];
}

export class SlocTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly store: ReportStore) {
    store.onDidChange(() => this.emitter.fire());
  }

  getTreeItem(node: Node): vscode.TreeItem {
    return node;
  }

  getChildren(node?: Node): Node[] {
    if (node) {
      return node.children ?? [];
    }
    return [
      this.setupSection(),
      this.metricsSection(),
      this.estimatesSection(),
      this.languagesSection(),
      this.filesSection(),
    ];
  }

  // --- Setup --------------------------------------------------------------

  private setupSection(): Node {
    const bin = this.store.binary;
    let child: Node;
    if (bin?.ok) {
      child = new Node(`oxide-sloc ${bin.version ?? ''}`.trim(), vscode.TreeItemCollapsibleState.None, {
        icon: 'check',
        value: bin.source === 'setting' ? 'from setting' : bin.source === 'environment' ? 'from env' : 'on PATH',
        tooltip: bin.command,
        command: {
          command: 'oxideSloc.locateBinary',
          title: 'Change binary',
        },
      });
    } else {
      child = new Node('Binary not found — click to fix', vscode.TreeItemCollapsibleState.None, {
        icon: 'warning',
        tooltip: 'oxide-sloc could not be located. Auto-detect a build or pick the executable.',
        command: { command: 'oxideSloc.locateBinary', title: 'Locate binary' },
      });
    }
    return new Node('Setup', vscode.TreeItemCollapsibleState.Expanded, {
      contextValue: 'oxideSloc.setup',
      children: [child],
    });
  }

  // --- Metrics ------------------------------------------------------------

  private metricsSection(): Node {
    const r = this.store.report;
    if (this.store.analyzing) {
      return new Node('Metrics', vscode.TreeItemCollapsibleState.Expanded, {
        children: [new Node('Analyzing…', vscode.TreeItemCollapsibleState.None, { icon: 'sync~spin' })],
      });
    }
    if (!r) {
      return new Node('Metrics', vscode.TreeItemCollapsibleState.Expanded, {
        children: [
          new Node('No analysis yet — click to run', vscode.TreeItemCollapsibleState.None, {
            icon: 'play',
            command: { command: 'oxideSloc.analyzeWorkspace', title: 'Analyze' },
          }),
        ],
      });
    }

    const rows: Node[] = [
      metric('Code lines', r.codeLines, 'code'),
      metric('Comment lines', r.commentLines, 'comment'),
      metric('Blank lines', r.blankLines, 'whitespace'),
      metric('Physical lines', r.physicalLines, 'list-flat'),
      metric('Files analyzed', r.filesAnalyzed, 'files'),
    ];
    if (r.filesSkipped > 0) {
      rows.push(metric('Files skipped', r.filesSkipped, 'circle-slash'));
    }
    if (r.complexity !== undefined) {
      rows.push(metric('Complexity', r.complexity, 'graph'));
    }
    if (r.functions !== undefined) {
      rows.push(metric('Functions', r.functions, 'symbol-method'));
    }
    if (r.unitTests !== undefined) {
      rows.push(metric('Unit tests', r.unitTests, 'beaker'));
    }
    if (r.uloc !== undefined) {
      rows.push(metric('Unique lines (ULOC)', r.uloc, 'symbol-key'));
    }
    if (r.drynessPct !== undefined) {
      rows.push(
        new Node('DRYness', vscode.TreeItemCollapsibleState.None, {
          icon: 'droplet',
          value: `${r.drynessPct.toFixed(1)}%`,
          tooltip: 'Share of logical lines that are unique (higher = less duplication).',
        }),
      );
    }
    if (r.warnings.length > 0) {
      rows.push(
        new Node('Warnings', vscode.TreeItemCollapsibleState.None, {
          value: String(r.warnings.length),
          icon: 'warning',
          tooltip: r.warnings.join('\n'),
        }),
      );
    }

    const title = `Metrics (${relativeTime(r.generatedAt)})`;
    return new Node(title, vscode.TreeItemCollapsibleState.Expanded, {
      tooltip: r.version ? `oxide-sloc ${r.version}` : undefined,
      children: rows,
    });
  }

  // --- Estimates (COCOMO) -------------------------------------------------

  private estimatesSection(): Node {
    const c = this.store.report?.cocomo;
    if (!c) {
      return new Node('Estimates', vscode.TreeItemCollapsibleState.Collapsed, {
        children: [new Node('—', vscode.TreeItemCollapsibleState.None)],
      });
    }
    const children = [
      new Node('Effort', vscode.TreeItemCollapsibleState.None, {
        icon: 'person',
        value: `${c.effortPersonMonths.toFixed(2)} person-months`,
      }),
      new Node('Duration', vscode.TreeItemCollapsibleState.None, {
        icon: 'watch',
        value: `${c.durationMonths.toFixed(2)} months`,
      }),
      new Node('Avg staff', vscode.TreeItemCollapsibleState.None, {
        icon: 'organization',
        value: c.avgStaff.toFixed(2),
      }),
    ];
    return new Node('Estimates (COCOMO)', vscode.TreeItemCollapsibleState.Collapsed, {
      tooltip: c.mode ? `COCOMO mode: ${c.mode}` : undefined,
      value: c.mode || undefined,
      children,
    });
  }

  // --- Languages ----------------------------------------------------------

  private languagesSection(): Node {
    const r = this.store.report;
    const langs = r?.languages ?? [];
    if (langs.length === 0) {
      return new Node('Languages', vscode.TreeItemCollapsibleState.Collapsed, {
        children: [new Node('—', vscode.TreeItemCollapsibleState.None)],
      });
    }
    const children = langs.map(
      (l) =>
        new Node(l.language, vscode.TreeItemCollapsibleState.None, {
          icon: 'file-code',
          value: `${fmt(l.codeLines)} · ${l.files} file${l.files === 1 ? '' : 's'}`,
          tooltip: `${l.codeLines.toLocaleString('en-US')} code, ${l.commentLines.toLocaleString(
            'en-US',
          )} comment, ${l.blankLines.toLocaleString('en-US')} blank`,
        }),
    );
    return new Node('Languages', vscode.TreeItemCollapsibleState.Expanded, { children });
  }

  // --- Files (per-file drill-down) ----------------------------------------

  private filesSection(): Node {
    const r = this.store.report;
    const files = r?.files ?? [];
    if (files.length === 0) {
      return new Node('Files', vscode.TreeItemCollapsibleState.Collapsed, {
        children: [new Node('—', vscode.TreeItemCollapsibleState.None)],
      });
    }
    const root = this.workspaceRoot();
    const children = files.map((f) => {
      const cx = f.complexity !== undefined ? ` · cx ${f.complexity}` : '';
      return new Node(f.path, vscode.TreeItemCollapsibleState.None, {
        icon: 'file',
        value: `${fmt(f.codeLines)}${cx}`,
        tooltip: `${f.language} — ${f.codeLines.toLocaleString('en-US')} code, ${f.commentLines.toLocaleString(
          'en-US',
        )} comment, ${f.blankLines.toLocaleString('en-US')} blank`,
        command: root
          ? {
              command: 'vscode.open',
              title: 'Open file',
              arguments: [vscode.Uri.joinPath(root, ...f.path.split(/[\\/]/))],
            }
          : undefined,
      });
    });
    if (r?.filesTruncated) {
      children.push(
        new Node(`…and more (showing top ${files.length} by code lines)`, vscode.TreeItemCollapsibleState.None, {
          icon: 'ellipsis',
        }),
      );
    }
    const title = r?.filesTruncated ? `Files (top ${files.length})` : `Files (${files.length})`;
    return new Node(title, vscode.TreeItemCollapsibleState.Collapsed, { children });
  }

  /** First workspace folder, used to resolve per-file relative paths for opening. */
  private workspaceRoot(): vscode.Uri | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
  }
}

function metric(label: string, value: number, icon: string): Node {
  return new Node(label, vscode.TreeItemCollapsibleState.None, {
    icon,
    value: value.toLocaleString('en-US'),
  });
}

/** Small, dependency-free "x minutes ago" string. */
function relativeTime(ms: number): string {
  const secs = Math.max(0, Math.round((nowMs() - ms) / 1000));
  if (secs < 45) {
    return 'just now';
  }
  const mins = Math.round(secs / 60);
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hrs = Math.round(mins / 60);
  if (hrs < 24) {
    return `${hrs}h ago`;
  }
  return `${Math.round(hrs / 24)}d ago`;
}

// Isolated so the rest of the module stays pure/testable.
function nowMs(): number {
  return Date.now();
}
