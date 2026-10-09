import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { exe } from './find';

const run = promisify(execFile);
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

// Upgrade the extension-installed simdref once a day. Then refresh the catalog
// with `isa vaddps --short` (0.4 s and 0 bytes when current) on every check,
// also after a failed upgrade. A server from PATH is never touched. Failures
// are logged, never shown. A new simdref version takes effect at the next
// server start. The day marker update-DAY (DAY = Unix seconds / 86400) limits
// this to one run a day across all windows: an existing marker ends the check.
// shortcut: a check still running at midnight UTC can overlap the next day's
// check, add an OS lock if that is ever reported.
export async function maybeUpgrade(dir: string, server: string, say: (m: string) => void): Promise<void> {
  const bin = path.join(dir, 'bin');
  if (path.dirname(server) !== bin) return;
  const day = Math.floor(Date.now() / 1000 / 86400);
  const marker = path.join(dir, `update-${day}`);
  try {
    fs.writeFileSync(marker, '', { flag: 'wx' });
  } catch {
    return; // Another window or an earlier run already did today's check.
  }
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith('update-') && f !== `update-${day}`) {
      try {
        fs.rmSync(path.join(dir, f), { force: true });
      } catch {}
    }
  }
  const env = uvEnv(dir);
  try {
    await run(path.join(dir, 'uv', exe('uv')), ['tool', 'upgrade', 'simdref'], { env, timeout: TIMEOUT_MS });
  } catch (e) {
    say(`simdref upgrade failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Downloads the catalog after a version change. Runs on every check: an unchanged catalog costs 0.4 s, 0 bytes.
  try {
    await run(path.join(bin, exe('isa')), ['vaddps', '--short'], { env, timeout: TIMEOUT_MS });
  } catch (e) {
    say(`simdref catalog refresh failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
