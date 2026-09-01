/* eslint-disable no-void -- node:test の登録 Promise はテストランナーに委ねる。 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Scraper } from '@the-convocation/twitter-scraper'
import {
  getAuthCookies,
  loadCachedCookies,
  loginWithRetry,
  saveCookies,
} from './auth'
import type { AccountConfig } from '../shared/types'

const dataDir = process.env.DATA_DIR ?? ''
if (!dataDir.startsWith(os.tmpdir())) {
  throw new Error('DATA_DIR must be an isolated temporary directory')
}

const account = (username: string): AccountConfig => ({
  email: `${username}@example.com`,
  username,
  password: 'test-password',
  otp_secret: 'test-otp-secret',
})

// Scraper の実装を置き換えるテストのため、メソッドを値として保存する。
// eslint-disable-next-line @typescript-eslint/unbound-method
const originalLogin = Scraper.prototype.login
const originalFetch = fetch
const originalSetTimeout = setTimeout

function setLogin(login: typeof Scraper.prototype.login): void {
  Scraper.prototype.login = login
}

function setFetch(fetchImplementation: typeof fetch): void {
  // fetch はグローバルプロパティを置き換えないとテストできない。
  globalThis.fetch = fetchImplementation
}

function useImmediateTimers(): void {
  // setTimeout はグローバルプロパティを置き換えないとリトライ待機を省略できない。
  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    _delay?: number,
    ...args: unknown[]
  ) => {
    callback(...args)
    return originalSetTimeout(() => undefined, 0)
  }) as unknown as typeof setTimeout
}

function reset(username: string): void {
  Reflect.deleteProperty(
    process.env,
    `TWITTER_AUTH_TOKEN_${username.toUpperCase()}`
  )
  Reflect.deleteProperty(process.env, `TWITTER_CT0_${username.toUpperCase()}`)
  Reflect.deleteProperty(process.env, 'TWITTER_COOKIE_ISSUER_URL')
  fs.rmSync(path.join(dataDir, `cookies-${username}.json`), { force: true })
}

function captureOutput(): () => string {
  let output = ''
  // stdout/stderr の write はログ出力を監視するために置き換える。
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalStdoutWrite = process.stdout.write
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalStderrWrite = process.stderr.write
  process.stdout.write = (chunk: unknown) => {
    output += String(chunk)
    return true
  }
  process.stderr.write = (chunk: unknown) => {
    output += String(chunk)
    return true
  }

  return () => {
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    return output
  }
}

test.after(() => {
  setLogin(originalLogin)
  setFetch(originalFetch)
  globalThis.setTimeout = originalSetTimeout
  fs.rmSync(dataDir, { recursive: true, force: true })
})

void test('environment cookies prevent issuer and credential login', async () => {
  const username = 'env_priority'
  reset(username)
  process.env[`TWITTER_AUTH_TOKEN_${username.toUpperCase()}`] = 'env-auth'
  process.env[`TWITTER_CT0_${username.toUpperCase()}`] = 'env-ct0'
  process.env.TWITTER_COOKIE_ISSUER_URL = 'https://issuer.invalid'
  let issuerCalls = 0
  let loginCalls = 0
  setFetch(() => {
    issuerCalls++
    return Promise.reject(new Error('issuer must not be called'))
  })
  setLogin(() => {
    loginCalls++
    return Promise.reject(new Error('credential login must not be called'))
  })

  assert.deepEqual(await getAuthCookies(account(username)), {
    authToken: 'env-auth',
    ct0: 'env-ct0',
  })
  assert.equal(issuerCalls, 0)
  assert.equal(loginCalls, 0)
})

void test('cached cookies prevent issuer and credential login', async () => {
  const username = 'cache_priority'
  reset(username)
  saveCookies(username, 'cached-auth', 'cached-ct0')
  process.env.TWITTER_COOKIE_ISSUER_URL = 'https://issuer.invalid'
  let issuerCalls = 0
  let loginCalls = 0
  setFetch(() => {
    issuerCalls++
    return Promise.reject(new Error('issuer must not be called'))
  })
  setLogin(() => {
    loginCalls++
    return Promise.reject(new Error('credential login must not be called'))
  })

  assert.deepEqual(await getAuthCookies(account(username)), {
    authToken: 'cached-auth',
    ct0: 'cached-ct0',
  })
  assert.equal(issuerCalls, 0)
  assert.equal(loginCalls, 0)
})

void test('configured issuer returns and caches cookies without credential login', async () => {
  const username = 'issuer_success'
  reset(username)
  process.env.TWITTER_COOKIE_ISSUER_URL = 'https://issuer.invalid'
  let issuerCalls = 0
  let loginCalls = 0
  setFetch((input, init) => {
    issuerCalls++
    assert.equal(input, 'https://issuer.invalid/login')
    if (!init) {
      throw new Error('issuer request options are required')
    }
    assert.equal(init.method, 'POST')
    assert.equal(typeof init.body, 'string')
    if (typeof init.body !== 'string') {
      throw new TypeError('issuer request body must be a string')
    }
    assert.deepEqual(JSON.parse(init.body), {
      username,
      password: 'test-password',
      otp_secret: 'test-otp-secret',
    })
    return Promise.resolve(
      Response.json({ auth_token: 'issued-auth', ct0: 'issued-ct0' })
    )
  })
  setLogin(() => {
    loginCalls++
    return Promise.reject(new Error('credential login must not be called'))
  })

  assert.deepEqual(await getAuthCookies(account(username)), {
    authToken: 'issued-auth',
    ct0: 'issued-ct0',
  })
  assert.equal(issuerCalls, 1)
  assert.equal(loginCalls, 0)
  const cached = loadCachedCookies(username)
  assert.deepEqual(
    cached && {
      auth_token: 'issued-auth',
      ct0: 'issued-ct0',
    },
    {
      auth_token: 'issued-auth',
      ct0: 'issued-ct0',
    }
  )
  assert.equal(typeof cached?.savedAt, 'number')
})

void test('399 stops after one credential attempt', async () => {
  const username = 'error_399_once'
  reset(username)
  let loginCalls = 0
  setLogin(() => {
    loginCalls++
    return Promise.reject(new Error('HTTP 399'))
  })
  useImmediateTimers()

  await assert.rejects(loginWithRetry(account(username)), /399/)
  assert.equal(loginCalls, 1)
})

void test('399 establishes an account-specific credential login cooldown', async () => {
  const username = 'error_399_cooldown'
  const otherUsername = 'error_399_other_account'
  reset(username)
  reset(otherUsername)
  let loginCalls = 0
  setLogin(() => {
    loginCalls++
    return Promise.reject(new Error('HTTP 399'))
  })
  useImmediateTimers()

  await assert.rejects(getAuthCookies(account(username)), /399/)
  await assert.rejects(getAuthCookies(account(username)), /cooldown/i)
  await assert.rejects(getAuthCookies(account(otherUsername)), /399/)
  assert.equal(loginCalls, 2)
})

void test('503 errors still retry', async () => {
  const username = 'retry_503'
  reset(username)
  let loginCalls = 0
  setLogin(() => {
    loginCalls++
    if (loginCalls === 1) {
      return Promise.reject(new Error('503 Service Unavailable'))
    }
    return Promise.resolve()
  })
  useImmediateTimers()

  await loginWithRetry(account(username), 2)
  assert.equal(loginCalls, 2)
})

void test('DenyLoginSubtask errors still retry', async () => {
  const username = 'retry_deny'
  reset(username)
  let loginCalls = 0
  setLogin(() => {
    loginCalls++
    if (loginCalls === 1) {
      return Promise.reject(new Error('DenyLoginSubtask'))
    }
    return Promise.resolve()
  })
  useImmediateTimers()

  await loginWithRetry(account(username), 2)
  assert.equal(loginCalls, 2)
})

void test('issuer and 399 logging do not expose supplied secrets', async () => {
  const username = 'logging_secrets'
  reset(username)
  process.env.TWITTER_COOKIE_ISSUER_URL = 'https://issuer.invalid'
  const issuerSecret = 'issuer-error-secret'
  const restoreOutput = captureOutput()
  setFetch(() => Promise.reject(new Error(issuerSecret)))
  setLogin(() => Promise.reject(new Error(`HTTP 399 ${issuerSecret}`)))
  useImmediateTimers()

  let output = ''
  try {
    await assert.rejects(getAuthCookies(account(username)), /399/)
  } finally {
    output = restoreOutput()
  }

  assert.equal(output.includes('test-password'), false)
  assert.equal(output.includes('test-otp-secret'), false)
  assert.equal(output.includes(issuerSecret), false)
})
