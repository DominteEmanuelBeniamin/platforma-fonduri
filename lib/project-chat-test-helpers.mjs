import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const nodeRequire = createRequire(import.meta.url)
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const typescript = nodeRequire('typescript')

export async function loadTsModule(file, stubs = {}, globals = null) {
  const source = await readFile(file, 'utf8')
  return evaluateTsModule(file, source, stubs, globals, new Map())
}

function evaluateTsModule(file, source, stubs, globals, cache) {
  if (cache.has(file)) return cache.get(file).exports
  const output = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: typescript.JsxEmit.ReactJSX,
    },
    fileName: file,
  }).outputText
  const loadedModule = { exports: {} }
  cache.set(file, loadedModule)
  const localRequire = specifier => {
    if (Object.prototype.hasOwnProperty.call(stubs, specifier)) return stubs[specifier]
    const localPath = specifier.startsWith('@/')
      ? resolve(workspaceRoot, specifier.slice(2))
      : specifier.startsWith('.') ? resolve(dirname(file), specifier) : null
    if (localPath) {
      const dependency = [localPath, `${localPath}.ts`, `${localPath}.tsx`, `${localPath}.js`, `${localPath}.mjs`]
        .find(candidate => existsSync(candidate))
      if (dependency) return evaluateTsModule(dependency, readFileSync(dependency, 'utf8'), stubs, globals, cache)
    }
    return nodeRequire(specifier)
  }
  if (globals) {
    runInNewContext(output, {
      ...globals,
      require: localRequire,
      module: loadedModule,
      exports: loadedModule.exports,
    }, { filename: file })
  } else {
    new Function('require', 'module', 'exports', output)(localRequire, loadedModule, loadedModule.exports)
  }
  return loadedModule.exports
}

const matches = (row, filters) => filters.every(filter => filter(row))

export class PaginatedQuery {
  constructor(database, table) {
    this.database = database
    this.table = table
    this.filters = []
    this.orders = []
    this.start = 0
    this.end = 999
  }

  select() { return this }
  eq(column, value) { this.filters.push(row => row[column] === value); return this }
  neq(column, value) { this.filters.push(row => row[column] !== value); return this }
  in(column, values) { this.filters.push(row => values.includes(row[column])); return this }
  is(column, value) { this.filters.push(row => row[column] === value); return this }
  not(column, operator, value) {
    if (operator === 'is') this.filters.push(row => row[column] !== value)
    return this
  }
  gt(column, value) { this.filters.push(row => row[column] > value); return this }
  gte(column, value) { this.filters.push(row => row[column] >= value); return this }
  lt(column, value) { this.filters.push(row => row[column] < value); return this }
  lte(column, value) { this.filters.push(row => row[column] <= value); return this }
  order(column, { ascending = true } = {}) {
    this.orders.push({ column, ascending })
    return this
  }
  range(start, end) { this.start = start; this.end = Math.min(end, start + 999); return this }
  limit(count) { this.end = Math.min(this.start + count - 1, this.start + 999); return this }
  or(expression) {
    const alternatives = String(expression).split(',').map(part => part.replace(/^\(+|\)+$/g, ''))
    const predicates = alternatives.map(part => {
      const [column, operator, ...pieces] = part.split('.')
      const rawValue = pieces.join('.')
      const value = rawValue === 'null' ? null : rawValue.replace(/^"|"$/g, '')
      const compare = {
        eq: actual => actual === value,
        neq: actual => actual !== value,
        gt: actual => actual > value,
        gte: actual => actual >= value,
        lt: actual => actual < value,
        lte: actual => actual <= value,
        is: actual => actual === value,
      }[operator]
      if (!column || !compare || pieces.length === 0) {
        throw new Error(`PaginatedQuery cannot model .or(${JSON.stringify(expression)})`)
      }
      return row => compare(row[column])
    })
    this.filters.push(row => predicates.some(predicate => predicate(row)))
    return this
  }

  rows() {
    const rows = (this.database.tables[this.table] ?? []).filter(row => matches(row, this.filters))
    rows.sort((left, right) => {
      for (const { column, ascending } of this.orders) {
        const order = left[column] < right[column] ? -1 : left[column] > right[column] ? 1 : 0
        if (order) return ascending ? order : -order
      }
      return 0
    })
    return rows
  }

  result() {
    const error = this.database.errors?.[this.table] ?? null
    if (error) return { data: null, error, count: null }
    const rows = this.rows()
    return {
      data: rows.slice(this.start, this.end + 1),
      error: null,
      count: rows.length,
    }
  }

  async maybeSingle() {
    const result = this.result()
    return { ...result, data: result.data?.[0] ?? null }
  }

  async single() {
    return this.maybeSingle()
  }

  then(resolve, reject) {
    return Promise.resolve(this.result()).then(resolve, reject)
  }
}

export function paginatedAdmin(database) {
  return { from: table => new PaginatedQuery(database, table) }
}
