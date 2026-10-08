import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { maybeUpgrade } from '../src/update';

// Drives the real maybeUpgrade() with fake uv/isa binaries that log their argv to $LOG.
// Runs under plain node: `node out/test/update.unit.js`. Also called from suite.ts.
export async function run(): Promise<void> {
  const sh = (s: string) => `#!/bin/sh\n${s}\n`;

  const setup = (uv: 'bump' | 'same' | 'fail') => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simdref-upd-'));
    fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'uv'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'version'), '0.0.11');
    const write = (p: string, text: string) => fs.writeFileSync(p, sh(text), { mode: 0o755 });
    write(path.join(dir, 'bin', 'isa'), `
echo "isa $*" >> "$LOG"
if [ "$1" = "--version" ]; then cat "$DIR/version"; fi`);
    write(
      path.join(dir, 'uv', 'uv'),
      uv === 'bump'
        ? `
echo "uv $*" >> "$LOG"
if [ "$1 $2 $3" = "tool upgrade simdref" ]; then echo 0.0.12 > "$DIR/version"; fi`
        : uv === 'same'
          ? 'echo "uv $*" >> "$LOG"'
          : 'echo "uv $*" >> "$LOG"; exit 1',
    );
    const log = path.join(dir, 'calls.log');
    process.env.LOG = log;
    process.env.DIR = dir;
    const server = path.join(dir, 'bin', 'simdref-lsp');
    const stamp = path.join(dir, 'last-update-check');
    let restarts = 0;
    const said: string[] = [];
    const call = () =>
      maybeUpgrade(dir, server, (m) => said.push(m), async () => {
        restarts++;
      });
    const lines = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []);
    return { call, lines, stamp, server, restarts: () => restarts, said };
  };

  // Positive control: the fake binaries exist and maybeUpgrade reaches them.
  {
    const t = setup('bump');
    await t.call();
    assert.ok(t.lines().length > 0, 'fake binaries were never called');
    assert.ok(t.lines().includes('uv tool upgrade simdref'), `no upgrade: ${t.lines()}`);
  }

  // Old stamp, version changes: one catalog refresh, one restart, stamp written.
  {
    const t = setup('bump');
    await t.call();
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

  // Unchanged version: upgrade runs, no refresh, no restart.
  {
    const t = setup('same');
    await t.call();
    assert.ok(t.lines().includes('uv tool upgrade simdref'), `no upgrade: ${t.lines()}`);
    assert.ok(!t.lines().some((l) => l.startsWith('isa vaddps')), `unchanged version must not refresh: ${t.lines()}`);
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
