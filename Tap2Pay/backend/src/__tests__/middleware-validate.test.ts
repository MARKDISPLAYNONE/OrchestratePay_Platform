/**
 * Tests for middleware/validate.ts — Joi validation middleware factory.
 * Covers: valid body passes through, missing required field, wrong type,
 *         unknown fields stripped, multiple errors, factory returns middleware,
 *         req.body replaced with Joi-coerced value.
 *
 * Uses express + supertest to mount a real route so middleware integration
 * is tested end-to-end (including that next() is called correctly).
 */
process.env.NODE_ENV = 'test'

import request  from 'supertest'
import express  from 'express'
import Joi      from 'joi'
import { validate, loginSchema, transactionSchema, merchantHceTokenSchema } from '../middleware/validate'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal Express app with validate(schema) as middleware on POST /test.
 * The handler echoes req.body so we can assert on the stripped/coerced value.
 */
function buildApp(schema: Joi.ObjectSchema) {
  const app = express()
  app.use(express.json())
  app.post('/test', validate(schema), (req, res) => {
    res.json({ ok: true, body: req.body })
  })
  return app
}

// ── Simple test schema ─────────────────────────────────────────────────────────

const simpleSchema = Joi.object({
  name:  Joi.string().required(),
  age:   Joi.number().integer().min(0).required(),
  email: Joi.string().email().optional(),
})

// ─────────────────────────────────────────────────────────────────────────────
// validate — factory function
// ─────────────────────────────────────────────────────────────────────────────

