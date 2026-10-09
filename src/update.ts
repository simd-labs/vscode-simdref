import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { exe } from './find';

const run = promisify(execFile);
const DAY_MS = 24 * 60 * 60 * 1000;
const LOCK_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 10 * 60 * 1000;

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

// Upgrade the extension-installed simdref once a day, refresh the catalog with
// `isa vaddps --short` (0.4 s and 0 bytes when current), then restart the language client only
// when the version changed. A server from PATH is never touched. Failures are logged, never
// shown; the stamp file limits retries to one per day. update.lock serializes concurrent
// windows; a lock older than 30 min is stale and is taken over.
export async function maybeUpgrade(
  dir: string,
  server: string,
  say: (m: string) => void,
  restart: () => Promise<void>,
): Promise<void> {
  const bin = path.join(dir, 'bin');
  if (path.dirname(server) !== bin) return;
  const lock = path.join(dir, 'update.lock');
  try {
    fs.writeFileSync(lock, '', { flag: 'wx' });
  } catch {
    try {
      if (Date.now() - fs.statSync(lock).mtimeMs < LOCK_MS) return;
      fs.rmSync(lock, { force: true });
      fs.writeFileSync(lock, '', { flag: 'wx' });
    } catch {
      return;
    }
  }
  try {
    const stamp = path.join(dir, 'last-update-check');
    try {
      if (Date.now() - fs.statSync(stamp).mtimeMs < DAY_MS) return;
    } catch {
      // No stamp yet: first check.
    }
    fs.writeFileSync(stamp, '');
    const env = uvEnv(dir);
    const isa = path.join(bin, exe('isa'));
    let before: string | null = null;
    try {
      before = (await run(isa, ['--version'], { env, timeout: TIMEOUT_MS })).stdout.trim();
    } catch (e) {
      say(`simdref version check failed before upgrade: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      await run(path.join(dir, 'uv', exe('uv')), ['tool', 'upgrade', 'simdref'], { env, timeout: TIMEOUT_MS });
    } catch (e) {
      say(`simdref upgrade failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    // Downloads the catalog after a version change. Runs on every check: an unchanged catalog costs 0.4 s, 0 bytes.
    await run(isa, ['vaddps', '--short'], { env, timeout: TIMEOUT_MS });
    let after: string | null = null;
    try {
      after = (await run(isa, ['--version'], { env, timeout: TIMEOUT_MS })).stdout.trim();
    } catch (e) {
      say(`simdref version check failed after upgrade: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (after === null || after === before) return;
    say(`simdref upgraded ${before} -> ${after}`);
    await restart();
  } catch (e) {
    say(`simdref auto-update failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    fs.rmSync(lock, { force: true });
  }
}
