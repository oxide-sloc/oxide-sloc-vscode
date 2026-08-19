// Friendly analyze options: translate settings into CLI flags, and offer a
// guided QuickPick so users don't have to hand-write `analyzeFlags` arrays.

import * as vscode from 'vscode';

interface OptionDefs {
  perFile: boolean;
  failOnWarnings: boolean;
  activityWindow: number; // days; 0 = off
  failBelow: number; // code lines; 0 = off
  maxComplexity: number; // 0 = off
}

function read(): OptionDefs {
  const cfg = vscode.workspace.getConfiguration('oxideSloc');
  return {
    perFile: cfg.get<boolean>('options.perFile', false),
    failOnWarnings: cfg.get<boolean>('options.failOnWarnings', false),
    activityWindow: cfg.get<number>('options.activityWindow', 0),
    failBelow: cfg.get<number>('options.failBelow', 0),
    maxComplexity: cfg.get<number>('options.maxComplexity', 0),
  };
}

/** Translate the friendly `oxideSloc.options.*` settings into oxide-sloc flags. */
export function optionFlags(): string[] {
  const o = read();
  const args: string[] = [];
  if (o.perFile) {
    args.push('--per-file');
  }
  if (o.failOnWarnings) {
    args.push('--fail-on-warnings');
  }
  if (o.activityWindow > 0) {
    args.push('--activity-window', String(o.activityWindow));
  }
  if (o.failBelow > 0) {
    args.push('--fail-below', String(o.failBelow));
  }
  if (o.maxComplexity > 0) {
    args.push('--max-complexity', String(o.maxComplexity));
  }
  return args;
}

interface Toggle extends vscode.QuickPickItem {
  key: keyof OptionDefs;
  valueKind: 'bool' | 'number';
  unit?: string;
}

/**
 * Guided options editor: a multi-select for the on/off flags plus follow-up
 * prompts for the numeric thresholds. Writes to workspace settings.
 */
export async function configureOptions(): Promise<void> {
  const o = read();
  const cfg = vscode.workspace.getConfiguration('oxideSloc');

  const items: Toggle[] = [
    {
      key: 'perFile',
      valueKind: 'bool',
      label: 'Per-file breakdown',
      detail: 'Include a per-file table in the report (--per-file)',
      picked: o.perFile,
    },
    {
      key: 'failOnWarnings',
      valueKind: 'bool',
      label: 'Fail on warnings',
      detail: 'Exit non-zero if any warnings are emitted (--fail-on-warnings)',
      picked: o.failOnWarnings,
    },
    {
      key: 'activityWindow',
      valueKind: 'number',
      unit: 'days',
      label: 'Activity window',
      detail: o.activityWindow > 0 ? `Currently ${o.activityWindow} days` : 'Off — pick to set (--activity-window)',
      picked: o.activityWindow > 0,
    },
    {
      key: 'failBelow',
      valueKind: 'number',
      unit: 'code lines',
      label: 'Fail below threshold',
      detail: o.failBelow > 0 ? `Currently ${o.failBelow} lines` : 'Off — pick to set (--fail-below)',
      picked: o.failBelow > 0,
    },
    {
      key: 'maxComplexity',
      valueKind: 'number',
      unit: 'complexity',
      label: 'Max cyclomatic complexity',
      detail: o.maxComplexity > 0 ? `Currently ${o.maxComplexity}` : 'Off — pick to set (--max-complexity)',
      picked: o.maxComplexity > 0,
    },
  ];

  const chosen = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: 'Oxide SLOC — Analyze Options',
    placeHolder: 'Toggle options; numeric ones will prompt for a value',
  });
  if (!chosen) {
    return; // cancelled — leave settings untouched
  }

  const picked = new Set(chosen.map((c) => c.key));
  for (const item of items) {
    const on = picked.has(item.key);
    if (item.valueKind === 'bool') {
      await cfg.update(`options.${item.key}`, on, vscode.ConfigurationTarget.Workspace);
      continue;
    }
    // Numeric: prompt for a value when turned on, else clear to 0.
    if (!on) {
      await cfg.update(`options.${item.key}`, 0, vscode.ConfigurationTarget.Workspace);
      continue;
    }
    const current = o[item.key] as number;
    const entered = await vscode.window.showInputBox({
      title: item.label,
      prompt: `Enter a value in ${item.unit}`,
      value: current > 0 ? String(current) : '',
      validateInput: (v) => (/^\d+$/.test(v.trim()) && Number(v) > 0 ? undefined : 'Enter a positive whole number'),
    });
    if (entered !== undefined) {
      await cfg.update(`options.${item.key}`, Number(entered.trim()), vscode.ConfigurationTarget.Workspace);
    }
  }

  void vscode.window.showInformationMessage('Oxide SLOC: analyze options updated.');
}
