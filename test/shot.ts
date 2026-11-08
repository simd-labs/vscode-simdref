import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

// Screenshot entry point (SHOT=1, run.sh shot). Writes four 1600x1000 PNGs to SHOT_DIR:
// inlay hints on fixture.s and fixture.cpp, and the vaddps hover in each.
// Fixtures are embedded so the shot entry point is self-contained.
const ASM = [
  '.text',
  '.globl my_label',
  'my_label:',
  '    vfmadd231ps ymm0, ymm1, ymm2',
  '    vaddps ymm0, ymm0, ymm3',
  '    ret',
  '',
].join('\n');
const CPP = ['void demo() {', '    asm volatile("vaddps %ymm1, %ymm2, %ymm0");', '}'].join('\n');
const ASM_HINT_LINES = [3, 4, 5];
const CPP_HINT_LINES = [1];

// The hint text sits right of the code on those lines; the caret stays at line 0, column 0,
// left of this crop, so blinking never breaks the frame compare.
const CROP = '1300x180+150+90';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vsc-shot-'));

function xrun(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8' });
  } catch (e) {
    // compare exits 1 when images differ; the AE count still lands on stdout.
    return (e as { stdout?: string }).stdout ?? '';
  }
}

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

function hintSettled(hints: vscode.InlayHint[], expected: number[]): boolean {
  const lines = hints.map((h) => h.position.line).sort((a, b) => a - b);
  return JSON.stringify(lines) === JSON.stringify(expected);
}

function capture(file: string, crop?: string) {
  const args = ['-window', 'root'];
  if (crop) args.push('-crop', crop, '+repage');
  args.push(file);
  xrun('import', args);
}

function framesIdentical(a: string, b: string): boolean {
  return parseInt(xrun('compare', ['-metric', 'AE', a, b, 'null:']), 10) === 0;
}

function pixelDiff(a: string, b: string): number {
  return parseInt(xrun('compare', ['-metric', 'AE', '-fuzz', '10%', a, b, 'null:']), 10) || 0;
}

function windowReady(): boolean {
  try {
    return /1600x1000/.test(
      xrun('xdotool', ['search', '--name', 'Extension Development Host', 'getwindowgeometry']),
    );
  } catch {
    return false;
  }
}

// Xvfb has no WM: move and size the window by hand, then wait for the geometry to hold.
async function resizeWindow(): Promise<void> {
  try {
    execFileSync('xdotool', ['search', '--name', 'Extension Development Host', 'windowmove', '0', '0', 'windowsize', '1600', '1000'], { stdio: 'ignore' });
  } catch { /* keep the default size */ }
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && !windowReady()) await sleep(450);
  await sleep(500); // let the editor repaint after the resize
}

// Paint settled: two consecutive identical cropped frames.
async function waitPaintStable(): Promise<void> {
  const dir = tmp();
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const a = path.join(dir, 'a.png');
    const b = path.join(dir, 'b.png');
    capture(a, CROP);
    await sleep(450);
    capture(b, CROP);
    if (framesIdentical(a, b)) return;
  }
  console.log('hint gate: frames never identical, capturing anyway');
}

// Hover painted: a >2000-px fuzzed diff against the pre-hover frame.
async function waitHoverPainted(pre: string): Promise<void> {
  const cur = path.join(tmp(), 'cur.png');
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    capture(cur);
    if (pixelDiff(pre, cur) > 2000) return;
    await sleep(450);
  }
  console.log('hover gate: no change detected, capturing anyway');
}

async function openAndCheckHints(file: string, text: string, expected: number[]): Promise<vscode.TextDocument> {
  fs.writeFileSync(file, text);
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc);
  const hints = await hintLines(doc, expected.length);
  if (!hintSettled(hints, expected)) {
    throw new Error(`${path.basename(file)}: hint lines ${JSON.stringify(hints.map((h) => h.position.line))}, want ${JSON.stringify(expected)}`);
  }
  return doc;
}

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension('simd-labs.vscode-simdref');
  if (!ext) throw new Error('extension not found');
  const { log } = (await ext.activate()) as { log: string[]; HELP: string };
  const text = () => log.join('\n');
  console.log('step: activated, log empty so far');

  const dir = tmp();
  const s = path.join(dir, 'fixture.s');
  const c = path.join(dir, 'fixture.cpp');
  const docS = await openAndCheckHints(s, ASM, ASM_HINT_LINES);
  console.log('step: asm hints ready');
  for (let i = 0; i < 90 && !text().includes('simdref-lsp started'); i++) await sleep(1000);
  if (!text().includes('simdref-lsp started')) throw new Error(`server did not start: ${text()}`);
  console.log('step: server started; log entries:', text().split('\n').filter(Boolean).length);

  // Close the Chat panel (auxiliary bar): it takes the right side in VS Code 1.140.
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  await resizeWindow();

  // 1. asm hints
  console.log('step: capturing asm hints');
  await waitPaintStable();
  capture(path.join(process.env.SHOT_DIR!, 'shot-asm-hints.png'));

  // 2. asm hover: cursor on the vaddps line, then force the hover.
  const pre1 = path.join(tmp(), 'pre1.png');
  capture(pre1);
  const ed1 = vscode.window.activeTextEditor;
  if (!ed1) throw new Error('no active editor');
  ed1.selection = new vscode.Selection(4, 8, 4, 8);
  await vscode.commands.executeCommand('editor.action.showHover');
  await waitHoverPainted(pre1);
  console.log('step: capturing asm hover');
  capture(path.join(process.env.SHOT_DIR!, 'shot-asm-hover.png'));

  // 3. cpp hints
  await openAndCheckHints(c, CPP, CPP_HINT_LINES);
  console.log('step: cpp hints ready');
  await resizeWindow();
  await waitPaintStable();
  capture(path.join(process.env.SHOT_DIR!, 'shot-cpp-hints.png'));

  // 4. cpp hover: cursor inside the vaddps asm string, then force the hover.
  const pre2 = path.join(tmp(), 'pre2.png');
  capture(pre2);
  const ed2 = vscode.window.activeTextEditor;
  if (!ed2) throw new Error('no active editor');
  ed2.selection = new vscode.Selection(1, 20, 1, 20);
  await vscode.commands.executeCommand('editor.action.showHover');
  await waitHoverPainted(pre2);
  console.log('step: capturing cpp hover');
  capture(path.join(process.env.SHOT_DIR!, 'shot-cpp-hover.png'));

  console.log('screenshots done');
}