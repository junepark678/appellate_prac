import { createHash } from 'node:crypto'

import { ca4CourtSourceVersions } from '../src/domain/rules/ca4-source-profile'
import { normalizeSourceText } from '../src/domain/rules/source-governance'

function sha256(value: string) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

const refreshed = []

for (const source of ca4CourtSourceVersions) {
  const response = await fetch(source.sourceUrl)
  const rawText = await response.text()
  const contentHash = sha256(normalizeSourceText(rawText))
  refreshed.push({
    sourceVersionId: source.sourceVersionId,
    label: source.label,
    sourceUrl: source.sourceUrl,
    status: response.status,
    fetchedHash: contentHash,
    bundledHash: source.contentHash,
    changed: contentHash !== source.contentHash,
    bytes: rawText.length,
  })
}

console.log(JSON.stringify(refreshed, null, 2))

const failures = refreshed.filter((source) => source.status < 200 || source.status >= 300)
if (failures.length) {
  console.error(`Unable to fetch ${failures.length} source(s).`)
  process.exit(1)
}
