/**
 * util-swagger.test.ts — Coverage for src/util/swagger.ts
 *
 * Covers:
 *   GET /api-docs/          — Swagger UI HTML page returns 200
 *   GET /api-docs/openapi.json — Returns JSON spec with openapi: '3.0.3'
 */
import request  from 'supertest'
import express  from 'express'

process.env.NODE_ENV = 'test'

// ── Mock logger (swagger-jsdoc may indirectly trigger logger) ─────────────────
jest.mock('../util/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

import { swaggerRouter } from '../util/swagger'

// ── App builder ───────────────────────────────────────────────────────────────

function buildApp() {
  const app = express()
  app.use('/api-docs', swaggerRouter)
  return app
}

// ═════════════════════════════════════════════════════════════════════════════
// Swagger UI endpoint
// ═════════════════════════════════════════════════════════════════════════════

describe('swaggerRouter GET /', () => {
  it('returns 200 with HTML content (Swagger UI page)', async () => {
    const res = await request(buildApp()).get('/api-docs/')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/html/)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// OpenAPI JSON spec endpoint
// ═════════════════════════════════════════════════════════════════════════════

describe('swaggerRouter GET /openapi.json', () => {
  it('returns 200 with JSON content-type', async () => {
    const res = await request(buildApp()).get('/api-docs/openapi.json')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
  })

  it('returns spec with openapi: 3.0.3', async () => {
    const res = await request(buildApp()).get('/api-docs/openapi.json')

    expect(res.body.openapi).toBe('3.0.3')
  })

  it('returns spec with correct API title', async () => {
    const res = await request(buildApp()).get('/api-docs/openapi.json')

    expect(res.body.info.title).toBe('OrchestratePay API')
    expect(res.body.info.version).toBe('1.0.0')
  })

  it('returns spec with expected paths (settlements, kyc, auth)', async () => {
    const res = await request(buildApp()).get('/api-docs/openapi.json')

    expect(res.body.paths).toHaveProperty('/settlements')
    expect(res.body.paths).toHaveProperty('/kyc/documents')
    expect(res.body.paths).toHaveProperty('/auth/login')
  })

  it('returns spec with BearerAuth security scheme', async () => {
    const res = await request(buildApp()).get('/api-docs/openapi.json')

    expect(res.body.components.securitySchemes).toHaveProperty('BearerAuth')
    expect(res.body.components.securitySchemes.BearerAuth.type).toBe('http')
    expect(res.body.components.securitySchemes.BearerAuth.scheme).toBe('bearer')
  })

  it('returns spec with Transaction, Settlement, and Merchant schemas', async () => {
    const res = await request(buildApp()).get('/api-docs/openapi.json')

    expect(res.body.components.schemas).toHaveProperty('Transaction')
    expect(res.body.components.schemas).toHaveProperty('Settlement')
    expect(res.body.components.schemas).toHaveProperty('Merchant')
  })
})
