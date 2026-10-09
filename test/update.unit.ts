import * as assert from 'assert';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { maybeUpgrade } from '../src/update';

// Drives the real maybeUpgrade() with fake uv/isa binaries that log their argv to $LOG.
// Runs under plain node: `node out/test/update.unit.js`. Also called from suite.ts.
export async function run(): Promise<void> {
  if (process.platform === 'win32') {
    console.log('update.unit: skipped on win32 (fixtures are POSIX shell scripts)');
    return;
  }
  const sh = (s: string) => `#!/bin/sh\n${s}\n`;

  const setup = (uv: 'bump' | 'same' | 'fail' | 'postfail') => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simdref-upd-'));
    fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'uv'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'version'), '0.0.11');
    const scripts: string[] = [];
    const write = (p: string, body: string) => {
      const text = sh(body);
      scripts.push(p);
      fs.writeFileSync(p, text, { mode: 0o755 });
    };
    write(
      path.join(dir, 'bin', 'isa'),
      `
echo "isa $*" >> "$LOG"
if [ "$1" = "--version" ]; then
  if [ "${uv === 'postfail' ? '1' : '0'}" = "1" ] && [ -f "$DIR/upgraded" ]; then
    rm "$DIR/upgraded"; exit 1
  fi
  cat "$DIR/version"
fi`,
    );
    const bump = uv === 'same' ? ':' : 'echo 0.0.12 > "$DIR/version"';
    const mark = uv === 'postfail' ? 'touch "$DIR/upgraded"' : ':';
    const uvBody =
      uv === 'fail'
        ? `
echo "uv $*" >> "$LOG"
exit 1`
        : `
echo "uv $*" >> "$LOG"
if [ "$1 $2 $3" = "tool upgrade simdref" ]; then
  ${bump}
  ${mark}
fi`;
    write(path.join(dir, 'uv', 'uv'), uvBody);
    for (const s of scripts) {
      const r = cp.spawnSync('bash', ['-n', s], { encoding: 'utf8' });
      assert.strictEqual(r.status, 0, `fixture ${s} fails bash -n: ${r.stderr}`);
    }
    const log = path.join(dir, 'calls.log');
    process.env.LOG = log;
    process.env.DIR = dir;
    const server = path.join(dir, 'bin', 'simdref-lsp');
    const day = Math.floor(Date.now() / 1000 / 86400);
    const marker = path.join(dir, `update-${day}`);
    let restarts = 0;
    const said: string[] = [];
    const call = () =>
      maybeUpgrade(dir, server, (m) => said.push(m), async () => {
        restarts++;
      });
    const lines = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []);
    return { dir, call, lines, marker, server, restarts: () => restarts, said };
  };

  // No marker: runs, creates today's marker, removes yesterday's.
  {
    const t = setup('bump');
    const yesterday = Math.floor(Date.now() / 1000 / 86400) - 1;
    const old = path.join(t.dir, `update-${yesterday}`);
    fs.writeFileSync(old, '');
    await t.call();
    assert.ok(fs.existsSync(t.marker), `today's marker not created`);
    assert.ok(!fs.existsSync(old), `yesterday's marker not removed`);
  }

  // Today's marker exists: skip everything.
  {
    const t = setup('bump');
    fs.writeFileSync(t.marker, '');
    await t.call();
    assert.deepStrictEqual(t.lines(), [], `today's marker must skip: ${t.lines()}`);
  }

  // Old marker, version changes: upgrade, one catalog refresh, one restart.
  {
    const t = setup('bump');
    await t.call();
    assert.strictEqual(t.lines().filter((l) => l === 'isa vaddps --short').length, 1, `refresh must run once: ${t.lines()}`);
    assert.strictEqual(t.restarts(), 1, 'restart must run once');
    assert.ok(fs.existsSync(t.marker), 'marker not written');
  }

  // Unchanged version: upgrade and refresh run once, no restart.
  {
    const t = setup('same');
    await t.call();
    assert.ok(t.lines().includes('uv tool upgrade simdref'), `no upgrade: ${t.lines()}`);
    assert.strictEqual(
      t.lines().filter((l) => l === 'isa vaddps --short').length,
      1,
      `unchanged version must refresh once: ${t.lines()}`,
    );
    assert.strictEqual(t.restarts(), 0, 'unchanged version must not restart');
  }

  // uv fails (offline): the failure is logged via say, never thrown, the refresh still runs, no restart.
  {
    const t = setup('fail');
    await t.call();
    assert.ok(t.said.some((m) => m.includes('upgrade failed')), `failure not logged: ${t.said}`);
    assert.strictEqual(
      t.lines().filter((l) => l === 'isa vaddps --short').length,
      1,
      `failed upgrade must still refresh once: ${t.lines()}`,
    );
    assert.strictEqual(t.restarts(), 0);
  }

  // isa --version fails after the upgrade: refresh already ran, no restart, failure logged.
  {
    const t = setup('postfail');
    await t.call();
    assert.ok(
      t.said.some((m) => m.includes('version check failed after upgrade')),
      `post-upgrade version failure not logged: ${t.said}`,
    );
    assert.strictEqual(
      t.lines().filter((l) => l === 'isa vaddps --short').length,
      1,
      `refresh must have run once: ${t.lines()}`,
    );
    assert.strictEqual(t.restarts(), 0, 'unreadable after-version must not restart');
  }

  // Unreadable before-version: upgrade and refresh still run; after is also unreadable here, so no restart.
  {
    const t = setup('postfail');
    fs.writeFileSync(path.join(t.dir, 'upgraded'), '');
    await t.call();
    assert.ok(
      t.said.some((m) => m.includes('version check failed before upgrade')),
      `pre-upgrade version failure not logged: ${t.said}`,
    );
    assert.strictEqual(
      t.lines().filter((l) => l === 'isa vaddps --short').length,
      1,
      `refresh must still run: ${t.lines()}`,
    );
    assert.strictEqual(t.restarts(), 0, 'no restart while versions are unreadable');
  }

  // Refresh fails after a version change: the restart still happens once.
  {
    const t = setup('bump');
    fs.writeFileSync(
      path.join(t.dir, 'bin', 'isa'),
      sh(`
echo "isa $*" >> "$LOG"
if [ "$1" = "--version" ]; then
  cat "$DIR/version"
fi
if [ "$1" = "vaddps" ]; then
  exit 1
fi`),
      { mode: 0o755 },
    );
    await t.call();
    assert.strictEqual(
      t.lines().filter((l) => l === 'isa vaddps --short').length,
      1,
      `refresh must run once: ${t.lines()}`,
    );
    assert.strictEqual(t.restarts(), 1, 'refresh failure must not skip the restart');
  }

  // A restart that rejects after a version change: maybeUpgrade resolves, the failure is logged.
  {
    const t = setup('bump');
    let restarts = 0;
    const boom = new Error('boom');
    let escaped: unknown = null;
    try {
      await maybeUpgrade(t.dir, t.server, (m) => t.said.push(m), async () => {
        restarts++;
        throw boom;
      });
    } catch (e) {
      escaped = e;
    }
    assert.strictEqual(escaped, null, 'maybeUpgrade must never reject on restart failure');
    assert.strictEqual(restarts, 1, 'restart must have run once');
    assert.ok(
      t.said.some((m) => m.includes('restart failed') && m.includes('boom')),
      `restart failure not logged: ${t.said}`,
    );
  }

  // PATH install: no binary runs, no marker, no restart.
  {
    const t = setup('bump');
    let restarts = 0;
    await maybeUpgrade(
      t.dir,
      '/usr/local/bin/simdref-lsp',
      () => {},
      async () => {
        restarts++;
      },
    );
    assert.deepStrictEqual(t.lines(), [], 'PATH install must not be upgraded');
    assert.ok(!fs.existsSync(t.marker), 'PATH install must not write the marker');
    assert.strictEqual(restarts, 0);
  }

  console.log('update.unit: ok');
}

if (require.main === module)
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
