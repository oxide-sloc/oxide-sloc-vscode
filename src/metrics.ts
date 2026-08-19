// Parse an oxide-sloc JSON report into the compact shape the UI needs.
//
// The full report (from `--json-out`) is far richer than the flat `--plain`
// stream: it carries a summary block, a per-language breakdown, and the tool
// version. We pull just the fields the tree view and status bar render.

import * as fs from 'fs';

/** One language's totals from `totals_by_language`. */
export interface LanguageTotals {
  language: string;
  files: number;
  codeLines: number;
  commentLines: number;
  blankLines: number;
}

/** One file's counts from `per_file_records`. */
export interface FileRecord {
  path: string;
  language: string;
  codeLines: number;
  commentLines: number;
  blankLines: number;
  complexity?: number;
}

/** COCOMO effort estimate from the `cocomo` block. */
export interface Cocomo {
  mode: string;
  effortPersonMonths: number;
  durationMonths: number;
  avgStaff: number;
}

/** Cap on per-file rows we keep/persist, to bound memory on large repos. */
export const MAX_FILE_RECORDS = 200;

/** Compact view of a report, derived from the JSON output. */
export interface SlocReport {
  /** oxide-sloc version that produced the report, if present. */
  version?: string;
  filesAnalyzed: number;
  filesSkipped: number;
  physicalLines: number;
  codeLines: number;
  commentLines: number;
  blankLines: number;
  complexity?: number;
  functions?: number;
  classes?: number;
  unitTests?: number;
  /** Percentage of unique logical lines (higher = less duplication). */
  drynessPct?: number;
  /** Unique logical lines of code. */
  uloc?: number;
  cocomo?: Cocomo;
  languages: LanguageTotals[];
  /** Per-file rows, sorted by code lines desc, capped at {@link MAX_FILE_RECORDS}. */
  files: FileRecord[];
  /** True when {@link files} was truncated by the cap. */
  filesTruncated: boolean;
  warnings: string[];
  /** When the report was generated (ms since epoch), stamped by the caller. */
  generatedAt: number;
  /** Absolute path to the HTML report, when one was produced alongside. */
  htmlPath?: string;
}

function n(v: unknown): number {
  const num = Number(v);
  return Number.isFinite(num) ? num : 0;
}

function optN(v: unknown): number | undefined {
  if (v === undefined || v === null) {
    return undefined;
  }
  const num = Number(v);
  return Number.isFinite(num) ? num : undefined;
}

/** Turn oxide-sloc's snake_case language ids into display names (`type_script` -> `TypeScript`). */
export function prettyLanguage(id: string): string {
  const special: Record<string, string> = {
    type_script: 'TypeScript',
    java_script: 'JavaScript',
    c_sharp: 'C#',
    cpp: 'C++',
    c: 'C',
    objective_c: 'Objective-C',
  };
  if (special[id]) {
    return special[id];
  }
  return id
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Parse a raw JSON report object into a {@link SlocReport}. */
export function parseReport(json: any, generatedAt: number, htmlPath?: string): SlocReport {
  const totals = json?.summary_totals ?? {};
  const byLang: any[] = Array.isArray(json?.totals_by_language) ? json.totals_by_language : [];

  const languages: LanguageTotals[] = byLang
    .map((l) => ({
      language: prettyLanguage(String(l?.language ?? 'unknown')),
      files: n(l?.files),
      codeLines: n(l?.code_lines),
      commentLines: n(l?.comment_lines),
      blankLines: n(l?.blank_lines),
    }))
    .sort((a, b) => b.codeLines - a.codeLines);

  const rawFiles: any[] = Array.isArray(json?.per_file_records) ? json.per_file_records : [];
  const allFiles: FileRecord[] = rawFiles
    .map((f) => ({
      path: String(f?.relative_path ?? f?.path ?? '?'),
      language: prettyLanguage(String(f?.language ?? 'unknown')),
      codeLines: n(f?.effective_counts?.code_lines),
      commentLines: n(f?.effective_counts?.comment_lines),
      blankLines: n(f?.effective_counts?.blank_lines),
      complexity: optN(f?.cyclomatic_complexity),
    }))
    .sort((a, b) => b.codeLines - a.codeLines);
  const files = allFiles.slice(0, MAX_FILE_RECORDS);

  const c = json?.cocomo;
  const cocomo: Cocomo | undefined = c
    ? {
        mode: String(c.mode ?? ''),
        effortPersonMonths: n(c.effort_person_months),
        durationMonths: n(c.duration_months),
        avgStaff: n(c.avg_staff),
      }
    : undefined;

  return {
    version: json?.tool?.version ? String(json.tool.version) : undefined,
    filesAnalyzed: n(totals.files_analyzed),
    filesSkipped: n(totals.files_skipped),
    physicalLines: n(totals.total_physical_lines),
    codeLines: n(totals.code_lines),
    commentLines: n(totals.comment_lines),
    blankLines: n(totals.blank_lines),
    complexity: optN(totals.cyclomatic_complexity),
    functions: optN(totals.functions),
    classes: optN(totals.classes),
    unitTests: optN(totals.test_count),
    drynessPct: optN(json?.dryness_pct),
    uloc: optN(json?.uloc),
    cocomo,
    languages,
    files,
    filesTruncated: allFiles.length > files.length,
    warnings: Array.isArray(json?.warnings) ? json.warnings.map(String) : [],
    generatedAt,
    htmlPath,
  };
}

/** Read and parse a JSON report file. Returns undefined on any I/O or parse error. */
export function readReport(jsonPath: string, generatedAt: number, htmlPath?: string): SlocReport | undefined {
  try {
    const raw = fs.readFileSync(jsonPath, 'utf8');
    return parseReport(JSON.parse(raw), generatedAt, htmlPath);
  } catch {
    return undefined;
  }
}
