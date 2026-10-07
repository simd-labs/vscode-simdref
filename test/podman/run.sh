#!/usr/bin/env bash
# Run one integration test mode in a rootless podman container under Xvfb.
# Usage: test/podman/run.sh hints|error|install|lazystart|nohints
# Env:   SIMDREF_CATALOG  catalog.db file, mounted read-only (modes hints and lazystart)
#        SIMDREF_SRC      simdref source tree, optional (modes hints and lazystart; without it, image vsc-sim gets simdref from PyPI)
#        VSCODE_VERSION   VS Code version (default 1.140.0)
set -euo pipefail
cd "$(dirname "$0")/../.."

mode=${1:?usage: run.sh hints|error|install|lazystart|nohints}
ver=${VSCODE_VERSION:-1.140.0}
exe=.vscode-test/vscode-linux-x64-$ver/code
low=(nice -n 19 ionice -c 3)
net=() mounts=()

case $mode in
  hints | lazystart) image=vsc-sim ;;
  nohints) image=vsc-stub ;;
  install) image=vsc-clean ;;
  error) image=vsc-clean net=(--network none) ;; # the extension must fail to download uv
  *) echo "unknown mode: $mode" >&2; exit 2 ;;
esac

# simdref from PyPI by default; pass SIMDREF_SRC to build vsc-sim from a source tree.
if [ "$image" = vsc-sim ]; then
  [ -r "${SIMDREF_CATALOG:-}" ] || { echo "set SIMDREF_CATALOG to a catalog.db file" >&2; exit 2; }
  # BuildKit has no optional build context: pass an empty dir when SIMDREF_SRC is unset.
  ctx=${SIMDREF_SRC:-}
  if [ -z "$ctx" ]; then ctx=$(mktemp -d); fi
  "${low[@]}" podman build --target sim --build-context "simdref=$ctx" -t vsc-sim test/podman
  mounts=(-v "$SIMDREF_CATALOG:/home/node/.local/share/simdref/catalog.db:ro")
else
  target=${image#vsc-}
  "${low[@]}" podman build --target "$target" -t "$image" test/podman
fi

# keep-id maps the host user to the container user node (uid 1000), so node can write the repo mount.
run=(podman run --userns=keep-id:uid=1000,gid=1000 -v "$PWD:/ext")

# Step 1, with network: install dependencies, compile, download VS Code into .vscode-test/.
"${low[@]}" "${run[@]}" --rm "$image" sh -c "
  [ -d node_modules ] || npm ci
  npm run compile
  [ -x $exe ] || node -e \"require('@vscode/test-electron').downloadAndUnzipVSCode({version:'$ver',cachePath:'.vscode-test'})\""

# Step 2: long-running container with Xvfb, then the test through podman exec.
name=vsc-$mode-$$
trap 'podman rm -f "$name" >/dev/null 2>&1 || true' EXIT
"${low[@]}" "${run[@]}" -d --name "$name" "${net[@]}" "${mounts[@]}" "$image" \
  sh -c 'Xvfb :99 -screen 0 1280x1024x24 & sleep infinity' >/dev/null
sleep 2
podman exec -e DISPLAY=:99 -e SIMDREF_MODE="$mode" -e VSCODE_EXE="/ext/$exe" "$name" node out/test/runTest.js
