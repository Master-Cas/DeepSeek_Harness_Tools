/**
 * End-to-end CLI tests: scan, generate (--no-translate), validate exit codes,
 * import and error handling. Exercises the real process entry point.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cli = path.join(root, 'tools', 'dsh-locale', 'index.mjs')
const fixture = path.join(root, 'tests', 'fixtures', 'harness')
const tmp = fs.mkdtempSync(path.join(root, '.tmp-locale-cli-'))

/** Run the CLI and return stdout/stderr/status. */
function run(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

try {
  // scan --json prints a machine-readable catalog.
  {
    const outcome = run(['scan', '--harness', fixture, '--json'])
    assert.equal(outcome.status, 0, outcome.stderr)
    const json = JSON.parse(outcome.stdout)
    assert.equal(Object.keys(json.namespaces).length, 4)
    assert.equal(json.stats.keys, 8)
    assert.equal(json.mode, 'source')
  }

  // scan autodetects a lightweight ~/.dsh fixture and parses it statically.
  {
    const installed = path.join(root, 'tests', 'fixtures', 'lightweight')
    const outcome = run(['scan', '--harness', installed, '--json'])
    assert.equal(outcome.status, 0, outcome.stderr)
    const json = JSON.parse(outcome.stdout)
    assert.equal(json.mode, 'installed')
    assert.equal(json.harnessVersion, '3.1.4-fixture')
    assert.equal(Object.keys(json.namespaces).length, 3)
    assert.equal(json.stats.keys, 8)
  }

  // --help documents both layouts.
  {
    const help = run(['--help'])
    assert.equal(help.status, 0)
    assert.ok(help.stdout.includes('source checkout or lightweight ~/.dsh'))
  }

  // --help and unknown commands.
  assert.equal(run(['--help']).status, 0)
  assert.equal(run(['nope']).status, 2)

  // scan --out writes the canonical catalog.
  const sourceFile = path.join(tmp, 'source-en.json')
  {
    const outcome = run(['scan', '--harness', fixture, '--out', sourceFile, '--summary'])
    assert.equal(outcome.status, 0, outcome.stderr)
    const catalog = JSON.parse(fs.readFileSync(sourceFile, 'utf8'))
    assert.equal(Object.keys(catalog.namespaces).length, 4)
  }

  // generate --no-translate produces an installable plugin.
  const pluginDir = path.join(tmp, 'deepseek-xx')
  const targetFile = path.join(tmp, 'xx.json')
  {
    const outcome = run([
      'generate',
      'xx',
      '--label',
      'Testish',
      '--harness',
      fixture,
      '--out',
      pluginDir,
      '--catalog-out',
      targetFile,
      '--no-translate',
    ])
    assert.equal(outcome.status, 0, outcome.stderr)
    for (const file of ['package.json', 'index.js', 'client.js', 'cordis.patch.yml']) {
      assert.ok(fs.existsSync(path.join(pluginDir, file)), `missing ${file}`)
    }
    assert.ok(fs.existsSync(targetFile))
  }

  // validate passes on the generated catalog and fails on a broken one.
  {
    const pass = run(['validate', '--source', sourceFile, '--target', targetFile])
    assert.equal(pass.status, 0, pass.stderr)
    assert.ok(pass.stdout.includes('PASS'))

    const broken = { ...JSON.parse(fs.readFileSync(targetFile, 'utf8')) }
    delete broken.namespaces.alpha
    const brokenFile = path.join(tmp, 'broken.json')
    fs.writeFileSync(brokenFile, JSON.stringify(broken, null, 2))
    const fail = run(['validate', '--source', sourceFile, '--target', brokenFile, '--json'])
    assert.equal(fail.status, 1)
    const report = JSON.parse(fail.stdout)
    assert.equal(report.pass, false)
  }

  // import the hand-maintained Spanish pack to its canonical catalog.
  {
    const esFile = path.join(tmp, 'es.json')
    const outcome = run([
      'import',
      path.join('plugins', 'deepseek-spanish', 'client.js'),
      '--locale',
      'es',
      '--label',
      'Español',
      '--out',
      esFile,
      '--json',
    ])
    assert.equal(outcome.status, 0, outcome.stderr)
    const summary = JSON.parse(outcome.stdout)
    assert.equal(summary.namespaces, 48)
    assert.equal(summary.keys, 1643)
    const catalog = JSON.parse(fs.readFileSync(esFile, 'utf8'))
    assert.equal(catalog.locale, 'es')
    assert.equal(catalog.namespaces['settings.locale']['language.title'], 'Idioma')
  }

  // Invalid identifiers and traversal fail before any output is written.
  {
    const escape = path.resolve(root, '..', `dsh-locale-escape-${process.pid}`)
    fs.rmSync(escape, { recursive: true, force: true })
    const badPath = run([
      'generate', 'xy', '--label', 'Test', '--harness', fixture, '--no-translate',
      '--out', escape, '--catalog-out', path.join(tmp, 'xy.json'),
    ])
    assert.equal(badPath.status, 1)
    assert.match(badPath.stderr, /escapes the repository root/)
    assert.equal(fs.existsSync(escape), false)

    const insidePlugin = path.join(tmp, 'should-not-be-written')
    const escapeCatalog = path.resolve(root, '..', `dsh-locale-catalog-escape-${process.pid}.json`)
    fs.rmSync(insidePlugin, { recursive: true, force: true })
    fs.rmSync(escapeCatalog, { force: true })
    const badCatalogPath = run([
      'generate', 'xy', '--label', 'Test', '--harness', fixture, '--no-translate',
      '--out', insidePlugin, '--catalog-out', escapeCatalog,
    ])
    assert.equal(badCatalogPath.status, 1)
    assert.match(badCatalogPath.stderr, /catalog output escapes the repository root/)
    assert.equal(fs.existsSync(insidePlugin), false, 'invalid catalog output must fail before plugin writes')
    assert.equal(fs.existsSync(escapeCatalog), false)

    for (const args of [
      ['generate', '../xy', '--label', 'Test', '--dry-run', '--harness', fixture],
      ['generate', 'xy', '--label', 'Test', '--dry-run', '--harness', fixture, '--name', 'Bad Name'],
      ['generate', 'xy', '--label', 'Test', '--dry-run', '--harness', fixture, '--id', 'bad\"id'],
      ['generate', 'xy', '--label', 'Test', '--dry-run', '--harness', fixture, '--version', '1.0'],
      ['generate', 'xy', '--label', 'Test', '--dry-run', '--harness', fixture, '--fallback', '../en'],
    ]) {
      assert.equal(run(args).status, 1, `expected failure for ${JSON.stringify(args)}`)
    }
  }

  // A symlink inside the repository cannot redirect generated output outside it.
  {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-locale-outside-'))
    const link = path.join(tmp, 'outside-link')
    try {
      fs.symlinkSync(outside, link, 'dir')
      const outcome = run([
        'generate', 'xy', '--label', 'Test', '--harness', fixture, '--no-translate',
        '--out', path.join(link, 'plugin'), '--catalog-out', path.join(tmp, 'xy-link.json'),
      ])
      assert.equal(outcome.status, 1)
      assert.match(outcome.stderr, /symbolic link/)
      assert.equal(fs.existsSync(path.join(outside, 'plugin')), false)
    } finally {
      fs.rmSync(link, { force: true })
      fs.rmSync(outside, { recursive: true, force: true })
    }
  }

  console.log('CLI tests: PASS')
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
