// Shared analysis state: the last report, binary status, and busy flag.
//
// Both the status-bar item and the Activity Bar tree render from this single
// source and re-render on its change event, so they never drift out of sync.

import * as vscode from 'vscode';
import { SlocReport } from './metrics';
import { BinaryStatus } from './binary';

const STATE_KEY = 'oxideSloc.lastReport';

export class ReportStore {
  private _report?: SlocReport;
  private _binary?: BinaryStatus;
  private _analyzing = false;
  private readonly emitter = new vscode.EventEmitter<void>();

  /** Fires whenever the report, binary status, or busy flag changes. */
  readonly onDidChange = this.emitter.event;

  constructor(private readonly memento?: vscode.Memento) {
    if (memento) {
      this._report = memento.get<SlocReport>(STATE_KEY);
    }
  }

  get report(): SlocReport | undefined {
    return this._report;
  }

  get binary(): BinaryStatus | undefined {
    return this._binary;
  }

  get analyzing(): boolean {
    return this._analyzing;
  }

  setReport(report: SlocReport): void {
    this._report = report;
    void this.memento?.update(STATE_KEY, report);
    this.emitter.fire();
  }

  setBinary(status: BinaryStatus): void {
    this._binary = status;
    this.emitter.fire();
  }

  setAnalyzing(busy: boolean): void {
    if (this._analyzing !== busy) {
      this._analyzing = busy;
      this.emitter.fire();
    }
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
