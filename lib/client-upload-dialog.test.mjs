import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

function load(path, imports) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const loadedModule = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(name in imports, `unexpected import: ${name}`)
    return imports[name]
  }, loadedModule, loadedModule.exports)
  return loadedModule.exports
}

function dialog({ completionFailures = 1, loseResponseAfterCommit = false } = {}) {
  const hooks = []
  let cursor = 0
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = initial
      return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value }]
    },
    useRef(initial) {
      const index = cursor++
      return hooks[index] ??= { current: initial }
    },
    useEffect() {},
  }
  const jsx = (type, props) => ({ type, props: props ?? {} })
  const elements = { jsx, jsxs: jsx, Fragment: 'fragment' }
  const selection = load('./upload-selection.ts', { './count-label.ts': load('./count-label.ts', {}) })
  const upload = load('./client-upload.ts', {
    '@/lib/document-action-idempotency': { MAX_UPLOAD_FILE_SIZE: 25 * 1024 * 1024 },
    '@/lib/upload-selection': selection,
  })
  const toasts = []
  const confirmations = []
  let closed = 0
  const calls = []
  const committed = new Map()
  let completeAttempts = 0
  const apiFetch = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url, body })
    if (url.endsWith('/init')) {
      const batch = `batch-${calls.filter(call => call.url.endsWith('/init')).length}`
      return Response.json({ batchId: batch, uploads: body.files.map((file, index) => ({
        fileId: `${batch}-${file.name}`, clientFileId: index, signedUploadUrl: `https://storage.test/${file.name}`, token: 'token',
      })) })
    }
    const failed = ++completeAttempts <= completionFailures
    if (failed && !loseResponseAfterCommit) return Response.json({ message: 'completion failed' }, { status: 500 })
    if (committed.has(body.batchId)) assert.deepEqual(committed.get(body.batchId), body.fileIds)
    else committed.set(body.batchId, body.fileIds)
    if (failed) return Response.json({ message: 'completion failed' }, { status: 500 })
    return Response.json({})
  }
  const component = load('../components/document-requests/ClientUploadDialog.tsx', {
    react,
    'react/jsx-runtime': elements,
    '@radix-ui/react-dialog': { Root: 'root', Portal: 'portal', Overlay: 'overlay', Content: 'content', Title: 'title', Description: 'description' },
    'lucide-react': new Proxy({}, { get: (_, name) => name }),
    '@/app/providers/ToastProvider': { useToast: () => ({ showToast: (...args) => toasts.push(args), confirm: async options => { confirmations.push(options); return false } }) },
    '@/components/FeedbackMessage': { FeedbackMessage: 'feedback' },
    '@/components/ui/Button': { Button: 'Button' },
    '@/lib/client-upload': upload,
    '@/lib/upload-selection': selection,
  }).default
  const props = { request: { id: 'request', name: 'Request', rejected: false }, startWith: 'files', canUploadFolder: false, apiFetch, onUploaded() {}, onClose() { closed++ }, getFileIcon() {} }
  const render = () => { cursor = 0; return component(props) }
  const find = predicate => {
    const visit = node => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) return node.map(visit).find(Boolean)
      if (predicate(node)) return node
      return visit(node.props?.children)
    }
    const found = visit(render())
    assert.ok(found, 'element not found')
    return found
  }
  const pick = files => find(node => node.type === 'input' && node.props.type === 'file').props.onChange({ currentTarget: { files, value: '' } })
  const clickUpload = () => find(node => node.type === 'Button' && node.props['data-tooltip'] === 'Trimite consultantului fișierele alese').props.onClick()
  const waitForToast = async count => {
    for (let i = 0; i < 100 && toasts.length < count; i++) await new Promise(resolve => setImmediate(resolve))
    assert.equal(toasts.length, count)
  }
  return { pick, clickUpload, waitForToast, calls, committed, toasts, confirmations, get closed() { return closed }, close: () => find(node => node.type === 'button' && node.props['aria-label'] === 'Închide').props.onClick(), remove: name => find(node => node.type === 'button' && node.props['aria-label'] === `Scoate ${name} din listă`).props.onClick() }
}

