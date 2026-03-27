import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const app = new Hono()

app.all('/test/*', (c) => {
  console.log('c.req.url:', c.req.url)
  console.log('c.req.path:', c.req.path)
  console.log('typeof c.req.url:', typeof c.req.url)
  
  // Try to see if it's absolute or relative
  try {
    const url = new URL(c.req.url)
    console.log('new URL() succeeded - c.req.url is absolute')
  } catch (e) {
    console.log('new URL() failed - c.req.url is relative or malformed')
    console.log('Error:', (e as Error).message)
  }
  
  return c.json({ url: c.req.url })
})

serve({ fetch: app.fetch, port: 3999 }, () => {
  console.log('Test server running on port 3999')
})
