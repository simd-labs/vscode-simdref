import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exe, find } from '../src/find';

// Runs under plain node: `node out/test/find.unit.js`. Also called from suite.ts.
export function run(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simdref-find-'));
  // A real file with no exec bit: win32 (F_OK) must match it, linux (X_OK) must not.
  const noExec = path.join(dir, 'simdref-lsp.exe');
  fs.writeFileSync(noExec, '', { mode: 0o644 });
  const exec = path.join(dir, 'simdref-lsp');
  fs.writeFileSync(exec, '', { mode: 0o755 });

  assert.strictEqual(exe('simdref-lsp', 'win32'), 'simdref-lsp.exe');
  assert.strictEqual(exe('simdref-lsp', 'linux'), 'simdref-lsp');
  // win32: a file without the exec bit still matches.
  assert.strictEqual(find('simdref-lsp', [dir], 'win32'), noExec);
  // linux: only the file with the exec bit matches.
  assert.strictEqual(find('simdref-lsp', [dir], 'linux'), exec);
  // Missing file matches on neither platform.
  assert.strictEqual(find('absent-lsp', [dir], 'win32'), undefined);
  assert.strictEqual(find('absent-lsp', [dir], 'linux'), undefined);
  console.log('find.unit: ok');
}

if (require.main === module) run();
