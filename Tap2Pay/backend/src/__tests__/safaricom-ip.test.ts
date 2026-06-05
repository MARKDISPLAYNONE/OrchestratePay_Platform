import { Request, Response, NextFunction } from 'express'
import { requireSafaricomIp } from '../middleware/safaricom-ip'

function makeReq(ip: string): Partial<Request> {
  return { ip, id: 'test-req-id', path: '/api/v1/mpesa-callback' } as any
}

function makeRes() {
  const res: any = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json   = jest.fn().mockReturnValue(res)
  return res as Response
}

describe('requireSafaricomIp middleware', () => {
  const next: NextFunction = jest.fn()

  beforeEach(() => jest.clearAllMocks())

  describe('in development/test (NODE_ENV != production)', () => {
    it('allows all IPs through', () => {
      const req = makeReq('1.2.3.4')
      const res = makeRes()
      requireSafaricomIp(req as Request, res, next)
      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })
  })

  describe('in production (NODE_ENV = production)', () => {
    const orig = process.env.NODE_ENV

    beforeAll(() => { process.env.NODE_ENV = 'production' })
    afterAll(()  => { process.env.NODE_ENV = orig })

    it('allows a known Safaricom IP', () => {
      const req = makeReq('196.201.214.200')
      const res = makeRes()
      requireSafaricomIp(req as Request, res, next)
      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })

    it('allows another known Safaricom IP', () => {
      const req = makeReq('196.201.212.138')
      const res = makeRes()
      requireSafaricomIp(req as Request, res, next)
      expect(next).toHaveBeenCalled()
    })

    it('blocks an unknown IP with 403', () => {
      const req = makeReq('1.2.3.4')
      const res = makeRes()
      requireSafaricomIp(req as Request, res, next)
      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(403)
    })

    it('strips IPv4-mapped IPv6 prefix before checking', () => {
      // Node/Express may represent 196.201.214.200 as ::ffff:196.201.214.200
      const req = makeReq('::ffff:196.201.214.200')
      const res = makeRes()
      requireSafaricomIp(req as Request, res, next)
      expect(next).toHaveBeenCalled()
    })

    it('blocks a localhost IP (not Safaricom)', () => {
      const req = makeReq('127.0.0.1')
      const res = makeRes()
      requireSafaricomIp(req as Request, res, next)
      expect(res.status).toHaveBeenCalledWith(403)
    })
  })
})
