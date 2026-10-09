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

  const setup = (uv: 'ok' | 'fail') => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simdref-upd-'));
    fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'uv'), { recursive: true });
    const scripts: string[] = [];
    const write = (p: string, body: string) => {
      const text = sh(body);
      scripts.push(p);
      fs.writeFileSync(p, text, { mode: 0o755 });
    };
    write(path.join(dir, 'bin', 'isa'), `echo "isa $*" >> "$LOG"`);
    write(path.join(dir, 'uv', 'uv'), `echo "uv $*" >> "$LOG"${uv === 'fail' ? '\nexit 1' : ''}`);
    for (const s of scripts) {
      const r = cp.spawnSync('bash', ['-n', s], { encoding: 'utf8' });
      assert.strictEqual(r.status, 0, `fixture ${s} fails bash -n: ${r.stderr}`);
    }
    const log = path.join(dir, 'calls.log');
    process.env.LOG = log;
    const server = path.join(dir, 'bin', 'simdref-lsp');
    const day = Math.floor(Date.now() / 1000 / 86400);
    const marker = path.join(dir, `update-${day}`);
    const said: string[] = [];
    const call = () => maybeUpgrade(dir, server, (m) => said.push(m));
    const lines = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []);
    return { dir, call, lines, marker, server, said };
  };

  // No marker: upgrade runs, then one catalog refresh; today's marker is created, yesterday's removed.
  {
    const t = setup('ok');
    const yesterday = Math.floor(Date.now() / 1000 / 86400) - 1;
    const old = path.join(t.dir, `update-${yesterday}`);
    fs.writeFileSync(old, '');
    await t.call();
    assert.ok(t.lines().includes('uv tool upgrade simdref'), `no upgrade: ${t.lines()}`);
    assert.strictEqual(
      t.lines().filter((l) => l === 'isa vaddps --short').length,
      1,
      `refresh must run once: ${t.lines()}`,
    );
    assert.ok(fs.existsSync(t.marker), `today's marker not created`);
    assert.ok(!fs.existsSync(old), `yesterday's marker not removed`);
  }

  // Today's marker exists: skip everything.
  {
    const t = setup('ok');
    fs.writeFileSync(t.marker, '');
    await t.call();
    assert.deepStrictEqual(t.lines(), [], `today's marker must skip: ${t.lines()}`);
  }

  // uv fails (offline): the failure is logged, never thrown, the refresh still runs.
  {
    const t = setup('fail');
    let escaped: unknown = null;
    try {
      await t.call();
    } catch (e) {
      escaped = e;
    }
    assert.strictEqual(escaped, null, 'maybeUpgrade must never reject on upgrade failure');
    assert.ok(t.said.some((m) => m.includes('upgrade failed')), `failure not logged: ${t.said}`);
    assert.strictEqual(
      t.lines().filter((l) => l === 'isa vaddps --short').length,
      1,
      `failed upgrade must still refresh once: ${t.lines()}`,
    );
  }

  // The refresh fails: the failure is logged, maybeUpgrade resolves.
  {
    const t = setup('ok');
    fs.writeFileSync(path.join(t.dir, 'bin', 'isa'), sh('echo "isa $*" >> "$LOG"\nexit 1'), { mode: 0o755 });
    let escaped: unknown = null;
    try {
      await t.call();
    } catch (e) {
      escaped = e;
    }
    assert.strictEqual(escaped, null, 'maybeUpgrade must never reject on refresh failure');
    assert.ok(t.said.some((m) => m.includes('catalog refresh failed')), `refresh failure not logged: ${t.said}`);
  }

  // PATH install: no binary runs, no marker.
  {
    const t = setup('ok');
    await maybeUpgrade(t.dir, '/usr/local/bin/simdref-lsp', () => {});
    assert.deepStrictEqual(t.lines(), [], 'PATH install must not be upgraded');
    assert.ok(!fs.existsSync(t.marker), 'PATH install must not write the marker');
  }

  console.log('update.unit: ok');
}

if (require.main === module)
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
