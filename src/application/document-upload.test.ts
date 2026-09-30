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

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Id } from '../../convex/_generated/dataModel'
import type { DocumentAnalysis } from '../domain/types'
import { analyzeUploadAndPersistDocuments } from './document-upload'

vi.mock('../modules/documents/pdfjs-analyzer', () => ({
  pdfJsAnalyzer: {
    async analyze(file: { fileName: string; mimeType: string; sizeBytes: number }) {
      return {
        analyzerId: 'test-analyzer',
        fileSizeBytes: file.sizeBytes,
        mimeType: file.mimeType,
        searchableText: true,
        normalizedText: file.fileName,
        certificateOfServiceDetected: false,
        certificateOfComplianceDetected: false,
        sealedOrRedactionWarning: false,
        warnings: [],
      } satisfies DocumentAnalysis
    },
  },
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('analyzeUploadAndPersistDocuments', () => {
  it('rejects when any selected document cannot be uploaded', async () => {
    const openingBrief = new File(['opening brief'], 'opening-brief.pdf', {
      type: 'application/pdf',
    })
    const appendix = new File(['appendix'], 'appendix.pdf', { type: 'application/pdf' })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const uploadedFile = init?.body
        if (uploadedFile instanceof File && uploadedFile.name === 'appendix.pdf') {
          return new Response(null, { status: 500 })
        }
        return Response.json({ storageId: 'storage_success' })
      }),
    )

    await expect(
      analyzeUploadAndPersistDocuments(
        {
          generateDocumentUploadUrl: async () => 'https://uploads.example.test',
          persistDocumentAnalysis: async (args) => ({
            document: { ...args.document, analysisId: args.analysis.analyzerId },
            analysisId: args.analysis.analyzerId,
          }),
        },
        'case_session_123' as Id<'caseSessions'>,
        fileList(openingBrief, appendix),
      ),
    ).rejects.toThrow('Unable to store PDF in Convex storage.')
  })

  it('rejects when a selected document cannot be persisted', async () => {
    const openingBrief = new File(['opening brief'], 'opening-brief.pdf', {
      type: 'application/pdf',
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ storageId: 'storage_success' })),
    )

    await expect(
      analyzeUploadAndPersistDocuments(
        {
          generateDocumentUploadUrl: async () => 'https://uploads.example.test',
          persistDocumentAnalysis: async () => {
            throw new Error('Document persistence failed')
          },
        },
        'case_session_123' as Id<'caseSessions'>,
        fileList(openingBrief),
      ),
    ).rejects.toThrow('Document persistence failed')
  })
})

function fileList(...files: File[]): FileList {
  const list = {
    length: files.length,
    item(index: number) {
      return files[index] ?? null
    },
    *[Symbol.iterator]() {
      yield* files
    },
  } as FileList

  files.forEach((file, index) => {
    Object.defineProperty(list, index, { value: file, enumerable: true })
  })

  return list
}
