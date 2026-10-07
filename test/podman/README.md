# Podman test rig

This rig runs the extension integration test in VS Code 1.140.0 inside a rootless podman container.
The container starts Xvfb, so the host needs no display. Do not pass `DISPLAY` or `WAYLAND_DISPLAY` to the container.

## Files

- `Containerfile` has three targets. `clean` is image `vsc-clean` without `simdref-lsp`. `sim` is image `vsc-sim` with `simdref-lsp` installed from a simdref source tree. `stub` is image `vsc-stub` with a fake `simdref-lsp` that has no inlay hints.
- `run.sh MODE` builds the image for the mode, prepares the repository, and runs the test.

## Run

Run the script from any directory. It builds the image, runs `npm ci` and `npm run compile` in the container, and downloads VS Code into `.vscode-test/` (not tracked).
Then it starts a long-running container with `Xvfb :99` and runs the test with `podman exec`.
The script removes the container at the end and exits with the exit code of the test.

```
test/podman/run.sh error
test/podman/run.sh nohints
test/podman/run.sh install
SIMDREF_SRC=/path/to/simdref SIMDREF_CATALOG=/path/to/catalog.db test/podman/run.sh hints
SIMDREF_SRC=/path/to/simdref SIMDREF_CATALOG=/path/to/catalog.db test/podman/run.sh lazystart
```

`SIMDREF_SRC` is a simdref source tree that has inlay hints (simdref 0.0.8 or newer).
`SIMDREF_CATALOG` is a `catalog.db` file. The script mounts it read-only. Create it with `isa update`, for example `~/.local/share/simdref/catalog.db`.

## Modes and success

Success is exit code 0 and no assertion error in the output.

| mode | image | network | what the test checks |
|------|-------|---------|----------------------|
| `hints` | `vsc-sim` | yes | `fixture.s` has hints on lines 0, 1 and 4. `fixture.cpp` has one hint on line 1. The `vaddps` hint contains `Add Packed`. |
| `lazystart` | `vsc-sim` | yes | A `.txt` file does not start the server. Opening a `.s` file starts it, and the hints appear. |
| `error` | `vsc-clean` | none | The install fails with the help text. A second matching file starts a second install attempt. |
| `nohints` | `vsc-stub` | yes | A stub simdref-lsp without inlay hints (like simdref 0.0.7) starts, and the extension logs a warning. |
| `install` | `vsc-clean` | yes | The extension downloads uv, installs simdref, runs `isa update` and starts the server. uv writes only to the extension storage. This mode downloads from GitHub and PyPI. |

The `hints` log shows lines like `fixture.s [[0,"..."],[1,"Add Packed ..."],[4,"..."]]`.

## Options

`VSCODE_VERSION` selects another VS Code version. Repeat runs reuse `node_modules/`, `out/` and `.vscode-test/` in the repository.
