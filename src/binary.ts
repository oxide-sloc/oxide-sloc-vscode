// Locate and run the oxide-sloc executable.

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Set when the process could not be started at all (e.g. binary not found). */
  spawnError?: Error;
}

/**
 * Resolve the oxide-sloc binary, in order:
 *   1. the `oxideSloc.binaryPath` setting, if non-empty
 *   2. the `SLOC_BIN` / `OXIDE_SLOC` environment variables
 *   3. the bare name `oxide-sloc` (resolved via PATH by the OS)
 */
export function resolveBinary(): string {
  const configured = vscode.workspace
    .getConfiguration('oxideSloc')
    .get<string>('binaryPath', '')
    .trim();
  if (configured) {
    return configured;
  }
  const fromEnv = (process.env.SLOC_BIN || process.env.OXIDE_SLOC || '').trim();
  if (fromEnv) {
    return fromEnv;
  }
  return 'oxide-sloc';
}

/**
 * Run oxide-sloc with the given argv (no shell - args are passed as an array,
 * so paths with spaces need no quoting). Resolves with captured stdout/stderr
 * and the exit code; never rejects.
 */
export function spawnSloc(args: string[], cwd?: string): Promise<SpawnResult> {
  const bin = resolveBinary();
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      resolve({ code: null, stdout, stderr, spawnError: err });
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

/** Where the resolved binary came from, for display in the Setup view. */
export type BinarySource = 'setting' | 'environment' | 'path' | 'not-found';

export interface BinaryStatus {
  /** The command/path that will be spawned, or the bare name when relying on PATH. */
  command: string;
  /** oxide-sloc version, when the binary could be probed. */
  version?: string;
  ok: boolean;
  source: BinarySource;
}

const EXE = process.platform === 'win32' ? 'oxide-sloc.exe' : 'oxide-sloc';

/** Run `<bin> --version` synchronously; return the version string, or undefined if it can't run. */
export function probeVersion(bin: string): string | undefined {
  try {
    const res = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000, shell: false });
    if (res.status === 0 && res.stdout) {
      // Output looks like "oxide-sloc 1.6.16" - keep the version token.
      const m = res.stdout.trim().match(/([0-9]+\.[0-9]+\.[0-9]+\S*)/);
      return m ? m[1] : res.stdout.trim();
    }
  } catch {
    /* not runnable */
  }
  return undefined;
}

/**
 * Report the current binary status: what would be spawned, where it came from,
 * and whether it actually runs. Used by the Setup section of the tree view.
 */
export function binaryStatus(): BinaryStatus {
  const configured = vscode.workspace
    .getConfiguration('oxideSloc')
    .get<string>('binaryPath', '')
    .trim();
  if (configured) {
    return { command: configured, version: probeVersion(configured), ok: !!probeVersion(configured), source: 'setting' };
  }
  const fromEnv = (process.env.SLOC_BIN || process.env.OXIDE_SLOC || '').trim();
  if (fromEnv) {
    return { command: fromEnv, version: probeVersion(fromEnv), ok: !!probeVersion(fromEnv), source: 'environment' };
  }
  const version = probeVersion('oxide-sloc');
  return { command: 'oxide-sloc', version, ok: !!version, source: version ? 'path' : 'not-found' };
}

/**
 * Look for a locally built oxide-sloc binary next to the current workspace,
 * so users who cloned the oxide-sloc repo alongside their project (or opened it
 * directly) get one-click setup. Returns runnable candidate paths, release first.
 */
export function autodetectCandidates(): string[] {
  const roots = new Set<string>();
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const fsPath = folder.uri.fsPath;
    roots.add(fsPath); // the folder itself might be the oxide-sloc checkout
    roots.add(path.dirname(fsPath)); // a sibling oxide-sloc checkout
  }

  const candidates: string[] = [];
  for (const root of roots) {
    for (const sub of ['oxide-sloc', '.']) {
      for (const profile of ['release', 'debug']) {
        candidates.push(path.join(root, sub, 'target', profile, EXE));
      }
    }
  }

  // Keep only those that exist and actually run, de-duplicated, preserving order.
  const seen = new Set<string>();
  const found: string[] = [];
  for (const c of candidates) {
    if (seen.has(c)) {
      continue;
    }
    seen.add(c);
    if (fs.existsSync(c) && probeVersion(c)) {
      found.push(c);
    }
  }
  return found;
}
