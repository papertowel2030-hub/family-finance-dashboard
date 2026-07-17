import { readFile, writeFile } from 'node:fs/promises'

const [localBackupPath, cloudExportPath, outputPath] = process.argv.slice(2)
if (!localBackupPath || !cloudExportPath || !outputPath) {
  throw new Error('Usage: node scripts/build-additive-cloud-import.mjs <local-backup.json> <cloud-export.json> <output.json>')
}

const [localBackup, cloudExport] = await Promise.all([
  readFile(localBackupPath, 'utf8').then(JSON.parse),
  readFile(cloudExportPath, 'utf8').then(JSON.parse),
])

if (localBackup.app !== 'family-finance-dashboard' || localBackup.version !== 1) {
  throw new Error('The local file is not a supported Family Finance backup.')
}

const realmId = localBackup.settings?.[0]?.realmId
if (!realmId || !cloudExport.data?.[realmId]) {
  throw new Error('The local backup realm is not present in the cloud export.')
}

const tableNames = ['settings', 'buckets', 'incomeSources', 'categories', 'transactions']
const additions = {}
const counts = {}

for (const tableName of tableNames) {
  const cloudTable = cloudExport.data[realmId][tableName] ?? {}
  const rows = (localBackup[tableName] ?? []).filter((row) => row.realmId === realmId && cloudTable[row.id] === undefined)
  if (!rows.length) continue

  additions[tableName] = Object.fromEntries(rows.map((row) => [row.id, row]))
  counts[tableName] = rows.length
}

const transactionRows = Object.values(additions.transactions ?? {})
const availableIds = (tableName) =>
  new Set([...Object.keys(cloudExport.data[realmId][tableName] ?? {}), ...Object.keys(additions[tableName] ?? {})])
const bucketIds = availableIds('buckets')
const sourceIds = availableIds('incomeSources')
const categoryIds = availableIds('categories')

for (const row of transactionRows) {
  const valid =
    bucketIds.has(row.bucketId) &&
    (!row.toBucketId || bucketIds.has(row.toBucketId)) &&
    (!row.sourceId || sourceIds.has(row.sourceId)) &&
    (!row.categoryId || categoryIds.has(row.categoryId))
  if (!valid) throw new Error(`Transaction ${row.id} has a reference missing from both local and cloud data.`)
}

if (Object.keys(additions).length === 0) throw new Error('There are no local-only records to import.')

await writeFile(outputPath, `${JSON.stringify({ data: { [realmId]: additions } }, null, 2)}\n`, { mode: 0o600 })
console.log(JSON.stringify({ realmId, counts }))
