#!/usr/bin/env bash
set -euo pipefail

PROFILE="${DSH_PROFILE:-web}"
REPO_URL="https://github.com/Master-Cas/DeepSeek_Harness_Tools.git"
PACKAGE_NAME="@master-cas/deepseek-abyss-theme"
PACKAGE_DIR="plugins/deepseek-abyss-theme"
ACTION="${1:-install}"

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

git clone --quiet --depth=1 "$REPO_URL" "$TMP/tools"
PKG="$TMP/tools/$PACKAGE_DIR"
pack_plugin "$PKG" "$TMP"

TARBALL="$(find "$TMP" -maxdepth 1 -type f -name '*.tgz' -print -quit)"
if [[ -z "$TARBALL" ]]; then
  echo "ERROR: no se generó el paquete .tgz." >&2
  exit 1
fi

echo "Installing Abyss Theme into profile '$PROFILE'..."
run_dsh plugin --profile "$PROFILE" add "$TARBALL"

echo
echo "Abyss Theme installed."
echo "Restart/reload the Harness profile if it does not use HMR."
