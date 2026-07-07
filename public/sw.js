try {
  // Relative to this script's URL so the app also works from a sub-path (GitHub Pages).
  importScripts('./dexie-cloud-addon-service-worker.js')
} catch (_error) {
  // Dexie Cloud still syncs while the app is open when the worker helper is absent.
}

const CACHE_NAME = 'family-finance-v1'
const STATIC_ASSETS = ['./', './manifest.webmanifest', './icons/icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request).then((response) => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
          return response
        })
      )
    })
  )
})
