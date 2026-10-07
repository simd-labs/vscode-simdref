# Podman test rig

This rig runs the extension integration test in VS Code 1.140.0 in a rootless podman container.
The container starts Xvfb, so the host does not use a display. Do not send `DISPLAY` or `WAYLAND_DISPLAY` to the container.

## Files

- `Containerfile` has three targets. `clean` is image `vsc-clean` without `simdref-lsp`. `sim` is image `vsc-sim` with `simdref-lsp` from PyPI, or from a simdref source tree when `SIMDREF_SRC` is given. `stub` is image `vsc-stub` with a fake `simdref-lsp` that has no inlay hints.
- `run.sh MODE` makes the image for the mode, prepares the repository, and runs the test.

## Run

Run the script in any directory. It makes the image, runs `npm ci` and `npm run compile` in the container, and downloads VS Code into `.vscode-test/` (not in git).
Then it starts a long-running container with `Xvfb :99` and runs the test with `podman exec`.
The script removes the container at the end and exits with the exit code of the test.

```
test/podman/run.sh error
test/podman/run.sh nohints
test/podman/run.sh install
SIMDREF_CATALOG=/path/to/catalog.db test/podman/run.sh hints
SIMDREF_CATALOG=/path/to/catalog.db test/podman/run.sh lazystart
SIMDREF_SRC=/path/to/simdref SIMDREF_CATALOG=/path/to/catalog.db test/podman/run.sh hints
```

`SIMDREF_SRC` is a simdref source tree. Without it, the image uses simdref from PyPI.
`SIMDREF_CATALOG` is a `catalog.db` file. The script attaches it read-only. Make it with `isa update`, for example `~/.local/share/simdref/catalog.db`.

## Modes and success

Success is exit code 0 and no assertion error in the output.

| mode | image | network | what the test checks |
|------|-------|---------|----------------------|
| `hints` | `vsc-sim` | yes | `fixture.s` has hints on lines 0, 1 and 4. `fixture.cpp` has one hint on line 1. The `vaddps` hint contains `Add Packed`. |
| `lazystart` | `vsc-sim` | yes | A `.txt` file does not start the server. A `.s` file starts it, and the hints show. |
| `error` | `vsc-clean` | none | The install stops with the help text. A second file opens a second install step. |
| `nohints` | `vsc-stub` | yes | A stub simdref-lsp without inlay hints (like simdref 0.0.7) starts, and the extension shows a warning. |
| `install` | `vsc-clean` | yes | The extension downloads uv, installs simdref, runs `isa update` and starts the server. uv writes only to the extension storage. This mode downloads from GitHub and PyPI. |

The `hints` output shows lines like `fixture.s [[0,"..."],[1,"Add Packed ..."],[4,"..."]]`.

## Variables

`VSCODE_VERSION` selects a different VS Code version. More runs use the existing `node_modules/`, `out/` and `.vscode-test/` in the repository.

## Update the screenshots

To update the screenshots in the main README, replace the single commit on the `screenshots` branch. The branch has no parent. Push it with `--force`. Do not commit PNGs to `main`.
