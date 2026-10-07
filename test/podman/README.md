# Podman test rig

This rig runs the extension integration test in VS Code 1.140.0 in rootless podman with Xvfb. Do not send `DISPLAY` or `WAYLAND_DISPLAY` to the container.

## Files

- `Containerfile` has three targets. `sim` (`vsc-sim`) has `simdref-lsp` from PyPI or from a tree in `SIMDREF_SRC`. `clean` (`vsc-clean`) is without it. `stub` (`vsc-stub`) has a fake `simdref-lsp` that has no inlay hints.
- `run.sh MODE` makes the image, prepares the repository, and runs the test.

## Run

The script compiles the extension, downloads VS Code into `.vscode-test/`, starts a container with `Xvfb :99`, and runs the test. The exit code is the exit code of the test.

```
test/podman/run.sh error
test/podman/run.sh nohints
test/podman/run.sh install
SIMDREF_CATALOG=/path/to/catalog.db test/podman/run.sh hints
SIMDREF_CATALOG=/path/to/catalog.db test/podman/run.sh lazystart
SIMDREF_SRC=/path/to/simdref SIMDREF_CATALOG=/path/to/catalog.db test/podman/run.sh hints
```

`SIMDREF_CATALOG` attaches a `catalog.db` read-only, for example `~/.local/share/simdref/catalog.db` from `isa update`.

## Modes

Success is exit code 0 and no assertion error. A `hints` line looks like `fixture.s [[0,"..."],[1,"Add Packed ..."],[4,"..."]]`.

| mode | image | network | what the test checks |
|------|-------|---------|----------------------|
| `hints` | `vsc-sim` | yes | `fixture.s` has hints on lines 0, 1 and 4. `fixture.cpp` has one hint on line 1. The `vaddps` hint contains `Add Packed`. |
| `lazystart` | `vsc-sim` | yes | A `.txt` file does not start the server. A `.s` file starts it. |
| `error` | `vsc-clean` | none | The install stops with the help text. |
| `nohints` | `vsc-stub` | yes | A stub simdref-lsp (like 0.0.7) starts, and the extension shows a warning. |
| `install` | `vsc-clean` | yes | The extension downloads uv, installs simdref, runs `isa update` and starts the server. |

## VS Code version

`VSCODE_VERSION` selects a different VS Code version.

## Update the screenshots

To update the screenshots in the main README, replace the single commit on the `screenshots` branch. Push it with `--force`. Do not commit PNGs to `main`.
