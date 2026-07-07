import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const source = resolve('node_modules/dexie-cloud-addon/dist/umd/service-worker.min.js')
const target = resolve('public/dexie-cloud-addon-service-worker.js')

await mkdir(dirname(target), { recursive: true })
await copyFile(source, target)
