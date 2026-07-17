const CACHE_NAME = 'family-finance-v2'
const APP_SHELL_URL = new URL('./', self.location.href).href
const STATIC_ASSETS = [APP_SHELL_URL, new URL('./manifest.webmanifest', self.location.href).href, new URL('./icons/icon.svg', self.location.href).href]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  const requestUrl = new URL(event.request.url)
  if (requestUrl.origin !== self.location.origin) return

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(async (response) => {
          if (response.ok) {
            const copy = response.clone()
            const cache = await caches.open(CACHE_NAME)
            await cache.put(APP_SHELL_URL, copy)
          }
          return response
        })
        .catch(() => caches.match(APP_SHELL_URL)),
    )
    return
  }

  // Vite assets are content-hashed, so a cached URL cannot hide a newer build.
  if (requestUrl.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then(async (response) => {
            if (response.ok) {
              const copy = response.clone()
              const cache = await caches.open(CACHE_NAME)
              await cache.put(event.request, copy)
            }
            return response
          }),
      ),
    )
  }
})
