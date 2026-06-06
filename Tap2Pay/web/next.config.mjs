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
}

export default nextConfig
