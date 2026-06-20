import { jwtVerify } from 'jose'
import { NextRequest, NextResponse } from 'next/server'

// Read per-request so process.env is always current (important for tests and
// for runtime secret rotation without a full process restart).
function getSecret(): Uint8Array | null {
  return process.env.JWT_SECRET
    ? new TextEncoder().encode(process.env.JWT_SECRET)
    : null
}

// Shared with the Express backend via JWT_SECRET env var.
// Returns null (→ deny) when the secret is absent, failing closed instead of
// falling back to the old forged-cookie check.
async function getVerifiedRole(req: NextRequest): Promise<string | null> {
  const secret = getSecret()
  if (!secret) return null
  const token = req.cookies.get('token')?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret)
    return (payload.role as string | undefined) ?? 'MERCHANT'
  } catch {
    return null
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (pathname.startsWith('/admin') && pathname !== '/admin/login') {
    const adminAuth = req.cookies.get('admin_auth')?.value
    if (!adminAuth) {
      return NextResponse.redirect(new URL('/admin/login', req.url))
    }
  }

  if (pathname.startsWith('/consumer')) {
    const role = await getVerifiedRole(req)
    if (role !== 'CONSUMER') {
      return NextResponse.redirect(new URL('/auth/login', req.url))
    }
  }

  if (pathname.startsWith('/merchant')) {
    const role = await getVerifiedRole(req)
    if (role !== 'MERCHANT') {
      return NextResponse.redirect(new URL('/auth/login', req.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*', '/consumer/:path*', '/merchant/:path*'],
}
