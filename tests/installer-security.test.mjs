/** Safe M6 installer simulation: no git network, package publishing or real dsh. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pin = 'e6564b1ce42adae310b15372aaf980e4059eb389'
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-m6-installer-'))
try {
  const bin = path.join(tmp, 'bin')
  fs.mkdirSync(bin)
  const executable = (name, contents) => {
    const file = path.join(bin, name)
    fs.writeFileSync(file, '#!/bin/sh\nset -eu\n' + contents, { mode: 0o755 })
  }
  executable('git', `
if [ "$1" = "-C" ]; then
  root="$2"
  shift 2
  case "$1" in
    init) mkdir -p "$root/tools";;
    remote) :;;
    fetch)
      [ "$5" = "$MOCK_PIN" ] || exit 71
      ;;
    rev-parse) printf '%s\n' "$MOCK_PIN";;
    checkout)
      mkdir -p "$root/plugins/deepseek-spanish" "$root/plugins/deepseek-abyss-theme"
      ;;
    *) exit 72;;
  esac
else exit 73; fi
`)
  executable('pnpm', `
if [ "$1" = "pack" ]; then
  [ "$2" = "--pack-destination" ] || exit 74
  printf 'simulated bundle' > "$3/master-cas-sim-0.3.0.tgz"
elif [ "$1" = "dsh" ]; then
  printf 'dsh %s\n' "$*" >> "$MOCK_CALLS"
else exit 75; fi
`)
  executable('dsh', `printf 'dsh %s\\n' "$*" >> "$MOCK_CALLS"\n`)
  const home = path.join(tmp, 'home')
  fs.mkdirSync(home)
  const calls = path.join(tmp, 'calls')
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH,
    HOME: home, DSH_HOME: path.join(tmp, 'dsh'), DSH_PROFILE: 'web',
    MOCK_PIN: pin, MOCK_CALLS: calls }
  for (const name of ['install-spanish.sh', 'install-theme.sh']) {
    const script = path.join(root, 'installers', name)
    const invoke = (extra = {}, action = 'install') => spawnSync('bash', [script, action],
      { env: { ...env, ...extra }, encoding: 'utf8', timeout: 12000 })
    let result = invoke()
    assert.equal(result.status, 0, name + ': normal simulated install: ' + result.stderr)
    result = invoke()
    assert.equal(result.status, 0, name + ': idempotent re-install')
    result = invoke({}, '--uninstall')
    assert.equal(result.status, 0, name + ': simulated remove')
    result = invoke({ DSH_PROFILE: '../escape' })
    assert.notEqual(result.status, 0, name + ': invalid profile rejected')
    result = invoke({}, 'unexpected')
    assert.notEqual(result.status, 0, name + ': invalid action rejected')
    const bundle = path.join(env.DSH_HOME, 'community-bundles', 'master-cas-sim-0.3.0.tgz')
    fs.writeFileSync(bundle, 'changed historical content')
    result = invoke()
    assert.notEqual(result.status, 0, name + ': differing existing bundle rejected')
    fs.rmSync(bundle)
    const linked = path.join(tmp, 'link-target')
    fs.writeFileSync(linked, 'untouched')
    fs.symlinkSync(linked, bundle)
    result = invoke()
    assert.notEqual(result.status, 0, name + ': symlink bundle rejected')
    assert.equal(fs.readFileSync(linked, 'utf8'), 'untouched')
    fs.rmSync(bundle)
  }
  assert.match(fs.readFileSync(calls, 'utf8'), /plugin --profile web add/)
  assert.match(fs.readFileSync(calls, 'utf8'), /plugin --profile web remove/)
  console.log('M6 installer simulations: PASS (mock git, pack and dsh; no real installation)')
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
