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

  // package.json must not take over .s/.S/.asm with a grammar-less language id. The no-truncate
  // default goes to the language ids that assembly extensions register (open-vsx manifests).
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  const langs = (pkg.contributes.languages ?? []) as { extensions?: string[] }[];
  assert.ok(!langs.some((l) => (l.extensions ?? []).some((e) => ['.s', '.S', '.asm'].includes(e))), 'languages contribution claims .s/.S/.asm');
  const defaults = pkg.contributes.configurationDefaults as Record<string, Record<string, unknown>>;
  assert.ok(Object.keys(defaults).length > 0, 'no configurationDefaults');
  for (const [k, v] of Object.entries(defaults)) {
    assert.match(k, /^(\[[^\]]+\])+$/, `${k}: not a language-override key`);
    assert.strictEqual(v['editor.inlayHints.maximumLength'], 0, `${k}: editor.inlayHints.maximumLength is not 0`);
  }
  for (const id of ['asm-intel-x86-generic', 'arm64', 'arm', 'riscv']) {
    assert.ok(defaults[`[${id}]`] || Object.keys(defaults).some((k) => k.includes(`[${id}]`)), `no default for ${id}`);
  }
  console.log('find.unit: ok');
}

if (require.main === module) run();
