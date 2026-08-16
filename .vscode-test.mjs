import { defineConfig } from '@vscode/test-cli';

// Runs the compiled Mocha suite inside a sandboxed VS Code instance.
export default defineConfig({
  files: 'out/test/**/*.test.js',
  version: 'stable',
  mocha: {
    ui: 'bdd',
    timeout: 20000,
    color: true,
  },
});
