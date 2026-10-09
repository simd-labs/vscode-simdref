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
    const stamp = path.join(dir, 'last-update-check');
    const lock = path.join(dir, 'update.lock');
    let restarts = 0;
    const said: string[] = [];
    const call = () =>
      maybeUpgrade(dir, server, (m) => said.push(m), async () => {
        restarts++;
      });
    const lines = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []);
    return { dir, call, lines, stamp, lock, server, restarts: () => restarts, said };
  };

  // Positive control: the fake binaries exist and maybeUpgrade reaches them.
  {
    const t = setup('bump');
    await t.call();
    assert.ok(t.lines().length > 0, 'fake binaries were never called');
    assert.ok(t.lines().includes('uv tool upgrade simdref'), `no upgrade: ${t.lines()}`);
  }

  // Old stamp, version changes: upgrade, one catalog refresh, one restart, stamp written.
  {
    const t = setup('bump');
    await t.call();
    assert.ok(t.lines().includes('uv tool upgrade simdref'), `no upgrade: ${t.lines()}`);
    assert.strictEqual(t.lines().filter((l) => l === 'isa vaddps --short').length, 1, `refresh must run once: ${t.lines()}`);
    assert.strictEqual(t.restarts(), 1, 'restart must run once');
    assert.ok(fs.existsSync(t.stamp), 'stamp not written');
  }

  // Fresh stamp: skip everything.
  {
    const t = setup('bump');
    fs.writeFileSync(t.stamp, '');
    await t.call();
    assert.deepStrictEqual(t.lines(), [], `fresh stamp must skip: ${t.lines()}`);
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

  // uv fails (offline): the failure is logged via say, never thrown, no refresh, no restart.
  {
    const t = setup('fail');
    await t.call();
    assert.ok(t.said.some((m) => m.includes('auto-update failed')), `failure not logged: ${t.said}`);
    assert.ok(!t.lines().some((l) => l.startsWith('isa vaddps')), `failed upgrade must not refresh: ${t.lines()}`);
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
    assert.strictEqual(t.restarts(), 0, 'unreadable after-version must not restart');
  }

  // Unreadable before-version: upgrade and refresh still run; readable differing after restarts.
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
  }

  // Fresh update.lock: another window runs the check; nothing runs and the stamp is untouched.
  {
    const t = setup('bump');
    fs.writeFileSync(t.lock, '');
    await t.call();
    assert.deepStrictEqual(t.lines(), [], `fresh lock must skip: ${t.lines()}`);
    assert.ok(!fs.existsSync(t.stamp), 'fresh lock must not write the stamp');
    assert.ok(fs.existsSync(t.lock), 'a foreign fresh lock must remain');
  }

  // Stale update.lock (older than 30 min): taken over, upgrade runs.
  {
    const t = setup('bump');
    fs.writeFileSync(t.lock, '');
    const old = new Date(Date.now() - 31 * 60 * 1000);
    fs.utimesSync(t.lock, old, old);
    await t.call();
    assert.ok(t.lines().includes('uv tool upgrade simdref'), `stale lock must be taken over: ${t.lines()}`);
    assert.strictEqual(t.restarts(), 1);
    assert.ok(!fs.existsSync(t.lock), 'lock must be removed after the check');
  }

  // PATH install: no binary runs, no stamp, no restart.
  {
    const t = setup('bump');
    let restarts = 0;
    await maybeUpgrade(
      path.dirname(path.dirname(t.server)),
      '/usr/local/bin/simdref-lsp',
      () => {},
      async () => {
        restarts++;
      },
    );
    assert.deepStrictEqual(t.lines(), [], 'PATH install must not be upgraded');
    assert.ok(!fs.existsSync(t.stamp), 'PATH install must not write the stamp');
    assert.strictEqual(restarts, 0);
  }

  console.log('update.unit: ok');
}

if (require.main === module)
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
