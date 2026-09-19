/**
 * Generation and update tests with in-memory catalogs and a stub translator.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { catalogFromPlugin, loadCatalog, writeCatalog } from '../tools/lib/catalog.mjs'
import {
  buildPluginFiles,
  generateLanguagePack,
  planTranslationMemory,
} from '../tools/lib/generate.mjs'
import { diffCatalog, updateLanguagePack } from '../tools/lib/update.mjs'

const source = {
  version: 1,
  locale: 'en',
  namespaces: {
    a: { k1: 'Hello {n}', k2: 'Bye' },
    b: { z: 'Zed' },
  },
}
const existing = {
  version: 1,
  locale: 'xx',
  label: 'Test',
  namespaces: { a: { k1: 'Hola {n}' } },
}

// Translation memory reuses valid entries and re-plans placeholder-broken ones.
{
  const plan = planTranslationMemory(source, existing)
  assert.equal(plan.reused.a.k1, 'Hola {n}')
  assert.deepEqual(plan.pending.map((entry) => `${entry.namespace}.${entry.key}`).sort(), ['a.k2', 'b.z'])
}
{
  const broken = { namespaces: { a: { k1: 'Hola' } } }
  const plan = planTranslationMemory(source, broken)
  assert.equal(plan.reused.a?.k1, undefined)
  assert.ok(plan.pending.some((entry) => entry.key === 'k1'))
}

// buildPluginFiles emits a loadable Harness bundle.
{
  const files = buildPluginFiles({
    name: 'deepseek-xx',
    id: '@master-cas/deepseek-xx',
    version: '0.1.0',
    description: 'Test pack',
    locale: 'xx',
    label: 'Testish',
    fallback: 'en',
    namespaces: { a: { k1: 'Hola {n}' } },
  })
  assert.ok(files['client.js'].includes('addLanguage'))
  assert.ok(files['client.js'].includes("id: 'xx'"))
  assert.ok(files['client.js'].includes('"a"'))
  const pkg = JSON.parse(files['package.json'])
  assert.equal(pkg.name, 'deepseek-xx')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(files['cordis.patch.yml'].includes(pkg.name))
}

// Full generation with a stub translator writes catalog and plugin.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-locale-gen-'))
{
  const seen = []
  const translate = async (entries) => {
    seen.push(...entries.map((entry) => entry.id))
    return new Map(entries.map((entry) => [entry.id, `[xx] ${entry.text}`]))
  }
  const result = await generateLanguagePack({
    source,
    existing,
    locale: 'xx',
    label: 'Testish',
    noTranslate: false,
    dryRun: false,
    translate,
    plugin: { name: 'deepseek-xx', id: '@master-cas/deepseek-xx', version: '0.1.0', description: 'Test pack', dir: path.join(dir, 'plugin') },
    catalogFile: path.join(dir, 'xx.json'),
  })
  assert.equal(result.reused, 1)
  assert.equal(result.translated, 2)
  assert.deepEqual(seen.sort(), ['a\u0000k2', 'b\u0000z'])
  assert.equal(result.catalog.namespaces.a.k1, 'Hola {n}')
  assert.equal(result.catalog.namespaces.a.k2, '[xx] Bye')
  assert.equal(result.catalog.namespaces.b.z, '[xx] Zed')
  assert.ok(fs.existsSync(path.join(dir, 'plugin', 'client.js')))
  assert.ok(fs.existsSync(path.join(dir, 'plugin', 'package.json')))

  const imported = catalogFromPlugin(path.join(dir, 'plugin', 'client.js'))
  assert.equal(imported.locale, 'xx')
  assert.deepEqual(imported.namespaces, result.catalog.namespaces)

  const onDisk = loadCatalog(path.join(dir, 'xx.json'))
  assert.deepEqual(onDisk.namespaces, result.catalog.namespaces)
}

// --no-translate copies English; --dry-run writes nothing.
{
  const result = await generateLanguagePack({
    source,
    locale: 'yy',
    label: 'Copyish',
    noTranslate: true,
    dryRun: false,
    plugin: { name: 'deepseek-yy', id: '@master-cas/deepseek-yy', version: '0.1.0', description: '', dir: path.join(dir, 'yy') },
    catalogFile: path.join(dir, 'yy.json'),
  })
  assert.equal(result.catalog.namespaces.a.k2, 'Bye')
  assert.equal(result.catalog.namespaces.b.z, 'Zed')

  const before = fs.readdirSync(dir).sort()
  const plan = await generateLanguagePack({
    source,
    locale: 'zz',
    label: 'Plan',
    dryRun: true,
    plugin: { name: 'deepseek-zz', id: '@master-cas/deepseek-zz', dir: path.join(dir, 'zz') },
    catalogFile: path.join(dir, 'zz.json'),
  })
  assert.equal(plan.dryRun, true)
  assert.equal(plan.pending, 3)
  assert.deepEqual(fs.readdirSync(dir).sort(), before, 'dry run must not write')
}

// Update: only new keys are translated, existing ones survive, prune works.
{
  const generated = loadCatalog(path.join(dir, 'xx.json'))
  const nextSource = {
    namespaces: {
      a: { k1: 'Hello {n}', k2: 'Bye', k3: 'New {v}' },
    },
  }
  const diff = diffCatalog(nextSource, generated)
  assert.equal(diff.added.length, 1)
  assert.equal(diff.removed.length, 1)
  assert.equal(diff.removed[0].key, 'z')

  const translate = async (entries) =>
    new Map(entries.map((entry) => [entry.id, `[xx2] ${entry.text}`]))

  const kept = await updateLanguagePack({
    source: nextSource,
    existing: generated,
    locale: 'xx',
    label: 'Testish',
    translate,
    catalogFile: path.join(dir, 'xx-kept.json'),
  })
  assert.equal(kept.reused, 2)
  assert.equal(kept.added, 1)
  assert.equal(kept.catalog.namespaces.a.k1, 'Hola {n}')
  assert.equal(kept.catalog.namespaces.a.k3, '[xx2] New {v}')
  assert.equal(kept.catalog.namespaces.b.z, '[xx] Zed', 'obsolete key kept by default')

  const pruned = await updateLanguagePack({
    source: nextSource,
    existing: generated,
    locale: 'xx',
    label: 'Testish',
    translate,
    prune: true,
    catalogFile: path.join(dir, 'xx-pruned.json'),
  })
  assert.equal(pruned.catalog.namespaces.b, undefined, 'obsolete namespace pruned')

  const dry = await updateLanguagePack({
    source: nextSource,
    existing: generated,
    locale: 'xx',
    label: 'Testish',
    dryRun: true,
  })
  assert.equal(dry.dryRun, true)
  assert.equal(dry.added, 1)
  assert.equal(dry.coverage.ratio > 0, true)
}

fs.rmSync(dir, { recursive: true, force: true })
console.log('generate/update tests: PASS')
