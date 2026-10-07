# vscode-simdref

![simdref inlay hints in a .s file in VS Code](https://raw.githubusercontent.com/simd-labs/vscode-simdref/screenshots/vscode-asm.png)
![simdref inlay hints in a .cpp file in VS Code](https://raw.githubusercontent.com/simd-labs/vscode-simdref/screenshots/vscode-cpp.png)

This extension connects VS Code to `simdref-lsp`, the language server of [simdref](https://github.com/simd-labs/simdref).
It shows a short description of each instruction at the end of the line.
It shows hints in `.s`, `.S` and `.asm` files, and in `asm(...)` strings in C and C++ files.
The server also has hover text and code completion.

Hover on an instruction shows the full simdref page from the local catalog, without network access.

VS Code shows inlay hints (`editor.inlayHints.enabled`).
Inlay hints require simdref 0.0.8 or newer (on PyPI). The extension installs it.
VS Code cuts each hint at 43 characters (`editor.inlayHints.maximumLength`). The extension sets this default to `0` (no limit) for `plaintext`, `asm-intel-x86-generic`, `arm64`, `arm` and `riscv`, so a `.s` file gets the full hint. Other assembly ids keep the set value. Set the limit to `0` to see the full hint.
The extension runs with cpptools or clangd. The two servers answer for C and C++ files.

## Automatic install

At start, the extension looks for `simdref-lsp` in this sequence:

1. On `PATH`.
2. In the extension storage, from an earlier install.
3. If not found, the extension downloads `uv` into its storage. Then it runs `uv tool install simdref` and `isa update`.
   It shows a notification. Nothing goes outside the extension storage.

The extension checks the uv download against the .sha256 file from the same GitHub release. This detects a corrupt download, not a tampered release.

If all steps fail, the extension shows an error message with an `Open instructions` button.

## Manual install

```
uv tool install simdref
isa update
```

Then start VS Code again (the server opens the catalog only at start).
Or use `pip install simdref`. Then start VS Code again.
Instructions: https://github.com/simd-labs/simdref

## Development install

```
npm install
npm run compile
npx @vscode/vsce package
code --install-extension vscode-simdref-*.vsix
```

## License

GPL-3.0-or-later.
