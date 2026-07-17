export interface SyncResult {
  completedAt: string
}

interface CloudSyncApi {
  sync(options: { wait: boolean; purpose: 'pull' | 'push' }): Promise<void>
}

/** Pull remote rows first, then push local-only rows, waiting for both phases. */
export async function reconcileCloud(cloud: CloudSyncApi): Promise<SyncResult> {
  await cloud.sync({ wait: true, purpose: 'pull' })
  await cloud.sync({ wait: true, purpose: 'push' })
  return { completedAt: new Date().toISOString() }
}
