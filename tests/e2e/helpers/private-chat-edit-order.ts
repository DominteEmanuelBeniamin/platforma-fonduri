import { once } from 'node:events'
import http, { createServer, type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse } from 'node:http'
import https from 'node:https'
import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import type { E2EConfig } from './project-state'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolveListen())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not reserve a local port')
  const port = address.port
  await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
  return port
}

function forwardRequest(
  target: URL,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  path: string,
  body: Buffer,
) {
  const headers: OutgoingHttpHeaders = { ...incoming.headers, host: target.host }
  delete headers.connection
  delete headers['proxy-connection']
  delete headers['transfer-encoding']
  delete headers['content-length']
  if (body.length > 0) headers['content-length'] = String(body.length)

  const transport = target.protocol === 'https:' ? https : http
  const upstream = transport.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    method: incoming.method,
    path,
    headers,
  }, response => {
    outgoing.writeHead(response.statusCode ?? 502, response.headers)
    response.pipe(outgoing)
  })
  upstream.on('error', error => {
    if (!outgoing.headersSent) outgoing.writeHead(502, { 'content-type': 'text/plain' })
    outgoing.end(`Local Supabase proxy failed: ${error.message}`)
  })
  upstream.end(body)
}

export type PatchRequest = {
  path: string
  body: { body?: unknown; edited_at?: unknown }
}

export type PatchGateProxy = {
  url: string
  arm: (messageId: string, body: string) => void
  waitUntilHeld: (timeoutMs?: number) => Promise<PatchRequest>
  release: () => void
  close: () => Promise<void>
}

/** Test-only HTTP proxy: pauses one already-built PostgREST PATCH before it reaches Supabase. */
export async function startPatchGateProxy(supabaseUrl: string): Promise<PatchGateProxy> {
  const target = new URL(supabaseUrl)
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('E2E Supabase must use HTTP or HTTPS')

  const held = deferred<PatchRequest>()
  const releaseWrite = deferred<void>()
  let armed: { messageId: string; body: string } | null = null
  let hasHeld = false

  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = []
    incoming.on('data', chunk => chunks.push(Buffer.from(chunk)))
    incoming.on('error', error => {
      if (!outgoing.headersSent) outgoing.writeHead(400)
      outgoing.end(error.message)
    })
    incoming.on('end', async () => {
      const bodyBytes = Buffer.concat(chunks)
      const bodyText = bodyBytes.toString('utf8')
      const requestUrl = new URL(incoming.url ?? '/', target)
      let parsedBody: Record<string, unknown> = {}
      try {
        parsedBody = bodyText ? JSON.parse(bodyText) as Record<string, unknown> : {}
      } catch {
        // Requests that are not the targeted JSON PATCH pass through untouched.
      }

      const idFilter = requestUrl.searchParams.get('id')
      const matches = armed && !hasHeld && incoming.method === 'PATCH' &&
        requestUrl.pathname === '/rest/v1/private_messages' &&
        idFilter === `eq.${armed.messageId}` && parsedBody.body === armed.body

      if (matches) {
        hasHeld = true
        held.resolve({
          path: `${requestUrl.pathname}${requestUrl.search}`,
          body: { body: parsedBody.body, edited_at: parsedBody.edited_at },
        })
        await releaseWrite.promise
      }

      forwardRequest(target, incoming, outgoing, `${requestUrl.pathname}${requestUrl.search}`, bodyBytes)
    })
  })

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolveListen())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not start the local Supabase proxy')

  return {
    url: `http://127.0.0.1:${address.port}`,
    arm(messageId, body) { armed = { messageId, body } },
    async waitUntilHeld(timeoutMs = 30_000) {
      let timer: NodeJS.Timeout | undefined
      try {
        return await Promise.race([
          held.promise,
          new Promise<PatchRequest>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('PATCH did not reach the database proxy')), timeoutMs)
          }),
        ])
      } finally {
        if (timer) clearTimeout(timer)
      }
    },
    release() { releaseWrite.resolve() },
    close: () => new Promise<void>((resolveClose, reject) => {
      releaseWrite.resolve()
      server.close(error => error ? reject(error) : resolveClose())
    }),
  }
}

export type StartedNextServer = {
  url: string
  stop: () => Promise<void>
}

async function waitForNext(child: ChildProcess, url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  let childError: Error | null = null
  child.once('error', error => { childError = error })

  while (Date.now() < deadline) {
    if (childError) throw childError
    if (child.exitCode !== null) throw new Error(`Next server exited with code ${child.exitCode}`)
    try {
      const response = await fetch(`${url}/login`, { redirect: 'manual' })
      if (response.status >= 200 && response.status < 500) return
    } catch {
      // The listener is not ready yet.
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 200))
  }
  throw new Error('Dedicated Next server did not become ready')
}

async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit').then(() => undefined)
  child.kill('SIGTERM')
  let timer: NodeJS.Timeout | undefined
  const grace = new Promise<'timeout'>(resolveGrace => { timer = setTimeout(() => resolveGrace('timeout'), 5_000) })
  const result = await Promise.race([exited.then(() => 'exit' as const), grace])
  if (timer) clearTimeout(timer)
  if (result === 'timeout') {
    child.kill('SIGKILL')
    await exited
  }
}

/** Starts a production Next server with server-side Supabase HTTP pointed at the test proxy. */
export async function startDedicatedNext(config: E2EConfig, proxyUrl: string): Promise<StartedNextServer> {
  const port = await availablePort()
  const url = `http://127.0.0.1:${port}`
  const nextBin = resolve(process.cwd(), 'node_modules/next/dist/bin/next')
  const env = {
    ...process.env,
    SUPABASE_URL: proxyUrl,
    SUPABASE_ANON_KEY: config.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
    NEXT_PUBLIC_SUPABASE_URL: config.supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: config.anonKey,
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
    NEXT_TELEMETRY_DISABLED: '1',
  }
  const child = spawn(process.execPath, [nextBin, 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: process.cwd(),
    env,
    stdio: 'ignore',
    windowsHide: true,
  })

  try {
    await waitForNext(child, url, 60_000)
  } catch (error) {
    await stopProcess(child).catch(() => undefined)
    throw error
  }

  return { url, stop: () => stopProcess(child) }
}
