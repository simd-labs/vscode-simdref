import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { exe } from './find';

const run = promisify(execFile);
const DAY_MS = 24 * 60 * 60 * 1000;

// Every uv write stays inside the extension storage: tools, python builds, cache.
export function uvEnv(dir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    UV_TOOL_DIR: path.join(dir, 'tools'),
    UV_TOOL_BIN_DIR: path.join(dir, 'bin'),
    UV_PYTHON_INSTALL_DIR: path.join(dir, 'python'),
    UV_CACHE_DIR: path.join(dir, 'cache'),
  };
}

// Upgrade the extension-installed simdref at most once a day, refresh the catalog when the version
// changed, then restart the language client. A server from PATH is never touched. Failures are
// logged, never shown; the stamp file limits retries to one per day.
export async function maybeUpgrade(
  dir: string,
  server: string,
  say: (m: string) => void,
  restart: () => Promise<void>,
): Promise<void> {
  const bin = path.join(dir, 'bin');
  if (path.dirname(server) !== bin) return;
  const stamp = path.join(dir, 'last-update-check');
  try {
    if (Date.now() - fs.statSync(stamp).mtimeMs < DAY_MS) return;
  } catch {
    // No stamp yet: first check.
  }
  fs.writeFileSync(stamp, '');
  try {
    const env = uvEnv(dir);
    const isa = path.join(bin, exe('isa'));
    const before = (await run(isa, ['--version'], { env })).stdout.trim();
    await run(path.join(dir, 'uv', exe('uv')), ['tool', 'upgrade', 'simdref'], { env });
    const after = (await run(isa, ['--version'], { env })).stdout.trim();
    if (before === after) return;
    // `isa vaddps --short` runs ensure_runtime(), which downloads the catalog only when the
    // installed version differs from the stamped one. An unchanged version downloads 0 bytes.
    await run(isa, ['vaddps', '--short'], { env });
    say(`simdref upgraded ${before} -> ${after}`);
    await restart();
  } catch (e) {
    say(`simdref auto-update failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
