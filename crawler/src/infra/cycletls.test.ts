/* eslint-disable no-void -- node:test の登録 Promise はテストランナーに委ねる。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { isCycleTLSTransportError } from './cycletls'

void test('detects the CycleTLS transport-error shape (empty headers + string data)', () => {
  assert.equal(
    isCycleTLSTransportError({
      headers: {},
      data: 'read tcp 10.0.0.1:443: i/o timeout',
    }),
    true
  )
})

void test('does not flag a normal JSON response with headers', () => {
  assert.equal(
    isCycleTLSTransportError({
      headers: { 'content-type': 'application/json' },
      data: { ok: true },
    }),
    false
  )
})

void test('does not flag an HTTP error response (4xx/5xx/429) that still carries headers', () => {
  assert.equal(
    isCycleTLSTransportError({
      headers: { 'content-type': ['application/json'] },
      data: { errors: [{ code: 88, message: 'Rate limit exceeded' }] },
    }),
    false
  )
})

void test('does not flag empty headers when data is not a string (e.g. already-parsed JSON object)', () => {
  assert.equal(
    isCycleTLSTransportError({
      headers: {},
      data: { some: 'object' },
    }),
    false
  )
})
