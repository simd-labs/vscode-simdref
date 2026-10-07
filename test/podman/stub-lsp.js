#!/usr/bin/env node
// Minimal LSP server without inlayHintProvider (like simdref 0.0.7). Speaks stdio JSON-RPC.
// Installed as /usr/local/bin/simdref-lsp in image vsc-stub.
let buf = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const head = buf.indexOf('\r\n\r\n');
    if (head < 0) return;
    const len = Number(/^Content-Length: (\d+)/.exec(buf.subarray(0, head).toString())?.[1]);
    if (!Number.isFinite(len) || buf.length < head + 4 + len) return;
    const msg = JSON.parse(buf.subarray(head + 4, head + 4 + len).toString());
    buf = buf.subarray(head + 4 + len);
    if (msg.method === 'exit') process.exit(0);
    if (msg.id === undefined) continue; // notification: ignore
    const result = msg.method === 'initialize' ? { capabilities: {} } : null;
    const out = JSON.stringify({ jsonrpc: '2.0', id: msg.id, result });
    process.stdout.write(`Content-Length: ${Buffer.byteLength(out)}\r\n\r\n${out}`);
  }
});
