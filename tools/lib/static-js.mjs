/**
 * Dependency-free helpers to read JavaScript *statically* — no `eval`, no
 * `import()` and no VM. They power the lightweight (`~/.dsh`) harness scanner,
 * which must inspect compiled `lib/client.js` bundles that reference the
 * Harness runtime and therefore cannot be executed outside the browser.
 *
 * The extractor understands the subset of JavaScript that compiled locale
 * registrations actually use:
 *
 *   const NS = "namespace"                 // string namespace constants
 *   const en = { "key": "value", ...base } // object dictionaries + spreads
 *   ctx.locale.register(NS, { zh, en })    // bilingual registration
 *   ctx.locale.register("ns", { zh, en })  // inline namespace literal
 *   locale.register(NS, locale, dict)      // one locale per call / tuple list
 *
 * Anything it cannot reduce to plain data is reported as `undefined` instead
 * of being executed, so scanning an untrusted bundle stays safe.
 */

/** Recursively collect `const`-like declarations: name -> raw expression text. */
const DECLARATION_PATTERN = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g

/**
 * Strip `//` and block comments while preserving string and template literal
 * contents. This keeps commented-out registrations from being misread as code.
 *
 * @param {string} text JavaScript source.
 * @returns {string} source with comments replaced by spaces.
 */
export function stripComments(text) {
  let out = ''
  let i = 0
  while (i < text.length) {
    const char = text[i]
    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += ' '
      continue
    }
    if (char === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      out += ' '
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      const quote = char
      out += char
      i++
      while (i < text.length) {
        const inner = text[i]
        if (inner === '\\') {
          out += inner + (text[i + 1] ?? '')
          i += 2
          continue
        }
        out += inner
        i++
        if (inner === quote) break
      }
      continue
    }
    out += char
    i++
  }
  return out
}

/** Extract the balanced `(...)`, `{...}` or `[...]` starting at `start`. */
export function extractBalanced(text, start) {
  const open = text[start]
  const close = open === '(' ? ')' : open === '{' ? '}' : open === '[' ? ']' : undefined
  if (!close) return undefined
  let depth = 0
  let quote
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      if (char === '\\') {
        i++
        continue
      }
      if (char === quote) quote = undefined
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === open) depth++
    else if (char === close) {
      depth--
      if (depth === 0) return { text: text.slice(start, i + 1), end: i }
    }
  }
  return undefined
}

/** Split a call/object body on top-level commas. */
export function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let quote
  let current = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      current += char
      if (char === '\\') {
        current += text[++i]
        continue
      }
      if (char === quote) quote = undefined
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      current += char
      continue
    }
    if (char === '(' || char === '{' || char === '[') depth++
    if (char === ')' || char === '}' || char === ']') depth--
    if (char === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

/** Index of the first top-level `:` outside strings/brackets, or -1. */
export function findTopLevelColon(text) {
  let depth = 0
  let quote
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      if (char === '\\') {
        i++
        continue
      }
      if (char === quote) quote = undefined
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === '(' || char === '{' || char === '[') depth++
    else if (char === ')' || char === '}' || char === ']') depth--
    else if (char === ':' && depth === 0) return i
  }
  return -1
}

/** Read one expression token/balanced group starting at `start`. */
function readExpression(text, start) {
  let i = start
  while (i < text.length && /\s/.test(text[i])) i++
  const char = text[i]
  if (char === undefined) return undefined
  if (char === '{' || char === '[' || char === '(') {
    const balanced = extractBalanced(text, i)
    return balanced ? { raw: text.slice(i, balanced.end + 1), end: balanced.end } : undefined
  }
  if (char === '"' || char === "'" || char === '`') {
    let j = i + 1
    while (j < text.length) {
      if (text[j] === '\\') {
        j += 2
        continue
      }
      if (text[j] === char) break
      j++
    }
    return { raw: text.slice(i, j + 1), end: j }
  }
  if (/[A-Za-z_$]/.test(char)) {
    let j = i
    while (j < text.length && /[\w$]/.test(text[j])) j++
    return { raw: text.slice(i, j), end: j - 1 }
  }
  if (/[0-9]/.test(char)) {
    let j = i
    while (j < text.length && /[\w.$]/.test(text[j])) j++
    return { raw: text.slice(i, j), end: j - 1 }
  }
  return undefined
}

