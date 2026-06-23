/**
 * sw.js — Minimal service worker for PWA offline support.
 *
 * Strategy: cache-first for static assets, network-first for API calls.
 * iOS 16.4+ supports service workers when the page is installed to home screen.
 *
 * For production, use next-pwa (Workbox) which generates this automatically
 * and handles cache versioning, precaching, and background sync.
 */

const CACHE_NAME = 'orchestratepay-v1'
const STATIC_ASSETS = ['/', '/offline.html']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Pass through API requests and Next.js versioned chunks — never cache these
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/')) return

  event.respondWith(
    caches.match(request).then(cached => cached ?? fetch(request).catch(() =>
      caches.match('/offline.html')
    ))
  )
})
