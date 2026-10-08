#!/usr/bin/env bash
set -euo pipefail

PROFILE="${DSH_PROFILE:-web}"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
REPO_URL="https://github.com/Master-Cas/DeepSeek_Harness_Tools.git"
# Immutable source revision for the v0.3.0 plugin packages.
REPO_COMMIT="e6564b1ce42adae310b15372aaf980e4059eb389"
PACKAGE_NAME="@master-cas/deepseek-abyss-theme"
PACKAGE_DIR="plugins/deepseek-abyss-theme"
ACTION="${1:-install}"
if [[ "$ACTION" != "install" && "$ACTION" != "--uninstall" ]]; then
  echo "ERROR: action must be install or --uninstall" >&2
  exit 2
fi
if [[ ! "$PROFILE" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]]; then
  echo "ERROR: invalid DSH_PROFILE" >&2
  exit 2
fi
CACHE_DIR="$DSH_HOME_DIR/community-bundles"

run_dsh() {
  if command -v dsh >/dev/null 2>&1; then
    dsh "$@"
    return
  fi

  local root="${DSH_ROOT:-}"
  if [[ -z "$root" && -f "$HOME/deepseek-harness/package.json" ]]; then
    root="$HOME/deepseek-harness"
  fi
  if [[ -z "$root" && -f "/home/ubuntu/deepseek-harness/package.json" ]]; then
    root="/home/ubuntu/deepseek-harness"
  fi

  if [[ -n "$root" && -f "$root/package.json" ]] && command -v pnpm >/dev/null 2>&1; then
    (cd "$root" && pnpm dsh "$@")
    return
  fi

  echo "ERROR: no encontré el CLI dsh ni un checkout utilizable de DeepSeek Harness." >&2
  echo "Define DSH_ROOT=/ruta/a/deepseek-harness o instala el CLI dsh." >&2
  exit 1
}

pack_plugin() {
  local pkg="$1"
  local out="$2"
  if command -v pnpm >/dev/null 2>&1; then
    (cd "$pkg" && pnpm pack --pack-destination "$out" >/dev/null)
  elif command -v npm >/dev/null 2>&1; then
    (cd "$pkg" && npm pack --pack-destination "$out" >/dev/null)
  else
    echo "ERROR: necesito pnpm o npm para crear el paquete instalable." >&2
    exit 1
  fi
}

if [[ "$ACTION" == "--uninstall" ]]; then
  echo "Removing $PACKAGE_NAME from profile '$PROFILE'..."
  run_dsh plugin --profile "$PROFILE" remove "$PACKAGE_NAME"
  echo "Abyss Theme removed."
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git -C "$TMP" init -q tools
git -C "$TMP/tools" remote add origin "$REPO_URL"
git -C "$TMP/tools" fetch -q --depth=1 origin "$REPO_COMMIT"
test "$(git -C "$TMP/tools" rev-parse FETCH_HEAD)" = "$REPO_COMMIT" || {
  echo "ERROR: fetched commit does not match pin" >&2
  exit 1
}
git -C "$TMP/tools" checkout -q --detach "$REPO_COMMIT"
PKG="$TMP/tools/$PACKAGE_DIR"
pack_plugin "$PKG" "$TMP"

TARBALL="$(find "$TMP" -maxdepth 1 -type f -name '*.tgz' -print -quit)"
if [[ -z "$TARBALL" ]]; then
  echo "ERROR: no se generó el paquete .tgz." >&2
  exit 1
fi

# Never overwrite a pre-existing bundle or traverse a symlinked cache path.
if [[ -L "$CACHE_DIR" ]]; then
  echo "ERROR: refusing symlinked bundle cache" >&2
  exit 1
fi
mkdir -p -m 700 "$CACHE_DIR"
if [[ ! -d "$CACHE_DIR" || -L "$CACHE_DIR" ]]; then
  echo "ERROR: unsafe bundle cache" >&2
  exit 1
fi
PERSISTENT_TARBALL="$CACHE_DIR/$(basename "$TARBALL")"
if [[ -e "$PERSISTENT_TARBALL" || -L "$PERSISTENT_TARBALL" ]]; then
  if [[ ! -f "$PERSISTENT_TARBALL" || -L "$PERSISTENT_TARBALL" ]] || ! cmp -s "$TARBALL" "$PERSISTENT_TARBALL"; then
    echo "ERROR: an existing bundle differs; refusing to overwrite" >&2
    exit 1
  fi
else
  (umask 077; cp -n "$TARBALL" "$PERSISTENT_TARBALL")
fi

echo "Installing Abyss Theme into profile '$PROFILE'..."
run_dsh plugin --profile "$PROFILE" add "$PERSISTENT_TARBALL"

echo
echo "Abyss Theme installed."

echo "Restart/reload the Harness profile if it does not use HMR."
