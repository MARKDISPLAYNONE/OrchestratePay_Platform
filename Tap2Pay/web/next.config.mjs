/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  // Rewrites proxy /api to the Express backend in development
  async rewrites() {
    return process.env.NODE_ENV === 'development' ? [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'}/api/:path*`,
      },
    ] : []
  },

  // Prevent browsers from caching HTML in dev so stale asset hashes never cause 404s on restart
  async headers() {
    if (process.env.NODE_ENV !== 'development') return []
    return [
      {
        source: '/(.*)',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ]
  },
}

export default nextConfig