/**
 * Collect `const|let|var NAME = <expr>` declarations and bare
 * `NAME = <object|array|string>` assignments. First declaration wins, which
 * matches how bundlers hoist top-level dictionaries above nested scopes.
 *
 * @param {string} text comment-stripped JavaScript.
 * @returns {Map<string, string>} name to raw expression text.
 */
export function collectDeclarations(text) {
  const declarations = new Map()
  const record = (name, expression) => {
    if (name && expression && !declarations.has(name)) declarations.set(name, expression)
  }

  for (const match of text.matchAll(DECLARATION_PATTERN)) {
    const expression = readExpression(text, match.index + match[0].length)
    if (expression) record(match[1], expression.raw)
  }

  // Bare `name = { ... }` / `name = [...]` statements (no const/let/var).
  const assignment = /(?:^|[;{}\n])[ \t]*([A-Za-z_$][\w$]*)\s*=\s*(?=[{['"`])/g
  for (const match of text.matchAll(assignment)) {
    const offset = match.index + match[0].length
    const expression = readExpression(text, offset)
    if (expression) record(match[1], expression.raw)
  }

  return declarations
}

/** Unescape the body of a single/double quoted string literal. */
function unescapeString(body) {
  let out = ''
  for (let i = 0; i < body.length; i++) {
    const char = body[i]
    if (char !== '\\') {
      out += char
      continue
    }
    const next = body[++i]
    switch (next) {
      case 'n': out += '\n'; break
      case 't': out += '\t'; break
      case 'r': out += '\r'; break
      case 'b': out += '\b'; break
      case 'f': out += '\f'; break
      case 'v': out += '\v'; break
      case '0': out += '\0'; break
      case 'x': out += String.fromCharCode(parseInt(body.slice(i + 1, i + 3), 16)); i += 2; break
      case 'u': {
        if (body[i + 1] === '{') {
          const close = body.indexOf('}', i)
          out += String.fromCodePoint(parseInt(body.slice(i + 2, close), 16))
          i = close
        } else {
          out += String.fromCharCode(parseInt(body.slice(i + 1, i + 5), 16))
          i += 4
        }
        break
      }
      case '\n': break
      case undefined: break
      default: out += next
    }
  }
  return out
}

/** Parse a quoted string literal (including its quotes) into its value. */
export function parseStringLiteral(raw) {
  const text = raw.trim()
  const quote = text[0]
  if (quote !== '"' && quote !== "'") return undefined
  let i = 1
  while (i < text.length) {
    const char = text[i]
    if (char === '\\') {
      i += 2
      continue
    }
    if (char === quote) {
      // Only a single, self-contained literal counts; `"a" + b` is not one.
      return i === text.length - 1 ? unescapeString(text.slice(1, i)) : undefined
    }
    i++
  }
  return undefined
}

/** Evaluate a template literal with `${identifier}` interpolation. */
function evaluateTemplate(raw, symbols, seen) {
  const body = raw.slice(1, -1)
  let out = ''
  let i = 0
  while (i < body.length) {
    const char = body[i]
    if (char === '\\') {
      out += unescapeString(body.slice(i, i + 2))
      i += 2
      continue
    }
    if (char === '$' && body[i + 1] === '{') {
      const balanced = extractBalanced(body, i + 1)
      if (!balanced) break
      const value = evaluateStatic(body.slice(i + 2, balanced.end), symbols, seen)
      out += value === undefined ? '' : String(value)
      i = balanced.end + 1
      continue
    }
    out += char
    i++
  }
  return out
}

/** Split on a top-level binary operator such as `+` in `'a' + b`. */
function splitTopLevelOperator(text, operator) {
  const parts = []
  let depth = 0
  let quote
  let current = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      current += char
      if (char === '\\') {
        current += text[++i]
        continue
      }
      if (char === quote) quote = undefined
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      current += char
      continue
    }
    if (char === '(' || char === '{' || char === '[') depth++
    if (char === ')' || char === '}' || char === ']') depth--
    if (char === operator && depth === 0 && text[i + 1] !== operator && text[i - 1] !== operator) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  parts.push(current.trim())
  return parts
}

/**
 * Split a whole-expression member access into its base and final accessor.
 *
 * Only the last top-level `.name` or `[...]` that consumes the entire
 * expression counts, so calls, binary operators and optional chains stay with
 * the other evaluators. The base is returned as raw text to be resolved
 * recursively; no part of it is ever executed.
 *
 * @param {string} text trimmed expression text.
 * @returns {{ base: string, dot?: string, bracket?: string } | undefined}
 */
function splitMemberAccess(text) {
  let depth = 0
  let quote
  let candidate
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      if (char === '\\') {
        i++
        continue
      }
      if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '[' && depth === 0) {
      const balanced = extractBalanced(text, i)
      if (balanced) {
        if (i > 0 && balanced.end === text.length - 1) {
          candidate = { base: text.slice(0, i).trim(), bracket: text.slice(i + 1, balanced.end) }
        }
        i = balanced.end
        continue
      }
    }
    if (char === '(' || char === '{' || char === '[') {
      depth++
      continue
    }
    if (char === ')' || char === '}' || char === ']') {
      depth--
      continue
    }
    if (char === '.' && depth === 0 && i > 0) {
      const rest = text.slice(i + 1).trim()
      if (/^[A-Za-z_$][\w$]*$/.test(rest)) {
        candidate = { base: text.slice(0, i).trim(), dot: rest }
      }
    }
  }
  return candidate
}

/**
 * Read one statically-known property from an already-evaluated object/array.
 * Only own properties count, so inherited names such as `constructor` or
 * `__proto__` can never leak through.
 *
 * @param {*} base a value produced by `evaluateStatic`.
 * @param {string|number} key the static property name.
 * @returns {*} the own property value, or `undefined`.
 */
function readStaticProperty(base, key) {
  if (base === null || typeof base !== 'object') return undefined
  const property = String(key)
  if (!Object.prototype.hasOwnProperty.call(base, property)) return undefined
  return base[property]
}

/**
 * Resolve one member access whose base is statically evaluable. Both the base
 * and (for brackets) the key come from `evaluateStatic`, so nothing runs.
 *
 * @param {{ base: string, dot?: string, bracket?: string }} access split access.
 * @param {Map<string, string>} symbols declarations collected from the file.
 * @param {Set<string>} seen recursion guard.
 * @returns {*} the property value, or `undefined` when it cannot be resolved.
 */
function evaluateMemberAccess(access, symbols, seen) {
  const base = evaluateStatic(access.base, symbols, seen)
  if (base === null || typeof base !== 'object') return undefined
  const key = access.dot !== undefined ? access.dot : evaluateStatic(access.bracket, symbols, seen)
  if (typeof key !== 'string' && typeof key !== 'number') return undefined
  return readStaticProperty(base, key)
}

/**
 * Statically evaluate a JavaScript expression against known declarations.
 *
 * @param {string} expression raw expression text.
 * @param {Map<string, string>} symbols declarations collected from the file.
 * @param {Set<string>} [seen] recursion guard.
 * @returns {*} the plain value, or `undefined` when it cannot be resolved.
 */
export function evaluateStatic(expression, symbols, seen = new Set()) {
  const text = String(expression ?? '').trim()
  if (!text) return undefined

  // Member access binds tighter than `+`, so a base containing a top-level
  // `+` belongs to the concatenation evaluator below instead.
  const access = splitMemberAccess(text)
  if (access && splitTopLevelOperator(access.base, '+').length === 1) {
    return evaluateMemberAccess(access, symbols, seen)
  }

  if (text.startsWith('{')) {
    const balanced = extractBalanced(text, 0)
    return balanced && balanced.end === text.length - 1
      ? evaluateObject(text.slice(1, -1), symbols, seen)
      : undefined
  }
  if (text.startsWith('[')) {
    const balanced = extractBalanced(text, 0)
    return balanced && balanced.end === text.length - 1
      ? splitTopLevel(text.slice(1, -1)).map((part) => evaluateStatic(part, symbols, seen))
      : undefined
  }
  if (text.startsWith('"') || text.startsWith("'")) {
    const literal = parseStringLiteral(text)
    if (literal !== undefined) return literal
  }
  if (text.startsWith('`')) {
    let i = 1
    while (i < text.length) {
      if (text[i] === '\\') {
        i += 2
        continue
      }
      if (text[i] === '`') break
      i++
    }
    if (i === text.length - 1) return evaluateTemplate(text, symbols, seen)
  }
  if (text === 'true') return true
  if (text === 'false') return false
  if (text === 'null') return null
  if (text === 'undefined') return undefined
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return Number(text)
  if (/^[A-Za-z_$][\w$]*$/.test(text)) {
    if (seen.has(text) || !symbols.has(text)) return undefined
    seen.add(text)
    const value = evaluateStatic(symbols.get(text), symbols, seen)
    seen.delete(text)
    return value
  }
  const parts = splitTopLevelOperator(text, '+')
  if (parts.length > 1) {
    let out = ''
    for (const part of parts) {
      const value = evaluateStatic(part, symbols, seen)
      if (value === undefined) return undefined
      out += String(value)
    }
    return out
  }
  return undefined
}

/** Evaluate an object literal body into a plain object. */
function evaluateObject(body, symbols, seen) {
  const out = {}
  for (const property of splitTopLevel(body)) {
    if (!property) continue
    if (property.startsWith('...')) {
      const spread = evaluateStatic(property.slice(3), symbols, seen)
      if (spread && typeof spread === 'object' && !Array.isArray(spread)) Object.assign(out, spread)
      continue
    }
    const colon = findTopLevelColon(property)
    let key
    let valueExpression
    if (colon === -1) {
      key = property.trim()
      valueExpression = key
    } else {
      const rawKey = property.slice(0, colon).trim()
      valueExpression = property.slice(colon + 1).trim()
      if (rawKey.startsWith('[') && rawKey.endsWith(']')) {
        const computed = evaluateStatic(rawKey.slice(1, -1), symbols, seen)
        key = computed === undefined ? undefined : String(computed)
      } else if (rawKey.startsWith('"') || rawKey.startsWith("'")) {
        key = parseStringLiteral(rawKey)
      } else {
        key = rawKey
      }
    }
    if (key === undefined) continue
    const value = evaluateStatic(valueExpression, symbols, seen)
    if (value === undefined) continue
    out[key] = value
  }
  return out
}

/** Locate every `locale.register(...)` call with comment filtering. */
export function findRegisterCalls(text) {
  const calls = []
  const pattern = /locale\.register\s*\(/g
  for (const match of text.matchAll(pattern)) {
    const before = text.slice(0, match.index)
    const lineStart = before.lastIndexOf('\n') + 1
    const line = text.slice(lineStart, match.index).trimStart()
    if (line.startsWith('*') || line.startsWith('//')) continue
    const open = match.index + match[0].length - 1
    const balanced = extractBalanced(text, open)
    if (!balanced) continue
    calls.push({
      index: match.index,
      args: splitTopLevel(balanced.text.slice(1, -1)),
      body: balanced.text.slice(1, -1),
    })
  }
  return calls
}
