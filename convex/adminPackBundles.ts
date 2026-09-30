/*
 * Appellate Practice Simulator — federal appellate procedure training.
 * Copyright (C) 2026 Rhajune Park
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { v } from 'convex/values'

import { internal } from './_generated/api'
import { action } from './_generated/server'
import type { Id } from './_generated/dataModel'

type BundleZipPayload = {
  bundleId: Id<'packBundles'>
  courtPackId: string
  bundleVersion: string
  label: string
  manifestJson: string
  rules: Array<{
    packId: string
    ruleId: string
    topic: string
    sourceLabel: string
    sourceUrl: string
    plainText: string
    simulatorNotes: string
    constraintsJson: string
  }>
  artifacts: Array<{
    id: Id<'sourceArtifacts'>
    kind: string
    sourceVersionId: string
    label: string
    url: string
    contentHash: string
    mediaType?: string
    rawStorageId?: Id<'_storage'>
    rawText?: string
  }>
}

type GenerateZipResult = {
  storageId: Id<'_storage'>
  zipFileName: string
  zipSizeBytes: number
  zipContentHash: string
}

function zipDateTime(date = new Date()) {
  const dosTime =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const dosDate =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { dosTime, dosDate }
}

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  return value >>> 0
})

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function writeUint16(output: number[], value: number) {
  output.push(value & 0xff, (value >>> 8) & 0xff)
}

function writeUint32(output: number[], value: number) {
  output.push(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  )
}

function safeZipPath(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 96) || 'item'
  )
}

function makeZip(entries: Array<{ path: string; bytes: Uint8Array }>) {
  const encoder = new TextEncoder()
  const fileParts: Uint8Array[] = []
  const centralDirectory: number[] = []
  let offset = 0
  const { dosTime, dosDate } = zipDateTime()

  for (const entry of entries) {
    const pathBytes = encoder.encode(entry.path)
    const checksum = crc32(entry.bytes)
    const localHeader: number[] = []
    writeUint32(localHeader, 0x04034b50)
    writeUint16(localHeader, 20)
    writeUint16(localHeader, 0)
    writeUint16(localHeader, 0)
    writeUint16(localHeader, dosTime)
    writeUint16(localHeader, dosDate)
    writeUint32(localHeader, checksum)
    writeUint32(localHeader, entry.bytes.length)
    writeUint32(localHeader, entry.bytes.length)
    writeUint16(localHeader, pathBytes.length)
    writeUint16(localHeader, 0)
    fileParts.push(new Uint8Array(localHeader), pathBytes, entry.bytes)

    writeUint32(centralDirectory, 0x02014b50)
    writeUint16(centralDirectory, 20)
    writeUint16(centralDirectory, 20)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, dosTime)
    writeUint16(centralDirectory, dosDate)
    writeUint32(centralDirectory, checksum)
    writeUint32(centralDirectory, entry.bytes.length)
    writeUint32(centralDirectory, entry.bytes.length)
    writeUint16(centralDirectory, pathBytes.length)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint32(centralDirectory, 0)
    writeUint32(centralDirectory, offset)
    centralDirectory.push(...pathBytes)
    offset += localHeader.length + pathBytes.length + entry.bytes.length
  }

  const centralBytes = new Uint8Array(centralDirectory)
  const end: number[] = []
  writeUint32(end, 0x06054b50)
  writeUint16(end, 0)
  writeUint16(end, 0)
  writeUint16(end, entries.length)
  writeUint16(end, entries.length)
  writeUint32(end, centralBytes.length)
  writeUint32(end, offset)
  writeUint16(end, 0)

  const parts = [...fileParts, centralBytes, new Uint8Array(end)]
  const totalLength = parts.reduce((total, part) => total + part.length, 0)
  const output = new Uint8Array(totalLength)
  let cursor = 0
  for (const part of parts) {
    output.set(part, cursor)
    cursor += part.length
  }
  return output
}

async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export const generatePackBundleZip = action({
  args: {
    bundleId: v.id('packBundles'),
  },
  returns: v.object({
    storageId: v.id('_storage'),
    zipFileName: v.string(),
    zipSizeBytes: v.number(),
    zipContentHash: v.string(),
  }),
  handler: async (ctx, args): Promise<GenerateZipResult> => {
    const payload: BundleZipPayload = await ctx.runQuery(internal.admin.bundleZipPayload, {
      bundleId: args.bundleId,
    })
    const encoder = new TextEncoder()
    const entries: Array<{ path: string; bytes: Uint8Array }> = [
      {
        path: 'manifest.json',
        bytes: encoder.encode(JSON.stringify(JSON.parse(payload.manifestJson), null, 2)),
      },
      {
        path: 'rules/index.json',
        bytes: encoder.encode(JSON.stringify(payload.rules, null, 2)),
      },
      {
        path: 'artifacts/index.json',
        bytes: encoder.encode(JSON.stringify(payload.artifacts, null, 2)),
      },
    ]

    for (const rule of payload.rules) {
      entries.push({
        path: `rules/${safeZipPath(rule.packId)}/${safeZipPath(rule.ruleId)}.json`,
        bytes: encoder.encode(JSON.stringify(rule, null, 2)),
      })
    }

    for (const artifact of payload.artifacts) {
      const basePath = `artifacts/${safeZipPath(artifact.kind)}/${safeZipPath(
        `${artifact.sourceVersionId}-${artifact.label}`,
      )}`
      if (artifact.rawStorageId) {
        const url = await ctx.storage.getUrl(artifact.rawStorageId)
        if (url) {
          const response = await fetch(url)
          if (response.ok) {
            entries.push({
              path: `${basePath}${artifact.mediaType === 'application/pdf' ? '.pdf' : '.bin'}`,
              bytes: new Uint8Array(await response.arrayBuffer()),
            })
            continue
          }
        }
      }
      if (artifact.rawText) {
        entries.push({
          path: `${basePath}.txt`,
          bytes: encoder.encode(artifact.rawText),
        })
      }
    }

    const zipBytes = makeZip(entries)
    const zipBuffer = new ArrayBuffer(zipBytes.byteLength)
    new Uint8Array(zipBuffer).set(zipBytes)
    const zipSha256 = await sha256Hex(zipBuffer)
    const zipContentHash = `sha256:${zipSha256}`
    const storageId = await ctx.storage.store(new Blob([zipBuffer], { type: 'application/zip' }), {
      sha256: zipSha256,
    })
    const zipFileName: string = `${safeZipPath(payload.courtPackId)}-${safeZipPath(
      payload.bundleVersion,
    )}.zip`
    await ctx.runMutation(internal.admin.attachGeneratedPackBundleZip, {
      bundleId: payload.bundleId,
      storageId,
      zipFileName,
      zipSizeBytes: zipBytes.byteLength,
      zipContentHash,
    })
    return {
      storageId,
      zipFileName,
      zipSizeBytes: zipBytes.byteLength,
      zipContentHash,
    }
  },
})
