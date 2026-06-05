/**
 * middleware/request-id.ts — correlation ID for every HTTP request.
 *
 * Attaches a UUID to req.id and echoes it in the X-Request-Id response header.
 * This ties together all log lines from a single request, making it possible
 * to search logs by request ID when debugging a specific failure.
 *
 * Usage in logger calls:
 *   logger.info('STK Push sent', { txnId, requestId: req.id })
 *
 * Usage by callers (Android app):
 *   If the app logs the X-Request-Id from responses, support can correlate
 *   a specific tap with the server log that processed it.
 */
import { Request, Response, NextFunction } from 'express'
import { v4 as uuidv4 } from 'uuid'

declare global {
  namespace Express {
    interface Request {
      id: string
    }
  }
}

export function requestId(req: Request, res: Response, next: NextFunction) {
  // Honor a request ID the caller already has (e.g. from a retry with the same ID)
  req.id = (req.headers['x-request-id'] as string) || uuidv4()
  res.setHeader('X-Request-Id', req.id)
  next()
}
