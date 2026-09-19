/**
 * Scanner tests: a synthetic fixture proves the discovery is generic (four
 * different registration shapes), and the real checkout pins the acceptance
 * numbers — 48 namespaces / 1643 keys — without hardcoding the list.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCatalog } from '../tools/lib/catalog.mjs'
import { scanHarness } from '../tools/lib/harness-scan.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'harness')

const fixture = await scanHarness(fixtureRoot)
assert.equal(fixture.stats.namespaces, 4, 'fixture namespace count')
assert.equal(fixture.stats.keys, 8, 'fixture key count')
assert.deepEqual(Object.keys(fixture.namespaces).sort(), ['alpha', 'beta', 'delta', 'gamma'])
assert.equal(fixture.warnings.length, 0, `fixture warnings: ${fixture.warnings.join('; ')}`)

// alpha: NS + en/zh imported from ./locales.ts
assert.equal(fixture.namespaces.alpha.greet, 'Hello {name}')
// beta: inline options object with inline dictionaries
assert.equal(fixture.namespaces.beta.count, '{n} items')
// gamma: register(NS, locale, dict) with a `['en', {...}]` tuple
assert.equal(fixture.namespaces.gamma.bye, 'Bye {who}')
// delta: custom namespace const and aliased dictionary exports
assert.equal(fixture.namespaces.delta.two, 'two {x}')

const HARNESS = process.env.DSH_HARNESS ?? '/home/ubuntu/deepseek-harness'
if (!fs.existsSync(path.join(HARNESS, 'package.json'))) {
  console.log(`scanner tests: fixture PASS; real harness not found at ${HARNESS} (skipped)`)
} else {
  const scan = await scanHarness(HARNESS)
  assert.equal(scan.stats.namespaces, 48, 'real harness namespace count')
  assert.equal(scan.stats.keys, 1643, 'real harness key count')
  assert.equal(scan.stats.placeholders, 322, 'real harness placeholder count')
  assert.equal(scan.warnings.length, 0, `real harness warnings: ${scan.warnings.join('; ')}`)

  // The endpoints the requirement calls out explicitly must be present.
  for (const namespace of [
    'common',
    'command',
    'chat',
    'conversation',
    'cordis',
    'session-log-download',
    'permission.access',
    'settings.permission',
    'directory-browser',
    'sidebarCodePreview',
    'sidebarDocumentPreview',
    'documentMarkdown',
    'documentHtml',
    'sidebarImage',
    'sidebarPdf',
    'sidebarOffice',
  ]) {
    assert.ok(scan.namespaces[namespace], `missing discovered namespace ${namespace}`)
  }

  // Spot-check values and placeholders across the client/extension/session-query groups.
  assert.equal(scan.namespaces.common.cancel, 'Cancel')
  assert.equal(scan.namespaces.command['section.commands'], 'Commands')
  assert.equal(scan.namespaces['session-log-download']['menu.download'], 'Download session log')
  assert.equal(scan.namespaces.cordis['action.run'], 'Run')
  assert.equal(scan.namespaces['open-in-app']['open.title'], 'Open workspace in {app}')
  assert.equal(scan.namespaces.job['count.live.one'], '{count} background job running')
  assert.equal(scan.namespaces.chat['stats.counts'], '{turns} turns {steps} steps')

  // The canonical catalog on disk must match the live scan exactly.
  const canonical = loadCatalog(path.join(root, 'locales', 'source-en.json'))
  assert.deepEqual(Object.keys(canonical.namespaces), Object.keys(scan.namespaces))
  for (const namespace of Object.keys(scan.namespaces)) {
    assert.deepEqual(
      Object.keys(canonical.namespaces[namespace]),
      Object.keys(scan.namespaces[namespace]),
      `${namespace}: canonical keys differ from live scan`,
    )
    assert.deepEqual(
      canonical.namespaces[namespace],
      scan.namespaces[namespace],
      `${namespace}: canonical values differ from live scan`,
    )
  }
  console.log('scanner tests: fixture + real harness PASS')
}
