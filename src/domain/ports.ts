import type {
  DocumentAnalysis,
  UploadedDocument,
} from './types'

export type UploadedFile = Pick<
  UploadedDocument,
  'fileName' | 'mimeType' | 'sizeBytes' | 'pageCount' | 'extractedSignals'
> & {
  arrayBuffer?: () => Promise<ArrayBuffer>
}

export type DocumentAnalyzer = {
  id: string
  analyze(file: UploadedFile): Promise<DocumentAnalysis>
}

export type StructuredAiRequest<T> = {
  schemaName: string
  schema: unknown
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  model?: string
  metadata?: Record<string, unknown>
  validate?(value: unknown): value is T
}

export type StructuredAiResult<T> = {
  value: T | null
  rawText: string
  providerId: string
}

export type AiProvider = {
  id: string
  completeStructured<T>(
    request: StructuredAiRequest<T>,
  ): Promise<StructuredAiResult<T>>
}
