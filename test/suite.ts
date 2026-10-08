import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { run as findUnit } from './find.unit';
import { run as updateUnit } from './update.unit';

// SIMDREF_MODE: hints (default) | install | error | lazystart. SHOT_DIR: save screenshots there.
const ASM = [
  'vfmadd231ps ymm0, ymm1, ymm2',
  'vaddps ymm0, ymm0, ymm3',
  '.text',
  'main:',
  'ret',
  '',
].join('\n');
const ASM_HINT_LINES = [0, 1, 4];
const CPP = ['int main() {', '  asm volatile("vaddps %ymm1, %ymm2, %ymm0");', '  return 0;', '}', ''].join('\n');
const CPP_HINT_LINES = [1];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function hintLines(doc: vscode.TextDocument, want: number): Promise<vscode.InlayHint[]> {
  let hints: vscode.InlayHint[] = [];
  for (let i = 0; i < 30; i++) {
    hints =
      (await vscode.commands.executeCommand<vscode.InlayHint[]>(
        'vscode.executeInlayHintProvider',
        doc.uri,
        new vscode.Range(0, 0, doc.lineCount, 0),
      )) ?? [];
    if (hints.length >= want) break;
    await sleep(1000);
  }
  return hints;
}

async function check(dir: string, name: string, text: string, expected: number[]) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc);
  const hints = await hintLines(doc, expected.length);
  const lines = hints.map((h) => h.position.line).sort();
  const label = (h: vscode.InlayHint) => (typeof h.label === 'string' ? h.label : h.label.map((p) => p.value).join(''));
  console.log(name, JSON.stringify(hints.map((h) => [h.position.line, label(h)])));
  assert.deepStrictEqual(lines, expected, `${name}: hint lines`);
  const vaddps = hints.find((h) => h.position.line === 1); // vaddps is on line 1 in both fixtures
  assert.match(label(vaddps!), /Add Packed/, `${name}: vaddps hint text`);
  if (process.env.SHOT_DIR) {
    // Close the Chat panel (auxiliary bar): it takes the right side in VS Code 1.140 and clips the hint.
    await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
    // The default window is 1208px and clips the long vaddps hint. Xvfb has no WM, so XResizeWindow it.
    try {
      execFileSync('xdotool', ['search', '--name', 'Extension Development Host', 'windowmove', '0', '0', 'windowsize', '1920', '1080'], { stdio: 'ignore' });
    } catch { /* keep the default size */ }
    await sleep(3000); // let the editor paint the hints
    execFileSync('import', ['-window', 'root', path.join(process.env.SHOT_DIR, `${name}.png`)]);
  }
}

export async function run(): Promise<void> {
  findUnit();
  await updateUnit();
  const ext = vscode.extensions.getExtension('simd-labs.vscode-simdref');
  assert.ok(ext, 'extension not found');
  const { log, HELP } = (await ext.activate()) as { log: string[]; HELP: string };
  const text = () => log.join('\n'); // the log grows while the lazy start runs
  console.log(text());
  console.log('HELP from extension exports:', HELP);
  switch (process.env.SIMDREF_MODE ?? 'hints') {
    case 'install': {
      // Open an asm file to trigger the lazy start, which runs the uv install step.
      const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'simdref-inst-')), 'x.s');
      fs.writeFileSync(f, 'ret\n');
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(f));
      for (let i = 0; i < 300 && !text().includes('simdref-lsp started') && !text().includes(HELP); i++) await sleep(1000);
      for (const m of ['downloading uv', 'installing simdref', 'running isa update', 'simdref-lsp started']) {
        assert.ok(text().includes(m), `log lacks "${m}"`);
      }
      // uv must not write outside the extension storage.
      const home = os.homedir();
      assert.ok(!fs.existsSync(path.join(home, '.cache', 'uv')), '~/.cache/uv exists');
      assert.ok(!fs.existsSync(path.join(home, '.local', 'share', 'uv')), '~/.local/share/uv exists');
      break;
    }
    case 'error': {
      // Open a C file to trigger the lazy start; vsc-clean has no server and no network.
      const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'simdref-err-')), 'x.c');
      fs.writeFileSync(f, 'int main(void){}\n');
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(f));
      for (let i = 0; i < 90 && !text().includes(HELP); i++) await sleep(1000);
      assert.ok(text().includes(HELP), 'log lacks the error text');
      assert.ok(!text().includes('simdref-lsp started'));
      // A failed start must retry on the next matching document.
      const g = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'simdref-err2-')), 'y.s');
      fs.writeFileSync(g, 'ret\n');
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(g));
      for (let i = 0; i < 90 && text().split(HELP).length - 1 < 2; i++) await sleep(1000);
      assert.strictEqual(text().split(HELP).length - 1, 2, 'log lacks a second install attempt');
      break;
    }
    case 'nohints': {
      // F4: a simdref-lsp without inlayHintProvider (simdref 0.0.7) starts fine but gives no hints. The extension must warn.
      const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'simdref-nohint-')), 'x.s');
      fs.writeFileSync(f, 'ret\n');
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(f));
      for (let i = 0; i < 60 && !text().includes('warning:'); i++) await sleep(1000);
      assert.ok(text().includes('simdref-lsp started'), 'server did not start');
      assert.match(text(), /warning: .* has no inlay hints/, 'log lacks the no-inlay-hints warning');
      break;
    }
    case 'lazystart': {
      // F1: a .txt file must not start the server or an install step; a .s file must.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simdref-lazy-'));
      const txt = path.join(dir, 'notes.txt');
      fs.writeFileSync(txt, 'plain text, no assembly\n');
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(txt));
      // pred: old code starts at activation; catch it by polling up to 30 s
      for (let i = 0; i < 30 && !text().includes('simdref-lsp started') && !text().includes('downloading uv'); i++) await sleep(1000);
      assert.ok(!text().includes('simdref-lsp started'), 'server started without a matching document');
      assert.ok(!text().includes('downloading uv'), 'install ran without a matching document');
      const s = path.join(dir, 'fixture.s');
      fs.writeFileSync(s, ASM);
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(s));
      for (let i = 0; i < 60 && !text().includes('simdref-lsp started'); i++) await sleep(1000);
      assert.ok(text().includes('simdref-lsp started'), 'server did not start for a .s document');
      const hints = await hintLines(await vscode.workspace.openTextDocument(s), ASM_HINT_LINES.length);
      assert.deepStrictEqual(hints.map((h) => h.position.line).sort(), ASM_HINT_LINES, 'fixture.s: hint lines');
      break;
    }
    default: {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simdref-fx-'));
      // Open fixture.s first: the lazy start triggers on the first matching document.
      const s = path.join(dir, 'fixture.s');
      fs.writeFileSync(s, ASM);
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(s));
      for (let i = 0; i < 90 && !text().includes('simdref-lsp started'); i++) await sleep(1000);
      assert.ok(text().includes('simdref-lsp started'), 'server did not start');
      await check(dir, 'fixture.s', ASM, ASM_HINT_LINES);
      await check(dir, 'fixture.cpp', CPP, CPP_HINT_LINES);
    }
  }
}
