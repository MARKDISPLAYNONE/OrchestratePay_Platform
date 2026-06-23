/**
 * swagger.ts — OpenAPI 3.0 spec and Swagger UI setup.
 *
 * Mount in index.ts:
 *   import { swaggerRouter } from './util/swagger'
 *   app.use('/api-docs', swaggerRouter)
 *
 * The spec is built from inline JSDoc annotations on route handlers
 * (swagger-jsdoc) and served via swagger-ui-express at /api-docs.
 */
import swaggerJsdoc from 'swagger-jsdoc'
import swaggerUi    from 'swagger-ui-express'
import { Router }   from 'express'

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title:       'OrchestratePay API',
      version:     '1.0.0',
      description: 'Tap-to-pay platform for Kenya — M-Pesa, Airtel Money, T-Kash, NFC, HCE, QR.',
      contact: {
        name:  'OrchestratePay Support',
        email: 'support@orchestratepay.co.ke',
      },
    },
    servers: [
      { url: '/api/v1',   description: 'Current API version' },
      { url: 'http://localhost:3000/api/v1', description: 'Local dev' },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type:         'http',
          scheme:       'bearer',
          bearerFormat: 'JWT',
          description:  'JWT issued on login. Include as Authorization: Bearer <token>',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error:   { type: 'string', example: 'Validation failed' },
            details: { type: 'string' },
          },
        },
        Transaction: {
          type: 'object',
          properties: {
            id:              { type: 'string', format: 'uuid' },
            merchantId:      { type: 'string', format: 'uuid' },
            amountCents:     { type: 'integer', example: 50000, description: 'Amount in KSh cents (50000 = KSh 500)' },
            status:          { type: 'string', enum: ['PENDING','CONFIRMED','FAILED','EXPIRED'] },
            source:          { type: 'string', enum: ['NFC_TAG','HCE_PHONE','QR_CODE','SOFTPOS_MOBILE'] },
            mpesaReceipt:    { type: 'string', example: 'RJK4HD2NZ3' },
            createdAt:       { type: 'string', format: 'date-time' },
            confirmedAt:     { type: 'string', format: 'date-time' },
          },
        },
        Settlement: {
          type: 'object',
          properties: {
            id:                 { type: 'string', format: 'uuid' },
            periodStart:        { type: 'string', format: 'date-time' },
            periodEnd:          { type: 'string', format: 'date-time' },
            grossAmountCents:   { type: 'integer' },
            feeCents:           { type: 'integer' },
            netAmountCents:     { type: 'integer' },
            transactionCount:   { type: 'integer' },
            status:             { type: 'string', enum: ['PENDING','PROCESSING','COMPLETED','FAILED','NO_ACCOUNT'] },
            payoutMethod:       { type: 'string', enum: ['MPESA','BANK','MANUAL'] },
            b2cReceipt:         { type: 'string' },
            settledAt:          { type: 'string', format: 'date-time' },
          },
        },
        Merchant: {
          type: 'object',
          properties: {
            id:             { type: 'string', format: 'uuid' },
            name:           { type: 'string' },
            email:          { type: 'string', format: 'email' },
            phone:          { type: 'string', example: '254712345678' },
            approvalStatus: { type: 'string', enum: ['PENDING','APPROVED','REJECTED','SUSPENDED'] },
            kycStatus:      { type: 'string', enum: ['NOT_SUBMITTED','SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED'] },
            createdAt:      { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    security: [{ BearerAuth: [] }],
    tags: [
      { name: 'Auth',        description: 'Authentication and token management' },
      { name: 'Transactions', description: 'Payment initiation and status' },
      { name: 'Settlements', description: 'Merchant settlement history and account management' },
      { name: 'KYC',         description: 'Know-your-customer document submission' },
      { name: 'Rails',       description: 'Alternative payment rails (Airtel Money, T-Kash)' },
      { name: 'Merchants',   description: 'Merchant profile management' },
      { name: 'Refunds',     description: 'Payment refunds' },
      { name: 'Loyalty',     description: 'Points and stamps loyalty programmes' },
      { name: 'Admin',       description: 'Admin-only operations (requires X-Admin-Secret header)' },
    ],
    paths: {
      '/auth/login': {
        post: {
          tags: ['Auth'],
          security: [],
          summary: 'Merchant or consumer login',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email','password'],
                  properties: {
                    email:    { type: 'string', format: 'email' },
                    password: { type: 'string', minLength: 8 },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'JWT access token',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      token:        { type: 'string' },
                      refreshToken: { type: 'string' },
                      merchant:     { $ref: '#/components/schemas/Merchant' },
                    },
                  },
                },
              },
            },
            401: { description: 'Invalid credentials' },
            423: { description: 'Account locked' },
          },
        },
      },
      '/transactions': {
        post: {
          tags: ['Transactions'],
          summary: 'Initiate a payment (STK Push / NFC / HCE / QR)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['amountCents','source'],
                  properties: {
                    amountCents:    { type: 'integer', minimum: 100, example: 50000 },
                    source:         { type: 'string', enum: ['NFC_TAG','HCE_PHONE','QR_CODE','SOFTPOS_MOBILE'] },
                    phone:          { type: 'string', example: '0712345678', description: 'Required for SOFTPOS_MOBILE' },
                    tagId:          { type: 'string', description: 'NFC tag ID for NFC_TAG source' },
                    hceToken:       { type: 'string', description: 'Single-use HCE token for HCE_PHONE source' },
                    idempotencyKey: { type: 'string', format: 'uuid', description: 'Duplicate prevention key' },
                  },
                },
              },
            },
          },
          responses: {
            202: { description: 'Payment initiated — awaiting M-Pesa callback' },
            400: { $ref: '#/components/responses/BadRequest' },
            402: { description: 'Payment failed or cancelled' },
          },
        },
      },
      '/settlements': {
        get: {
          tags: ['Settlements'],
          summary: 'List merchant settlement history',
          parameters: [
            { name: 'page',  in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
          ],
          responses: {
            200: {
              description: 'Paginated settlement list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      settlements: { type: 'array', items: { $ref: '#/components/schemas/Settlement' } },
                      total: { type: 'integer' },
                      page:  { type: 'integer' },
                      limit: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/settlements/account': {
        post: {
          tags: ['Settlements'],
          summary: 'Register or update settlement payout account',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['accountType'],
                  properties: {
                    accountType:   { type: 'string', enum: ['MPESA','BANK'] },
                    mpesaPhone:    { type: 'string', example: '0712345678', description: 'Required for MPESA' },
                    bankName:      { type: 'string', example: 'Equity Bank', description: 'Required for BANK' },
                    accountNumber: { type: 'string', example: '0123456789', description: 'Required for BANK' },
                    accountName:   { type: 'string', example: 'Acme Ltd', description: 'Required for BANK' },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Settlement account registered' },
            400: { $ref: '#/components/responses/BadRequest' },
          },
        },
      },
      '/kyc/documents': {
        post: {
          tags: ['KYC'],
          summary: 'Upload a KYC document URL',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['docType','fileUrl'],
                  properties: {
                    docType:  { type: 'string', enum: ['NATIONAL_ID','PASSPORT','BUSINESS_REG','KRA_CERT','SELFIE','OTHER'] },
                    fileUrl:  { type: 'string', format: 'uri', description: 'Pre-signed S3 or cloud storage URL of the uploaded document' },
                    fileName: { type: 'string', example: 'national_id_front.jpg' },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Document saved. allRequiredSubmitted=true when KYC can be reviewed.' },
            400: { $ref: '#/components/responses/BadRequest' },
          },
        },
        get: {
          tags: ['KYC'],
          summary: 'List submitted KYC documents',
          responses: { 200: { description: 'Document list' } },
        },
      },
      '/kyc/status': {
        get: {
          tags: ['KYC'],
          summary: 'Check overall KYC status',
          responses: { 200: { description: 'KYC status with list of missing required documents' } },
        },
      },
      '/rails': {
        get: {
          tags: ['Rails'],
          summary: 'List all payment rails and their current availability',
          security: [],
          responses: { 200: { description: 'Rail list with active flag' } },
        },
      },
      '/rails/{method}': {
        post: {
          tags: ['Rails'],
          summary: 'Initiate a payment on an alternative rail (Airtel Money, T-Kash)',
          parameters: [
            { name: 'method', in: 'path', required: true, schema: { type: 'string', enum: ['AIRTEL_MONEY','TKASH'] } },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['phone','amountCents','reference'],
                  properties: {
                    phone:       { type: 'string', example: '0756789012' },
                    amountCents: { type: 'integer', minimum: 100 },
                    reference:   { type: 'string', maxLength: 20 },
                    description: { type: 'string', maxLength: 20 },
                  },
                },
              },
            },
          },
          responses: {
            202: { description: 'Payment initiated — awaiting callback' },
            422: { description: 'Payment rejected by provider' },
            503: { description: 'Rail not configured' },
          },
        },
      },
    },
    responses: {
      BadRequest: {
        description: 'Validation error',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
    },
  },
  apis: [],  // inline spec above — no JSDoc scanning needed
}

const spec = swaggerJsdoc(options)

export const swaggerRouter = Router()

swaggerRouter.use('/', swaggerUi.serve)
swaggerRouter.get('/', swaggerUi.setup(spec, {
  customSiteTitle: 'OrchestratePay API Docs',
  swaggerOptions: {
    persistAuthorization: true,
    filter:               true,
    displayRequestDuration: true,
  },
}))

// Serve raw JSON spec for SDK generation
swaggerRouter.get('/openapi.json', (_req, res) => {
  res.json(spec)
})
