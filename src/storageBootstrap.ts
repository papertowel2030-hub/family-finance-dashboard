const FALLBACK_FLAG = '__familyFinanceUsesVolatileIndexedDb'

declare global {
  interface Window {
    [FALLBACK_FLAG]?: boolean
  }
}

export async function ensureIndexedDb() {
  if (await canOpenIndexedDb()) {
    return
  }

  const fakeIdb = await import('fake-indexeddb')

  getGlobalHosts().forEach((host) => installIndexedDbGlobals(host, fakeIdb))

  if (typeof window !== 'undefined') {
    window[FALLBACK_FLAG] = true
  }
}

export function isUsingFallbackIndexedDb() {
  return typeof window !== 'undefined' && window[FALLBACK_FLAG] === true
}

function hasIndexedDb() {
  const hosts = getGlobalHosts()
  return hosts.length > 0 && hosts.every(hasCompleteIndexedDbSurface)
}

function canOpenIndexedDb(timeoutMs = 1200) {
  if (!hasIndexedDb()) return Promise.resolve(false)

  return new Promise<boolean>((resolve) => {
    const indexedDb = getGlobalHosts()[0]?.indexedDB
    if (!indexedDb) {
      resolve(false)
      return
    }

    const probeName = 'FamilyFinanceDashboardBootstrapProbe'
    let settled = false
    let request: IDBOpenDBRequest | undefined

    const finish = (result: boolean) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)

      try {
        request?.result?.close()
      } catch {
        // A failed open may not expose a result.
      }

      if (result) {
        try {
          indexedDb.deleteDatabase(probeName)
        } catch {
          // The probe database is empty and harmless if cleanup is blocked.
        }
      }

      resolve(result)
    }

    const timer = window.setTimeout(() => finish(false), timeoutMs)

    try {
      request = indexedDb.open(probeName, 1)
      request.onupgradeneeded = () => {
        request?.result.createObjectStore('probe')
      }
      request.onsuccess = () => finish(true)
      request.onerror = () => finish(false)
      request.onblocked = () => finish(false)
    } catch {
      finish(false)
    }
  })
}

function getGlobalHosts() {
  return [globalThis, typeof window !== 'undefined' ? window : undefined, typeof self !== 'undefined' ? self : undefined].filter(
    (host, index, hosts): host is typeof globalThis => Boolean(host) && hosts.indexOf(host) === index,
  )
}

function hasCompleteIndexedDbSurface(host: typeof globalThis) {
  return (
    'indexedDB' in host &&
    typeof host.indexedDB?.open === 'function' &&
    'IDBKeyRange' in host &&
    typeof host.IDBKeyRange?.bound === 'function' &&
    'IDBTransaction' in host &&
    typeof host.IDBTransaction === 'function'
  )
}

function installIndexedDbGlobals(host: typeof globalThis, fakeIdb: typeof import('fake-indexeddb')) {
  const globals = {
    indexedDB: fakeIdb.indexedDB,
    IDBCursor: fakeIdb.IDBCursor,
    IDBCursorWithValue: fakeIdb.IDBCursorWithValue,
    IDBDatabase: fakeIdb.IDBDatabase,
    IDBFactory: fakeIdb.IDBFactory,
    IDBIndex: fakeIdb.IDBIndex,
    IDBKeyRange: fakeIdb.IDBKeyRange,
    IDBObjectStore: fakeIdb.IDBObjectStore,
    IDBOpenDBRequest: fakeIdb.IDBOpenDBRequest,
    IDBRequest: fakeIdb.IDBRequest,
    IDBTransaction: fakeIdb.IDBTransaction,
    IDBVersionChangeEvent: fakeIdb.IDBVersionChangeEvent,
  }

  Object.entries(globals).forEach(([name, value]) => {
    Object.defineProperty(host, name, {
      value,
      enumerable: false,
      configurable: true,
      writable: true,
    })
  })
}
