/**
 * Unit tests for middleware/request-id.ts — correlation ID middleware.
 */
import request from 'supertest'
import express from 'express'

process.env.NODE_ENV = 'test'

import { requestId } from '../middleware/request-id'

function buildApp() {
  const app = express()
  app.use(requestId)
  app.get('/test', (req: any, res) => res.json({ id: req.id }))
  return app
}

describe('requestId middleware', () => {
  it('generates a UUID and attaches it to req.id', async () => {
    const res = await request(buildApp()).get('/test')
    expect(res.status).toBe(200)
    expect(res.body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  })

  it('sets X-Request-Id response header matching req.id', async () => {
    const res = await request(buildApp()).get('/test')
    expect(res.headers['x-request-id']).toBe(res.body.id)
  })

  it('honours X-Request-Id from the incoming request', async () => {
    const existingId = 'my-correlation-id-12345'
    const res = await request(buildApp())
      .get('/test')
      .set('X-Request-Id', existingId)
    expect(res.body.id).toBe(existingId)
    expect(res.headers['x-request-id']).toBe(existingId)
  })

  it('generates a fresh UUID when X-Request-Id header is absent', async () => {
    const res1 = await request(buildApp()).get('/test')
    const res2 = await request(buildApp()).get('/test')
    // Two separate requests should get different IDs
    expect(res1.body.id).not.toBe(res2.body.id)
  })
})
