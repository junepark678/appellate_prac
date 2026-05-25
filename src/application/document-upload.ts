import type { Id } from '../../convex/_generated/dataModel'
import type { DocumentAnalysis, UploadedDocument } from '../domain/types'
import { inferDocumentSignals } from '../domain/simulation'

type GenerateDocumentUploadUrl = (args: {
  caseSessionId: Id<'caseSessions'>
}) => Promise<string>

type PersistDocumentAnalysis = (args: {
  caseSessionId: Id<'caseSessions'>
  document: UploadedDocument
  analysis: DocumentAnalysis
}) => Promise<{
  document: UploadedDocument
  analysisId: string
}>

export type DocumentUploadWorkflow = {
  generateDocumentUploadUrl: GenerateDocumentUploadUrl
  persistDocumentAnalysis: PersistDocumentAnalysis
}

export function inferUploadedDocuments(files: FileList | null): UploadedDocument[] {
  return Array.from(files ?? []).map(inferDocumentSignals)
}

export async function analyzeUploadAndPersistDocuments(
  workflow: DocumentUploadWorkflow,
  caseSessionId: Id<'caseSessions'>,
  files: FileList | null,
): Promise<UploadedDocument[]> {
  return Promise.all(
    Array.from(files ?? []).map((file) =>
      analyzeUploadAndPersistDocument(workflow, caseSessionId, file),
    ),
  )
}

async function analyzeUploadAndPersistDocument(
  workflow: DocumentUploadWorkflow,
  caseSessionId: Id<'caseSessions'>,
  file: File,
): Promise<UploadedDocument> {
  const base = inferDocumentSignals(file)
  const { pdfJsAnalyzer } = await import('../modules/documents/pdfjs-analyzer')
  const [analysis, sha256, storageId] = await Promise.all([
    pdfJsAnalyzer.analyze({
      fileName: file.name,
      mimeType: file.type || 'application/pdf',
      sizeBytes: file.size,
      extractedSignals: base.extractedSignals,
      arrayBuffer: () => file.arrayBuffer(),
    }),
    sha256File(file),
    uploadToConvexStorage(workflow, caseSessionId, file),
  ])
  const document = documentFromAnalysis(base, analysis, storageId, sha256)

  try {
    const persisted = await workflow.persistDocumentAnalysis({
      caseSessionId,
      document,
      analysis,
    })
    return persisted.document
  } catch {
    return document
  }
}

async function uploadToConvexStorage(
  workflow: DocumentUploadWorkflow,
  caseSessionId: Id<'caseSessions'>,
  file: File,
) {
  const uploadUrl = await workflow.generateDocumentUploadUrl({ caseSessionId })
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/pdf' },
    body: file,
  })
  if (!response.ok) {
    throw new Error('Unable to store PDF in Convex storage.')
  }
  const payload = (await response.json()) as { storageId?: string }
  return payload.storageId
}

async function sha256File(file: File) {
  if (!globalThis.crypto?.subtle) return undefined
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function signalsFromAnalysis(base: UploadedDocument, analysis: DocumentAnalysis) {
  return [
    ...base.extractedSignals,
    ...(analysis.sectionMap?.map((section) => section.label.toLowerCase()) ?? []),
    ...(analysis.certificateOfServiceDetected ? ['certificate of service'] : []),
    ...(analysis.certificateOfComplianceDetected ? ['certificate of compliance'] : []),
    ...((analysis.recordCitations?.length ?? 0) > 0 ? ['record citation'] : []),
    ...((analysis.appendixCitations?.length ?? 0) > 0 ? ['appendix'] : []),
  ].filter((signal, index, values) => values.indexOf(signal) === index)
}

function documentFromAnalysis(
  base: UploadedDocument,
  analysis: DocumentAnalysis,
  storageId?: string,
  sha256?: string,
): UploadedDocument {
  return {
    ...base,
    ...(storageId ? { storageId } : {}),
    ...(sha256 ? { sha256 } : {}),
    ...(typeof analysis.pageCount === 'number' ? { pageCount: analysis.pageCount } : {}),
    ...(analysis.normalizedText ? { extractedText: analysis.normalizedText } : {}),
    ...(analysis.textExtractionStatus
      ? { textExtractionStatus: analysis.textExtractionStatus }
      : {}),
    ...(typeof analysis.wordCount === 'number' ? { wordCount: analysis.wordCount } : {}),
    extractedSignals: signalsFromAnalysis(base, analysis),
    analysis,
  }
}
