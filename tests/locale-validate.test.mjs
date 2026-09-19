/**
 * Validation verdict tests: namespaces, keys, placeholders, empty values,
 * extra/untranslated handling and the strict mode.
 */
import assert from 'node:assert/strict'
import { formatValidationReport, validateCatalogs } from '../tools/lib/validate.mjs'

const source = {
  namespaces: {
    common: { ok: 'OK', cancel: 'Cancel' },
    chat: { send: 'Send {text}', empty: 'No messages' },
  },
}

// Clean target passes.
{
  const target = {
    namespaces: {
      common: { ok: 'Aceptar', cancel: 'Cancelar' },
      chat: { send: 'Enviar {text}', empty: 'Sin mensajes' },
    },
  }
  const report = validateCatalogs(source, target)
  assert.equal(report.pass, true)
  assert.equal(report.errors.length, 0)
  assert.equal(report.stats.coverage, '100.0%')
  assert.ok(formatValidationReport(report).startsWith('Validation: PASS'))
}

// Missing namespace fails.
{
  const report = validateCatalogs(source, { namespaces: { common: { ok: 'Aceptar', cancel: 'Cancelar' } } })
  assert.equal(report.pass, false)
  assert.ok(report.errors.some((error) => error.includes('missing namespace "chat"')))
}

// Missing key fails.
{
  const report = validateCatalogs(source, {
    namespaces: {
      common: { ok: 'Aceptar', cancel: 'Cancelar' },
      chat: { send: 'Enviar {text}' },
    },
  })
  assert.equal(report.pass, false)
  assert.ok(report.errors.some((error) => error.includes('missing key "chat.empty"')))
}

// Empty translation fails.
{
  const report = validateCatalogs(source, {
    namespaces: {
      common: { ok: 'Aceptar', cancel: '' },
      chat: { send: 'Enviar {text}', empty: 'Sin mensajes' },
    },
  })
  assert.equal(report.pass, false)
  assert.ok(report.errors.some((error) => error.includes('empty translation "common.cancel"')))
}

// Placeholder mismatch fails.
{
  const report = validateCatalogs(source, {
    namespaces: {
      common: { ok: 'Aceptar', cancel: 'Cancelar' },
      chat: { send: 'Enviar', empty: 'Sin mensajes' },
    },
  })
  assert.equal(report.pass, false)
  assert.ok(report.errors.some((error) => error.includes('placeholder mismatch "chat.send"')))
}

// Extra keys and untranslated values warn by default and fail under --strict.
{
  const target = {
    namespaces: {
      common: { ok: 'OK', cancel: 'Cancelar', legacy: 'Viejo' },
      chat: { send: 'Send {text}', empty: 'Sin mensajes' },
    },
  }
  const lenient = validateCatalogs(source, target)
  assert.equal(lenient.pass, true)
  assert.ok(lenient.warnings.some((warning) => warning.includes('extra key "common.legacy"')))
  assert.ok(lenient.warnings.some((warning) => warning.includes('untranslated')))

  const strict = validateCatalogs(source, target, { strict: true })
  assert.equal(strict.pass, false)
  assert.ok(strict.errors.some((error) => error.includes('extra key "common.legacy"')))
  assert.ok(strict.errors.some((error) => error.includes('untranslated')))
}

// Protected-term reporting is opt-in.
{
  const protectedSource = { namespaces: { x: { label: 'Export JSON', plain: 'Plain' } } }
  const target = { namespaces: { x: { label: 'Exportar', plain: 'Llano' } } }
  const warned = validateCatalogs(protectedSource, target, { checkProtected: true })
  assert.ok(
    warned.warnings.some((warning) => warning.includes('protected term lost')),
    `expected protected warning, got ${JSON.stringify(warned.warnings)}`,
  )
  const notChecked = validateCatalogs(protectedSource, target)
  assert.equal(notChecked.warnings.some((warning) => warning.includes('protected term lost')), false)
}

console.log('validation tests: PASS')
