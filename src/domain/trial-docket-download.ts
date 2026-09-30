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

import { createSyntheticPdf, wrapPdfWords } from './synthetic-pdf'
import type { TrialDocketDocument, TrialDocketEntry } from './types'
import { findCa4FormTemplate } from '../packages/trial-record-pdfs'

export function ca4FormTemplateForTrialDocketDocument(
  entry: TrialDocketEntry,
  document: TrialDocketDocument,
) {
  return findCa4FormTemplate(`${document.label} ${entry.title} ${document.fileName}`)
}

export function canCreateTrialDocketDocumentPdf(document: TrialDocketDocument) {
  return (
    document.mimeType === 'application/pdf' && Boolean(document.extractedText)
  )
}

export function createTrialDocketDocumentPdf(
  entry: TrialDocketEntry,
  document: TrialDocketDocument,
) {
  const text =
    document.extractedText ?? `${document.label}. ${entry.title}. ${entry.text}`
  return createSyntheticPdf(
    `${entry.title} - ${document.label}`,
    wrapPdfWords(text),
  )
}
