export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // The app remains fully usable without the service worker.
    })
  })
}
