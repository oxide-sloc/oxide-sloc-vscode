import * as assert from 'assert';
import * as vscode from 'vscode';

import { parsePlain, codeLines, warningCount, fmt } from '../../plain';
import { analyzeArgs, mapExit } from '../../runner';

const EXT_ID = 'oxide-sloc.oxide-sloc';
const COMMANDS = [
  'oxideSloc.analyzeWorkspace',
  'oxideSloc.analyzeCurrent',
  'oxideSloc.openReport',
  'oxideSloc.startServe',
  'oxideSloc.stopServe',
  'oxideSloc.refreshStatus',
  'oxideSloc.locateBinary',
  'oxideSloc.configureOptions',
];

describe('Extension activation', () => {
  it('is present and activates', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, `extension ${EXT_ID} not found`);
    await ext!.activate();
    assert.strictEqual(ext!.isActive, true);
  });

  it('registers every contributed command', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const cmd of COMMANDS) {
      assert.ok(all.includes(cmd), `command not registered: ${cmd}`);
    }
  });
});

describe('plain parsing', () => {
  const sample = [
    'files_analyzed=8',
    'code_lines=470',
    'comment_lines=53',
    'blank_lines=66',
    'cyclomatic_complexity=12',
    'unit_tests=0',
    'warning_count=2',
    'warning=first problem',
    'warning=second problem',
  ].join('\n');

  it('extracts totals', () => {
    const m = parsePlain(sample);
    assert.strictEqual(codeLines(m), 470);
    assert.strictEqual(m.raw.get('files_analyzed'), '8');
  });

  it('collects warning lines separately', () => {
    const m = parsePlain(sample);
    assert.strictEqual(m.warnings.length, 2);
    assert.strictEqual(warningCount(m), 2);
    assert.deepStrictEqual(m.warnings, ['first problem', 'second problem']);
  });

  it('is resilient to blank and malformed lines', () => {
    const m = parsePlain('code_lines=5\n\nnot-a-pair\n=oops\n');
    assert.strictEqual(codeLines(m), 5);
    assert.strictEqual(m.raw.get(''), 'oops');
  });
});

describe('compact number formatting', () => {
  it('matches the oxide-sloc UI rules', () => {
    assert.strictEqual(fmt(2), '2');
    assert.strictEqual(fmt(1247), '1,247');
    assert.strictEqual(fmt(15354), '15.4K');
    assert.strictEqual(fmt(15000), '15K');
    assert.strictEqual(fmt(100000), '100K');
    assert.strictEqual(fmt(3816326), '3.8M');
  });
});

describe('analyze argument building', () => {
  it('always includes analyze + --plain and the given paths', () => {
    const args = analyzeArgs(['C:/proj'], {});
    assert.strictEqual(args[0], 'analyze');
    assert.ok(args.includes('C:/proj'));
    assert.ok(args.includes('--plain'));
  });

  it('threads json/html outputs through', () => {
    const args = analyzeArgs(['p'], { jsonOut: 'a.json', htmlOut: 'b.html' });
    assert.ok(args.includes('--json-out') && args.includes('a.json'));
    assert.ok(args.includes('--html-out') && args.includes('b.html'));
  });
});

describe('exit-code mapping', () => {
  it('treats 0 as success and gates as non-ok', () => {
    assert.strictEqual(mapExit(0).ok, true);
    for (const code of [2, 3, 4, 5, 6]) {
      assert.strictEqual(mapExit(code).ok, false, `exit ${code} should not be ok`);
    }
  });

  it('marks budget/baseline/complexity as errors', () => {
    for (const code of [4, 5, 6]) {
      assert.strictEqual(mapExit(code).severity, 'error');
    }
  });
});
