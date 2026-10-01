/*
 * Appellate Practice Simulator — federal appellate procedure training.
 * Copyright (C) 2026 Rhajune Park
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { get } from 'node:http'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const commandTimeoutMs = 120_000
const previewTimeoutMs = 45_000
const maxCapturedOutput = 64_000

type ChildResult = { code: number | null; signal: NodeJS.Signals | null }

function appendOutput(current: string, chunk: Buffer) {
  const combined = current + chunk.toString('utf8')
  return combined.length > maxCapturedOutput ? combined.slice(-maxCapturedOutput) : combined
}

function createSmokeEnvironment(tempHome: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}),
    HOME: tempHome,
    XDG_CONFIG_HOME: join(tempHome, 'config'),
    TMPDIR: tempHome,
    TMP: tempHome,
    TEMP: tempHome,
    CI: 'true',
    DEPLOY_TARGET: 'cloudflare',
    VITE_CONVEX_URL: 'https://smoke.invalid',
    VITE_ENABLE_COURTLISTENER: 'false',
    VITE_ENABLE_OPENROUTER: 'false',
    CLOUDFLARE_CF_FETCH_ENABLED: 'false',
    WRANGLER_SEND_METRICS: 'false',
  }
}

function launchBun(args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  let spawnError: Error | undefined
  child.stdout?.on('data', (chunk: Buffer) => {
    output = appendOutput(output, chunk)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    output = appendOutput(output, chunk)
  })
  child.on('error', (error) => {
    spawnError = error
  })

  const closed = once(child, 'close').then(([code, signal]) => ({
    code: code as number | null,
    signal: signal as NodeJS.Signals | null,
  }))

  return {
    child,
    get output() {
      return output
    },
    get spawnError() {
      return spawnError
    },
    closed,
  }
}

function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals) {
  if (child.pid === undefined) return
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

async function stopProcess(child: ChildProcess, closed: Promise<ChildResult>) {
  if (child.exitCode !== null || child.signalCode !== null) return

  signalProcessTree(child, 'SIGTERM')
  const stopped = await Promise.race([
    closed.then(() => true),
    new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 3_000)
      timer.unref()
    }),
  ])
  if (!stopped) {
    signalProcessTree(child, 'SIGKILL')
    await Promise.race([
      closed,
      new Promise((resolve) => {
        const timer = setTimeout(resolve, 2_000)
        timer.unref()
      }),
    ])
  }
}

async function runBuild(env: NodeJS.ProcessEnv) {
  const command = launchBun(['run', 'build:cloudflare'], env)
  const timeout = new Promise<never>((_, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Cloudflare build timed out.')),
      commandTimeoutMs,
    )
    timer.unref()
  })

  try {
    const result = await Promise.race([command.closed, timeout])
    if (command.spawnError) throw command.spawnError
    if (result.code !== 0) {
      throw new Error(`Cloudflare build exited ${result.code ?? result.signal}.\n${command.output}`)
    }
  } catch (error) {
    await stopProcess(command.child, command.closed)
    throw new Error(`${String(error)}\n${command.output}`)
  }
}

async function reserveLoopbackPort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Could not reserve a local preview port.')
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
  return address.port
}

function requestLocal(url: string) {
  return new Promise<{
    status: number
    headers: Record<string, string | string[] | undefined>
    body: string
  }>((resolve, reject) => {
    const request = get(url, { timeout: 2_000 }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => {
        body += chunk
        if (body.length > 64_000) request.destroy(new Error('Local smoke response exceeded 64 KB.'))
      })
      response.on('end', () => {
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body,
        })
      })
    })
    request.on('timeout', () => request.destroy(new Error('Local preview request timed out.')))
    request.on('error', reject)
  })
}

async function waitForLocalWorker(
  preview: ReturnType<typeof launchBun>,
  origin: string,
  expectedBody: string,
) {
  const deadline = Date.now() + previewTimeoutMs
  let latestError = 'Preview did not become ready.'

  while (Date.now() < deadline) {
    if (preview.child.exitCode !== null) {
      throw new Error(`Cloudflare preview exited ${preview.child.exitCode}.\n${preview.output}`)
    }
    if (preview.spawnError) throw preview.spawnError

    try {
      const response = await requestLocal(`${origin}/robots.txt`)
      const cacheStatus = response.headers['cf-cache-status']
      if (response.status === 200 && response.body === expectedBody && cacheStatus === 'HIT') {
        const localWorkers = await requestLocal(
          `${origin}/cdn-cgi/local/explorer/api/local/workers`,
        )
        const workerReport = JSON.parse(localWorkers.body) as {
          success?: boolean
          result?: Array<{ isSelf?: boolean; name?: string }>
        }
        if (
          localWorkers.status === 200 &&
          workerReport.success === true &&
          workerReport.result?.some((worker) => worker.isSelf && worker.name === 'appellate-prac')
        ) {
          return
        }
        latestError = 'Cloudflare local Explorer did not report the expected local app Worker.'
      } else {
        latestError = `Local preview returned status ${response.status}, cf-cache-status ${String(cacheStatus)}, and ${response.body.length} body characters.`
      }
    } catch (error) {
      latestError = String(error)
    }

    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  throw new Error(`${latestError}\n${preview.output}`)
}

async function main() {
  const tempHome = await mkdtemp(join(tmpdir(), 'appellate-cloudflare-smoke-'))
  await mkdir(join(tempHome, 'config'), { recursive: true })
  const env = createSmokeEnvironment(tempHome)
  let preview: ReturnType<typeof launchBun> | undefined

  try {
    await runBuild(env)

    const expectedBody = await readFile(join(process.cwd(), 'public', 'robots.txt'), 'utf8')
    const port = await reserveLoopbackPort()
    preview = launchBun(
      ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      env,
    )
    await waitForLocalWorker(preview, `http://127.0.0.1:${port}`, expectedBody)
    console.log(
      `Cloudflare preview smoke passed: Miniflare reported the local appellate-prac Worker, which served /robots.txt (200, cf-cache-status HIT); CF metadata fetch and app provider credentials were disabled.`,
    )
  } finally {
    if (preview) await stopProcess(preview.child, preview.closed)
    await rm(tempHome, { recursive: true, force: true })
  }
}

await main()
