export interface SyncResult {
  requestedAt: string
}

interface CloudSyncApi {
  sync(options: { wait: boolean; purpose: 'pull' | 'push' }): Promise<void>
}

/**
 * Ask Dexie Cloud to reconcile in the background.
 *
 * Dexie Cloud already performs eager two-way sync. This is only for an explicit
 * user retry, so it must never wait on the network and hold the UI open.
 */
export async function requestCloudSync(cloud: CloudSyncApi): Promise<SyncResult> {
  await cloud.sync({ wait: false, purpose: 'pull' })
  return { requestedAt: new Date().toISOString() }
}
