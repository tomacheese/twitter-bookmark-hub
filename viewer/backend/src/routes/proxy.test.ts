import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { analyzerProxyRoute } from './proxy'

const originalFetch = fetch
const originalAnalyzerUrl = process.env.ANALYZER_URL

after(() => {
  globalThis.fetch = originalFetch
  if (originalAnalyzerUrl === undefined) delete process.env.ANALYZER_URL
  else process.env.ANALYZER_URL = originalAnalyzerUrl
})

void test('プロキシは本文を持たないステータスをそのまま返す', async () => {
  process.env.ANALYZER_URL = 'http://analyzer.test'
  for (const status of [204, 205, 304]) {
    globalThis.fetch = () => Promise.resolve(new Response(null, { status }))
    const response = await analyzerProxyRoute().request('/api/categories/1', {
      method: 'DELETE',
    })
    assert.equal(response.status, status)
    assert.equal(response.body, null)
  }
})

void test('本文とステータスを転送する', async () => {
  process.env.ANALYZER_URL = 'http://analyzer.test'
  globalThis.fetch = () =>
    Promise.resolve(Response.json({ error: 'Not found' }, { status: 404 }))
  const response = await analyzerProxyRoute().request('/api/categories/1')
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), { error: 'Not found' })
})
