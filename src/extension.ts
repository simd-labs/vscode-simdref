import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { exe, find } from './find';
import { maybeUpgrade, uvEnv } from './update';

const run = promisify(execFile);
const URL = 'https://github.com/simd-labs/simdref';
export const HELP = `simdref not found. Install it: uv tool install simdref (or pip install simdref), then run isa update. Instructions: ${URL}`;
const DOCUMENT_SELECTOR: vscode.DocumentSelector = [
  { scheme: 'file', pattern: '**/*.s' },
  { scheme: 'file', pattern: '**/*.S' },
  { scheme: 'file', pattern: '**/*.asm' },
  { scheme: 'file', language: 'c' },
  { scheme: 'file', language: 'cpp' },
];
const UV_VERSION = '0.12.23';
const UV_TARGETS: Record<string, string> = {
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
};

// Download the latest uv release into `dir`, then install simdref and its catalog with it.
async function install(dir: string, step: (m: string) => void): Promise<void> {
  const target = UV_TARGETS[`${process.platform}-${process.arch}`];
  if (!target) throw new Error(`no uv build for ${process.platform}-${process.arch}`);
  const zip = process.platform === 'win32';
  const url = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${target}.${zip ? 'zip' : 'tar.gz'}`;
  step(`downloading uv ${UV_VERSION}`);
  const get = async (u: string) => {
    const res = await fetch(u);
    if (!res.ok) throw new Error(`GET ${u}: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  };
  const data = await get(url);
  const want = (await get(`${url}.sha256`)).toString().trim().split(/\s+/)[0];
  const got = createHash('sha256').update(data).digest('hex');
  if (got !== want) throw new Error(`uv checksum mismatch: got ${got}, want ${want}`);
  const uvDir = path.join(dir, 'uv');
  fs.mkdirSync(uvDir, { recursive: true });
  const archive = path.join(dir, zip ? 'uv.zip' : 'uv.tar.gz');
  // A second window can download the same file at the same time. Write to a pid-suffixed file, then rename.
  const part = `${archive}.${process.pid}.part`;
  try {
    fs.writeFileSync(part, data);
    fs.renameSync(part, archive);
  } catch (err) {
    fs.rmSync(part, { force: true });
    throw err;
  }
  // The tar.gz holds one top-level folder; the zip is flat. Windows tar reads zip.
  await run('tar', ['-xf', archive, '-C', uvDir, ...(zip ? [] : ['--strip-components=1'])]);
  fs.rmSync(archive, { force: true });
  const bin = path.join(dir, 'bin');
  // Keep every uv write inside the extension storage: tools, python builds, cache.
  const env = uvEnv(dir);
  step('installing simdref');
  await run(path.join(uvDir, exe('uv')), ['tool', 'install', 'simdref'], { env });
  step('running isa update');
  await run(path.join(bin, exe('isa')), ['update'], { env });
}

let client: LanguageClient | undefined;

// Find or install the server, then start the client. Runs at most once per window.
// `out` receives both the install steps and the language client trace. Returns true when the client started.
async function start(dir: string, out: vscode.LogOutputChannel, say: (m: string) => void): Promise<boolean> {
  const bin = path.join(dir, 'bin');
  try {
    let server =
      find('simdref-lsp', (process.env.PATH ?? '').split(path.delimiter)) ?? find('simdref-lsp', [bin]);
    if (!server) {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'simdref' },
        async (progress) => {
          await install(dir, (m) => {
            say(m);
            progress.report({ message: m });
          });
        },
      );
      server = find('simdref-lsp', [bin]);
      if (!server) throw new Error('simdref-lsp is missing after install');
    }
    say(`using ${server}`);
    // The vscode-languageclient protocol types differ from the vscode types; the selector values are the same.
    client = new LanguageClient('simdref', { command: server }, { documentSelector: DOCUMENT_SELECTOR as import('vscode-languageclient/node').DocumentSelector, outputChannel: out });
    await client.start();
    say('simdref-lsp started');
    // Daily background upgrade of the extension-installed copy; never blocks the start.
    // A new simdref version takes effect at the next server start.
    // The background task never rejects; this catch is the boundary if that rule ever breaks.
    void maybeUpgrade(dir, server, say).catch((e) => say(`simdref upgrade task failed: ${e instanceof Error ? e.message : String(e)}`));
    // An old simdref-lsp (0.0.7 or older) on PATH has no inlay hints and fails silently. Check the capability once.
    if (!client.initializeResult?.capabilities.inlayHintProvider) {
      say(`warning: ${server} has no inlay hints`);
      void vscode.window.showWarningMessage(
        `simdref-lsp at ${server} has no inlay hints. Run \`uv tool upgrade simdref\` (needs simdref 0.0.8 or newer).`,
      );
    }
    return true;
  } catch (e) {
    const msg = `${HELP}\n${e instanceof Error ? e.message : String(e)}`;
    say(msg);
    // Do not await: the promise only settles when the user closes the message.
    void vscode.window
      .showErrorMessage(msg, 'Open instructions')
      .then((b) => b && vscode.env.openExternal(vscode.Uri.parse(URL)));
    return false;
  }
}

// The returned log is a test hook: it mirrors the install and start steps. HELP: so the test always has the real constant (F2).
export async function activate(ctx: vscode.ExtensionContext): Promise<{ log: string[]; HELP: string }> {
  const out = vscode.window.createOutputChannel('simdref', { log: true });
  const log: string[] = [];
  const say = (m: string) => {
    log.push(m);
    out.appendLine(m);
  };
  // Do the install and the server start only when a matching document is open.
  let starting = false;
  const onDoc = (doc: vscode.TextDocument) => {
    if (starting || !vscode.languages.match(DOCUMENT_SELECTOR, doc)) return;
    starting = true;
    // A failed start clears the flag: the next matching document retries.
    void start(ctx.globalStorageUri.fsPath, out, say).then((ok) => {
      if (!ok) starting = false;
    });
  };
  ctx.subscriptions.push(vscode.workspace.onDidOpenTextDocument(onDoc));
  vscode.workspace.textDocuments.forEach(onDoc);
  return { log, HELP };
}

export async function deactivate(): Promise<void> {
  const c = client;
  client = undefined;
  await c?.stop();
}
