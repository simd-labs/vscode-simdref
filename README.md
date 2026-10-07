# vscode-simdref

![simdref inlay hints in a .s file in VS Code](docs/vscode-asm.png)
![simdref inlay hints in a .cpp file in VS Code](docs/vscode-cpp.png)

This extension connects VS Code to `simdref-lsp`, the language server of [simdref](https://github.com/simd-labs/simdref).
It shows a short description of each instruction at the end of the line. It works in `.s`, `.S` and `.asm` files, and in `asm(...)` strings in C and C++ files.
The server also gives hover text and completion.

VS Code shows inlay hints by default (`editor.inlayHints.enabled`).
Inlay hints need simdref 0.0.8 or newer (on PyPI). The extension installs it for you.
VS Code cuts hints at 43 characters for each line (`editor.inlayHints.maximumLength`). The extension sets this limit to `0` (no limit) for assembly files. In C and C++ files, VS Code keeps your own value; set the limit to `0` there if a hint ends in `…`.
The extension runs next to cpptools or clangd. Both servers answer for C and C++ files.

## Automatic install

At start, the extension looks for `simdref-lsp` in this order:

1. On `PATH`.
2. In the extension storage, from an earlier install.
3. If not found, the extension downloads `uv` into its storage. Then it runs `uv tool install simdref` and `isa update`.
   It shows a progress notification. Nothing is installed outside the extension storage.

The extension checks the uv download against the .sha256 file from the same GitHub release. This detects a corrupt download, not a tampered release.

If all steps fail, the extension shows an error message with an `Open instructions` button.

## Manual install

```
uv tool install simdref
isa update
```

Then restart VS Code (the server opens the catalog only at start).
You can use `pip install simdref` instead of `uv`. Then restart VS Code.
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
