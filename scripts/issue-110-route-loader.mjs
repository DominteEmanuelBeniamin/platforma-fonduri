// Test-only loader: run the real route sources with explicit external-service stubs.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
export function createRouteLoader(overrides = {}) {
  const root = process.cwd(), cache = new Map()
  function load(file) {
    const absolute = path.resolve(root, file)
    const key = path.relative(root, absolute).replaceAll('\\', '/')
    if (Object.hasOwn(overrides, key)) return overrides[key]
    if (cache.has(absolute)) return cache.get(absolute).exports
    const loaded = { exports: {} }
    cache.set(absolute, loaded)
    const output = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      fileName: absolute, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    const localRequire = specifier => {
      if (Object.hasOwn(overrides, specifier)) return overrides[specifier]
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return require(specifier)
      const base = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : path.resolve(path.dirname(absolute), specifier)
      const source = [base, base + '.ts', base + '.js'].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      if (!source) throw new Error('Unresolved test module: ' + specifier)
      return load(source)
    }
    new Function('require', 'module', 'exports', output)(localRequire, loaded, loaded.exports)
    return loaded.exports
  }
  return load
}
