import { runTests } from '@vscode/test-electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Env: VSCODE_CACHE (download dir), VSCODE_EXE (use this binary, skip resolve/download), SIMDREF_MODE (see suite.ts), SHOT_DIR (optional).
runTests({
  version: process.env.VSCODE_VERSION ?? '1.140.0',
  cachePath: process.env.VSCODE_CACHE,
  vscodeExecutablePath: process.env.VSCODE_EXE,
  extensionDevelopmentPath: path.resolve(__dirname, '../..'),
  extensionTestsPath: path.resolve(__dirname, 'suite'),
  launchArgs: [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    '--user-data-dir',
    process.env.VSCODE_USER_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), 'vsc-user-')),
    '--extensions-dir',
    fs.mkdtempSync(path.join(os.tmpdir(), 'vsc-ext-')),
  ],
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
