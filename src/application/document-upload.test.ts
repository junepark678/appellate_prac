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
