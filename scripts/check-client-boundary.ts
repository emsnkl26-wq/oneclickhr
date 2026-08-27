/**
 * Catch the one mistake that type-checks, builds, and then crashes the page.
 *
 * When a Server Component imports from a module marked `'use client'`, the
 * bundler does NOT give it the value. It gives it a client REFERENCE — a proxy
 * whose job is to tell the browser which component to hydrate. For a component
 * that is exactly right. For a plain array, object or function it is a landmine:
 *
 *     // filters.tsx  ('use client')
 *     export const KINDS = ['a', 'b'] as const
 *
 *     // page.tsx  (server)
 *     import { KINDS } from './filters'
 *     KINDS.includes(x)      // TypeError: KINDS.includes is not a function
 *
 * TypeScript sees a `readonly string[]` and is satisfied. `next build` compiles
 * it without complaint. The failure appears only when someone opens the page —
 * which is how two whole screens in this app (`/org/documents` and
 * `/super/audit`) shipped dead.
 *
 * The fix is always the same: move shared plain data into a module with no
 * directive, and let both sides import it for what it is.
 *
 *     npm run check:boundaries
 *
 * Heuristic, and deliberately quiet: a PascalCase import is assumed to be a
 * component (the legitimate case) and a name that is never read as a value in
 * the importing file is ignored. False negatives are possible; a report here is
 * worth looking at.
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = 'src'

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

const files = walk(ROOT)
const source = new Map<string, string>()
const clientModule = new Map<string, boolean>()

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  source.set(file, text)
  // The directive is only a directive at the very top of the file.
  clientModule.set(file, /^\s*['"]use client['"]/m.test(text.slice(0, 200)))
}

function resolveImport(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = path.join(ROOT, spec.slice(2))
  else if (spec.startsWith('.')) base = path.join(path.dirname(from), spec)
  else return null

  const candidates = [
    `${base}.tsx`, `${base}.ts`,
    path.join(base, 'index.tsx'), path.join(base, 'index.ts'),
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}

interface Finding { file: string; name: string; spec: string; target: string }
const findings: Finding[] = []

for (const file of files) {
  // Client importing client is fine — both sides get real values.
  if (clientModule.get(file)) continue
  // Tests run under Vitest with no bundler in the way.
  if (file.includes('__tests__')) continue

  const text = source.get(file)!
  const importRe = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g

  for (const match of text.matchAll(importRe)) {
    if (/^import\s+type\s/.test(match[0])) continue

    const target = resolveImport(file, match[2])
    if (!target || !clientModule.get(target)) continue

    const rest = text.replace(match[0], '')

    for (const raw of match[1].split(',').map((n) => n.trim()).filter(Boolean)) {
      if (raw.startsWith('type ')) continue
      const name = raw.split(/\s+as\s+/)[0].trim()
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue

      // A component is PascalCase and only ever appears as JSX, never read.
      const looksLikeComponent = /^[A-Z][a-zA-Z0-9]*$/.test(name) && !/^[A-Z0-9_]+$/.test(name)
      if (looksLikeComponent) continue

      // Only report names this file actually READS — `X.y`, `X[y]`, `X(...)`.
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (!new RegExp(`\\b${escaped}\\s*[.\\[(]`).test(rest)) continue

      findings.push({ file, name, spec: match[2], target })
    }
  }
}

if (findings.length === 0) {
  console.log('client boundary: no server module reads a value out of a "use client" module.')
  process.exit(0)
}

console.error('\nclient boundary: a Server Component is reading a value from a "use client" module.')
console.error('These arrive as client-reference proxies at runtime and will throw when used.\n')
for (const f of findings) {
  console.error(`  ${f.file}`)
  console.error(`      "${f.name}" imported from ${f.spec}`)
  console.error(`      -> ${f.target} is marked 'use client'`)
  console.error(`      fix: move "${f.name}" into a module with no directive and import it from both sides.\n`)
}
process.exit(1)
