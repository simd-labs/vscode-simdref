# vscode-simdref

![simdref inlay hints in a .s file in VS Code](https://raw.githubusercontent.com/simd-labs/vscode-simdref/screenshots/vscode-asm.png)
![simdref inlay hints in a .cpp file in VS Code](https://raw.githubusercontent.com/simd-labs/vscode-simdref/screenshots/vscode-cpp.png)

The extension connects VS Code to `simdref-lsp`, the language server of [simdref](https://github.com/simd-labs/simdref).
In `.s`, `.S`, `.asm` files and `asm(...)` strings in C/C++, it shows a one-line brief of each instruction inline.

Hover shows the full simdref page for an instruction from the local catalog.

The extension installs the newest simdref from PyPI.
VS Code cuts hints at 43 characters (`editor.inlayHints.maximumLength`).
The extension makes the limit `0` for assembly languages.
Set it to `0` for C/C++ and files without an assembly extension.
The extension runs with cpptools or clangd for C and C++ files.

## Automatic install

At start, the extension looks for `simdref-lsp` on `PATH`, then in the extension storage.
An old `simdref-lsp` on `PATH` has no inlay hints. Remove it.
If not found, the extension downloads `uv` into its storage, runs `uv tool install simdref` and `isa update`.
The extension checks the uv download against the release checksum.
All writes stay in the extension storage.
Once a day the extension upgrades simdref in the background. The new version is used after the editor reloads.

## Manual install

```
uv tool install simdref
isa update
```

Then start VS Code again (the server opens the catalog only at start).
Or `pip install simdref`, then start VS Code again.

## Development install

```
npm install
npm run compile
npx @vscode/vsce package
code --install-extension vscode-simdref-*.vsix
```

## License

GPL-3.0-or-later.
