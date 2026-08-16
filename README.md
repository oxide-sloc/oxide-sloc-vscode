# oxide-sloc for VS Code

Run [oxide-sloc](https://github.com/oxide-sloc/oxide-sloc) code-metrics reports without leaving the
editor. The extension shells out to the `oxide-sloc` binary, so it works with whatever version you
already have installed.

This is the companion repository for the VS Code extension. The
[Visual Studio extension](https://github.com/oxide-sloc/oxide-sloc-visual-studio) and the CMake
integration live separately — see the main
[oxide-sloc](https://github.com/oxide-sloc/oxide-sloc) repository.

## Features

- **Analyze Workspace** / **Analyze Current File/Folder** - one command to scan and report.
- **Status bar** - a live code-line count for the open workspace (`$(code) 78.5K SLOC`); click it to re-analyze.
- **Open HTML Report** - view the full report in your browser or in a VS Code webview.
- **Web UI** - start/stop the oxide-sloc web dashboard (http://127.0.0.1:4317) from the command palette.
- **Gate awareness** - if a run trips a `--fail-*` gate (warnings, threshold, budget, baseline, complexity),
  the extension shows a matching notification.

## Requirements

The `oxide-sloc` executable must be available. The extension finds it, in order, from:

1. the `oxideSloc.binaryPath` setting,
2. the `SLOC_BIN` / `OXIDE_SLOC` environment variables,
3. `oxide-sloc` on your `PATH`.

Install oxide-sloc via the instructions at https://github.com/oxide-sloc/oxide-sloc.

## Commands

| Command | Description |
|---------|-------------|
| `Oxide SLOC: Analyze Workspace` | Scan all workspace folders. |
| `Oxide SLOC: Analyze Current File/Folder` | Scan the active file, or a folder/file from the Explorer context menu. |
| `Oxide SLOC: Open HTML Report` | Open the most recent report. |
| `Oxide SLOC: Start Web UI` / `Stop Web UI` | Manage the oxide-sloc web dashboard. |
| `Oxide SLOC: Refresh Status Bar` | Re-run the workspace analysis for the status bar. |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `oxideSloc.binaryPath` | `""` | Explicit path to `oxide-sloc`. Empty = env vars, then `PATH`. |
| `oxideSloc.analyzeFlags` | `[]` | Extra flags appended to `analyze` (e.g. `["--per-file", "--activity-window", "90"]`). |
| `oxideSloc.configPath` | `""` | Path to a `.oxide-sloc.toml`, passed as `--config`. |
| `oxideSloc.report.viewer` | `external` | Open reports in the external browser or a webview. |
| `oxideSloc.report.useBinaryOpen` | `false` | Let oxide-sloc open the report itself (`--open`). |
| `oxideSloc.statusBar.enabled` | `true` | Show the status-bar code-line count. |
| `oxideSloc.statusBar.autoRefresh` | `false` | Re-analyze on every save (can be slow on large trees). |
| `oxideSloc.serve.port` | `4317` | Port for the web UI started from VS Code. |

Reports are written to the extension's storage directory, never into your workspace.

## Exit codes

The analyze commands map oxide-sloc's exit codes to notifications:

| Exit | Meaning |
|------|---------|
| 0 | Success |
| 2 | Warnings gate (`--fail-on-warnings`) |
| 3 | Code lines below threshold (`--fail-below`) |
| 4 | SLOC budget exceeded (`--fail-on-budget`) |
| 5 | Growth exceeded baseline (`--fail-above-baseline`) |
| 6 | Cyclomatic complexity exceeded (`--max-complexity`) |

## Building from source

This is the companion repository for the VS Code extension. The Visual Studio (VSIX) extension and
the CMake integration live in their own repositories — see the main
[oxide-sloc](https://github.com/oxide-sloc/oxide-sloc) repo for the full list.

```sh
git clone https://github.com/oxide-sloc/oxide-sloc-vscode.git
cd oxide-sloc-vscode
npm install
npm run compile            # type-check and emit out/
npx @vscode/vsce package   # produce oxide-sloc-<version>.vsix
code --install-extension oxide-sloc-*.vsix
```

Press `F5` in VS Code (with this folder open) to launch an Extension Development Host for live testing.

CI builds the `.vsix` on every push (see [`.github/workflows/build.yml`](.github/workflows/build.yml))
and uploads it as a build artifact.

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).