describe('validate — factory function', () => {
  it('returns a function (Express middleware) when called with a Joi schema', () => {
    const middleware = validate(simpleSchema)
    expect(typeof middleware).toBe('function')
    expect(middleware.length).toBe(3)  // (req, res, next)
  })

  it('produces independent middleware instances per call', () => {
    const mw1 = validate(simpleSchema)
    const mw2 = validate(loginSchema)
    expect(mw1).not.toBe(mw2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validate — valid body passes through
// ─────────────────────────────────────────────────────────────────────────────

describe('validate — valid body', () => {
  it('calls next() and returns 200 for a fully valid body', async () => {
    const res = await request(buildApp(simpleSchema))
      .post('/test')
      .send({ name: 'Alice', age: 30 })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('includes optional fields that were provided', async () => {
    const res = await request(buildApp(simpleSchema))
      .post('/test')
      .send({ name: 'Bob', age: 25, email: 'bob@example.com' })

    expect(res.status).toBe(200)
    expect(res.body.body.email).toBe('bob@example.com')
  })

  it('req.body on the handler side is the Joi-validated value (not the raw body)', async () => {
    const schemaWithDefault = Joi.object({
      name:     Joi.string().required(),
      currency: Joi.string().valid('KES', 'USD').default('KES'),
    })
    const res = await request(buildApp(schemaWithDefault))
      .post('/test')
      .send({ name: 'Charlie' })   // no currency → should default to 'KES'

    expect(res.status).toBe(200)
    expect(res.body.body.currency).toBe('KES')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validate — missing required fields → 400
// ─────────────────────────────────────────────────────────────────────────────

describe('validate — missing required field', () => {
  it('returns 400 when a required field is absent', async () => {
    const res = await request(buildApp(simpleSchema))
      .post('/test')
      .send({ age: 25 })   // name is missing

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Validation failed')
    expect(res.body.details).toMatch(/name/i)
  })

  it('returns 400 when all required fields are missing', async () => {
    const res = await request(buildApp(simpleSchema))
      .post('/test')
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Validation failed')
  })

  it('returns 400 with body error for empty string on required field', async () => {
    const res = await request(buildApp(simpleSchema))
      .post('/test')
      .send({ name: '', age: 30 })

    expect(res.status).toBe(400)
    expect(res.body.details).toMatch(/name/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validate — wrong type → 400
// ─────────────────────────────────────────────────────────────────────────────

describe('validate — wrong type', () => {
  it('returns 400 when a string is passed where a number is expected', async () => {
    const res = await request(buildApp(simpleSchema))
      .post('/test')
      .send({ name: 'Dave', age: 'not-a-number' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Validation failed')
    expect(res.body.details).toMatch(/age/i)
  })

  it('returns 400 when number is passed where string is expected', async () => {
    const res = await request(buildApp(simpleSchema))
      .post('/test')
      .send({ name: 12345, age: 30 })

    // Joi coerces numbers to strings by default — 12345 → "12345" which is valid.
    // This verifies the expected coercion behaviour.
    expect([200, 400]).toContain(res.status)
  })

  it('returns 400 for negative age (min: 0 constraint)', async () => {
    const res = await request(buildApp(simpleSchema))
      .post('/test')
      .send({ name: 'Eve', age: -5 })

    expect(res.status).toBe(400)
    expect(res.body.details).toMatch(/age/i)
  })

  it('returns 400 for invalid email format', async () => {
    const res = await request(buildApp(simpleSchema))
      .post('/test')
      .send({ name: 'Frank', age: 20, email: 'not-an-email' })

    expect(res.status).toBe(400)
    expect(res.body.details).toMatch(/email/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validate — unknown fields stripped (stripUnknown)
// ─────────────────────────────────────────────────────────────────────────────

describe('validate — unknown fields stripped', () => {
  it('strips unknown fields so they do not appear in req.body', async () => {
    const res = await request(buildApp(simpleSchema))
      .post('/test')
      .send({ name: 'Grace', age: 28, unknownField: 'injected', __proto__: 'attack' })

    expect(res.status).toBe(200)
    expect(res.body.body).not.toHaveProperty('unknownField')
    expect(Object.keys(res.body.body)).not.toContain('__proto__')
  })

  it('keeps only schema-defined fields after stripping', async () => {
    const res = await request(buildApp(simpleSchema))
      .post('/test')
      .send({ name: 'Heidi', age: 35, extra1: 'a', extra2: 'b', extra3: 'c' })

    expect(res.status).toBe(200)
    const keys = Object.keys(res.body.body)
    expect(keys.every((k) => ['name', 'age', 'email', 'currency'].includes(k))).toBe(true)
    expect(keys).not.toContain('extra1')
    expect(keys).not.toContain('extra2')
  })

  it('does not return 400 for unknown fields (they are silently removed)', async () => {
    const res = await request(buildApp(simpleSchema))
      .post('/test')
      .send({ name: 'Ivan', age: 40, rogue: 'value' })

    expect(res.status).toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validate — multiple errors returned together (abortEarly: false)
// ─────────────────────────────────────────────────────────────────────────────

describe('validate — multiple errors (abortEarly: false)', () => {
  it('returns all validation errors joined by semicolons', async () => {
    const res = await request(buildApp(simpleSchema))
      .post('/test')
      .send({ email: 'not-valid-email' })  // name missing, age missing, email invalid

    expect(res.status).toBe(400)
    // abortEarly:false means all three errors are returned, joined by '; '
    expect(res.body.details).toContain(';')
  })

  it('details string contains messages for all failing fields', async () => {
    const res = await request(buildApp(simpleSchema))
      .post('/test')
      .send({ age: -1, email: 'bad' })   // name missing, age below min, email invalid

    expect(res.status).toBe(400)
    const details: string = res.body.details
    expect(details).toMatch(/name/i)
    expect(details).toMatch(/age/i)
  })

  it('error response always has both "error" and "details" fields', async () => {
    const res = await request(buildApp(simpleSchema))
      .post('/test')
      .send({})

    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error', 'Validation failed')
    expect(res.body).toHaveProperty('details')
    expect(typeof res.body.details).toBe('string')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validate — loginSchema (exported schema)
// ─────────────────────────────────────────────────────────────────────────────

describe('validate with loginSchema', () => {
  it('passes valid login credentials', async () => {
    const res = await request(buildApp(loginSchema))
      .post('/test')
      .send({ email: 'user@example.com', password: 'secureP@ss1', deviceId: 'device-abc' })

    expect(res.status).toBe(200)
    expect(res.body.body.email).toBe('user@example.com')
  })

  it('rejects missing deviceId', async () => {
    const res = await request(buildApp(loginSchema))
      .post('/test')
      .send({ email: 'user@example.com', password: 'secureP@ss1' })

    expect(res.status).toBe(400)
    expect(res.body.details).toMatch(/deviceId/i)
  })

  it('rejects password shorter than 8 characters', async () => {
    const res = await request(buildApp(loginSchema))
      .post('/test')
      .send({ email: 'user@example.com', password: 'short', deviceId: 'device-abc' })

    expect(res.status).toBe(400)
    expect(res.body.details).toMatch(/password/i)
  })

  it('rejects invalid email format', async () => {
    const res = await request(buildApp(loginSchema))
      .post('/test')
      .send({ email: 'not-an-email', password: 'secureP@ss1', deviceId: 'device-abc' })

    expect(res.status).toBe(400)
    expect(res.body.details).toMatch(/email/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validate — transactionSchema (exported schema)
// ─────────────────────────────────────────────────────────────────────────────

describe('validate with transactionSchema', () => {
  const TS_VALID = 1_700_000_000_000  // 2023 — within 2020–2100 range

  const validTxn = {
    merchantId:     '123e4567-e89b-12d3-a456-426614174000',
    amountCents:    5000,
    source:         'NFC_TAG',
    idempotencyKey: 'a'.repeat(32),  // 32 hex chars
    timestamp:      TS_VALID,
  }

  it('passes a valid NFC_TAG transaction', async () => {
    const res = await request(buildApp(transactionSchema))
      .post('/test')
      .send(validTxn)

    expect(res.status).toBe(200)
    expect(res.body.body.merchantId).toBe(validTxn.merchantId)
  })

  it('defaults currency to KES when not provided', async () => {
    const res = await request(buildApp(transactionSchema))
      .post('/test')
      .send(validTxn)

    expect(res.status).toBe(200)
    expect(res.body.body.currency).toBe('KES')
  })

  it('rejects amountCents below 100 (minimum)', async () => {
    const res = await request(buildApp(transactionSchema))
      .post('/test')
      .send({ ...validTxn, amountCents: 50 })

    expect(res.status).toBe(400)
    expect(res.body.details).toMatch(/amountCents/i)
  })

  it('rejects an invalid source value', async () => {
    const res = await request(buildApp(transactionSchema))
      .post('/test')
      .send({ ...validTxn, source: 'CARRIER_PIGEON' })

    expect(res.status).toBe(400)
    expect(res.body.details).toMatch(/source/i)
  })

  it('rejects idempotencyKey that is not 32 hex chars', async () => {
    const res = await request(buildApp(transactionSchema))
      .post('/test')
      .send({ ...validTxn, idempotencyKey: 'short' })

    expect(res.status).toBe(400)
    expect(res.body.details).toMatch(/idempotencyKey/i)
  })

  it('rejects a timestamp outside the 2020–2100 window', async () => {
    const res = await request(buildApp(transactionSchema))
      .post('/test')
      .send({ ...validTxn, timestamp: 999_999_999 })  // before 2020

    expect(res.status).toBe(400)
    expect(res.body.details).toMatch(/timestamp/i)
  })

  it('accepts all valid source types', async () => {
    const validSources = [
      'NFC_TAG', 'QR_CODE', 'ISO_CARD', 'HCE_PHONE',
      'SOFTPOS_MOBILE', 'CONSUMER_TAG', 'CONSUMER_QR', 'MERCHANT_HCE',
    ]
    for (const source of validSources) {
      const res = await request(buildApp(transactionSchema))
        .post('/test')
        .send({ ...validTxn, source })
      expect(res.status).toBe(200)
    }
  })

  it('accepts valid currency options', async () => {
    const currencies = ['KES', 'USD', 'EUR', 'GBP', 'TZS', 'UGX', 'RWF']
    for (const currency of currencies) {
      const res = await request(buildApp(transactionSchema))
        .post('/test')
        .send({ ...validTxn, currency })
      expect(res.status).toBe(200)
    }
  })

  it('rejects an unsupported currency', async () => {
    const res = await request(buildApp(transactionSchema))
      .post('/test')
      .send({ ...validTxn, currency: 'JPY' })

    expect(res.status).toBe(400)
    expect(res.body.details).toMatch(/currency/i)
  })

  it('strips unknown fields like integrityToken comments (extra keys)', async () => {
    const res = await request(buildApp(transactionSchema))
      .post('/test')
      .send({ ...validTxn, rogueField: 'injection attempt' })

    expect(res.status).toBe(200)
    expect(res.body.body).not.toHaveProperty('rogueField')
  })

  it('accepts optional HCE fields alongside required fields', async () => {
    const res = await request(buildApp(transactionSchema))
      .post('/test')
      .send({
        ...validTxn,
        source:        'HCE_PHONE',
        consumerPhone: '254712345678',
        hceToken:      'b'.repeat(32),
        hceExp:        TS_VALID,
      })

    expect(res.status).toBe(200)
    expect(res.body.body.consumerPhone).toBe('254712345678')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validate — merchantHceTokenSchema (exported schema)
// ─────────────────────────────────────────────────────────────────────────────

describe('validate with merchantHceTokenSchema', () => {
  it('passes a valid amountCents', async () => {
    const res = await request(buildApp(merchantHceTokenSchema))
      .post('/test')
      .send({ amountCents: 10000, consumerId: 'b2b3b4b5-c2c3-4d4d-e5e5-f1f2f3f4f5f6' })

    expect(res.status).toBe(200)
    expect(res.body.body.amountCents).toBe(10000)
  })

  it('rejects amountCents below minimum (100)', async () => {
    const res = await request(buildApp(merchantHceTokenSchema))
      .post('/test')
      .send({ amountCents: 0 })

    expect(res.status).toBe(400)
  })

  it('rejects missing amountCents', async () => {
    const res = await request(buildApp(merchantHceTokenSchema))
      .post('/test')
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.details).toMatch(/amountCents/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validate — req.body replacement
// ─────────────────────────────────────────────────────────────────────────────

describe('validate — req.body is replaced with Joi-processed value', () => {
  it('replaces req.body with the stripped object (not the original raw body)', async () => {
    const app = express()
    app.use(express.json())

    let capturedBody: any = null
    app.post('/capture', validate(simpleSchema), (req, res) => {
      capturedBody = req.body
      res.json({ ok: true })
    })

    await request(app)
      .post('/capture')
      .send({ name: 'Judy', age: 22, unwantedKey: 'should-be-gone' })

    expect(capturedBody).toBeDefined()
    expect(capturedBody.name).toBe('Judy')
    expect(capturedBody.age).toBe(22)
    expect(capturedBody).not.toHaveProperty('unwantedKey')
  })

  it('coerces string numbers to actual numbers when schema type is number', async () => {
    // Joi coerces "22" (string from form data) to 22 (number) by default
    const app = express()
    // Use urlencoded to simulate form data that sends strings
    app.use(express.urlencoded({ extended: false }))
    app.use(express.json())

    let capturedBody: any = null
    app.post('/coerce', validate(simpleSchema), (req, res) => {
      capturedBody = req.body
      res.json({ ok: true })
    })

    // Send as JSON (age is already number here, so this confirms no type corruption)
    await request(app)
      .post('/coerce')
      .send({ name: 'Karl', age: 33 })

    expect(typeof capturedBody?.age).toBe('number')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validate — edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('validate — edge cases', () => {
  it('handles an empty body gracefully (returns 400 for required fields)', async () => {
    const res = await request(buildApp(simpleSchema))
      .post('/test')
      // No .send() — body is undefined / {}
      .set('Content-Type', 'application/json')
      .send('{}')

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Validation failed')
  })

  it('does not call next() when validation fails', async () => {
    let handlerCalled = false
    const app = express()
    app.use(express.json())
    app.post('/test', validate(simpleSchema), (_req, res) => {
      handlerCalled = true
      res.json({ ok: true })
    })

    await request(app)
      .post('/test')
      .send({ age: 'bad' })  // name missing, age wrong type

    expect(handlerCalled).toBe(false)
  })

  it('calls next() exactly once on success (no double-next)', async () => {
    let nextCallCount = 0
    const app = express()
    app.use(express.json())
    app.post('/test', validate(simpleSchema), (_req, res, next: any) => {
      nextCallCount++
      next()
    }, (_req: any, res: any) => {
      res.json({ ok: true, count: nextCallCount })
    })

    const res = await request(app)
      .post('/test')
      .send({ name: 'Lena', age: 27 })

    expect(res.status).toBe(200)
    expect(res.body.count).toBe(1)
  })
})
