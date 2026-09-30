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
