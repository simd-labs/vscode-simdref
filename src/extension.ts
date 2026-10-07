import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { exe, find } from './find';

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
  const url = `https://github.com/astral-sh/uv/releases/latest/download/uv-${target}.${zip ? 'zip' : 'tar.gz'}`;
  step('downloading uv');
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
  fs.writeFileSync(archive, data);
  // The tar.gz holds one top-level folder; the zip is flat. Windows tar reads zip.
  await run('tar', ['-xf', archive, '-C', uvDir, ...(zip ? [] : ['--strip-components=1'])]);
  const bin = path.join(dir, 'bin');
  // Keep every uv write inside the extension storage: tools, python builds, cache.
  const env = {
    ...process.env,
    UV_TOOL_DIR: path.join(dir, 'tools'),
    UV_TOOL_BIN_DIR: bin,
    UV_PYTHON_INSTALL_DIR: path.join(dir, 'python'),
    UV_CACHE_DIR: path.join(dir, 'cache'),
  };
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
  // ponytail: install may outlive deactivate; globalStorage survives, next launch's find() picks it up. Add a disposed flag only if the orphan install writes break things.
  await client?.stop();
}