test('finalizes the retained batch before uploading a newly added file', async () => {
  const originalFetch = globalThis.fetch
  const puts = []
  globalThis.fetch = async url => { puts.push(url); return new Response(null, { status: 200 }) }
  try {
    const ui = dialog()
    ui.pick([new File(['a'], 'a.pdf', { type: 'application/pdf' })])
    ui.clickUpload()
    await ui.waitForToast(1)
    assert.equal(ui.committed.size, 0)
    ui.pick([new File(['b'], 'b.pdf', { type: 'application/pdf' })])
    ui.clickUpload()
    await ui.waitForToast(2)
    assert.deepEqual(ui.calls.map(call => [call.url.split('/').at(-1), call.body.batchId ?? call.body.files.map(file => file.name)]), [
      ['init', ['a.pdf']], ['complete', 'batch-1'], ['complete', 'batch-1'], ['init', ['b.pdf']], ['complete', 'batch-2'],
    ])
    assert.deepEqual(ui.calls[1].body.fileIds, ['batch-1-a.pdf'])
    assert.deepEqual(ui.calls[2].body, ui.calls[1].body)
    assert.deepEqual(ui.calls[4].body.fileIds, ['batch-2-b.pdf'])
    assert.equal(ui.committed.size, 2)
    assert.deepEqual(puts, ['https://storage.test/a.pdf', 'https://storage.test/b.pdf'])
    assert.equal(ui.closed, 1)
  } finally { globalThis.fetch = originalFetch }
})

test('removing a failed file keeps the batch retry and warns before closing', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async url => new Response(null, { status: url.endsWith('/b.pdf') ? 500 : 200 })
  try {
    const ui = dialog()
    ui.pick([new File(['a'], 'a.pdf', { type: 'application/pdf' }), new File(['b'], 'b.pdf', { type: 'application/pdf' })])
    ui.clickUpload()
    await ui.waitForToast(1)
    ui.remove('b.pdf')
    ui.close()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(ui.confirmations.length, 1)
    assert.match(ui.confirmations[0].description, /1 fișier/)
    assert.equal(ui.closed, 0)
    ui.clickUpload()
    await ui.waitForToast(2)
    assert.deepEqual(ui.calls.map(call => call.url.split('/').at(-1)), ['init', 'complete', 'complete'])
    assert.equal(ui.toasts[1][1], 'success')
    assert.equal(ui.closed, 1)
  } finally { globalThis.fetch = originalFetch }
})

test('keeps newly added files queued if the completion retry fails again', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(null, { status: 200 })
  try {
    const ui = dialog({ completionFailures: 2 })
    ui.pick([new File(['a'], 'a.pdf', { type: 'application/pdf' })])
    ui.clickUpload()
    await ui.waitForToast(1)
    ui.pick([new File(['b'], 'b.pdf', { type: 'application/pdf' })])
    ui.clickUpload()
    await ui.waitForToast(2)
    assert.deepEqual(ui.calls.map(call => call.url.split('/').at(-1)), ['init', 'complete', 'complete'])
    assert.equal(ui.closed, 0)
    ui.clickUpload()
    await ui.waitForToast(3)
    assert.deepEqual(ui.calls.map(call => call.url.split('/').at(-1)), ['init', 'complete', 'complete', 'complete', 'init', 'complete'])
    assert.equal(ui.committed.size, 2)
    assert.equal(ui.closed, 1)
  } finally { globalThis.fetch = originalFetch }
})

test('retries the same batch when the completion response is lost after commit', async () => {
  const originalFetch = globalThis.fetch
  const puts = []
  globalThis.fetch = async url => { puts.push(url); return new Response(null, { status: 200 }) }
  try {
    const ui = dialog({ loseResponseAfterCommit: true })
    ui.pick([new File(['a'], 'a.pdf', { type: 'application/pdf' })])
    ui.clickUpload()
    await ui.waitForToast(1)
    assert.equal(ui.committed.size, 1)
    ui.pick([new File(['b'], 'b.pdf', { type: 'application/pdf' })])
    ui.clickUpload()
    await ui.waitForToast(2)
    assert.deepEqual(ui.calls[2].body, ui.calls[1].body)
    assert.deepEqual(puts, ['https://storage.test/a.pdf', 'https://storage.test/b.pdf'])
    assert.equal(ui.committed.size, 2)
    assert.equal(ui.closed, 1)
  } finally { globalThis.fetch = originalFetch }
})
