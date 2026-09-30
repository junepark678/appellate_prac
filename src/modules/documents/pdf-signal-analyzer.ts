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

import type { DocumentAnalyzer } from '../types'

export const pdfSignalAnalyzer: DocumentAnalyzer = {
  id: 'pdf-signal-analyzer',
  async analyze(file) {
    const normalizedName = file.fileName.toLowerCase()
    const signals = file.extractedSignals.map((signal) => signal.toLowerCase())
    const searchableText = signals.length > 0
    const certificateOfServiceDetected =
      signals.includes('certificate of service') || normalizedName.includes('service')
    const certificateOfComplianceDetected =
      signals.includes('certificate of compliance') ||
      normalizedName.includes('compliance')
    const sealedOrRedactionWarning =
      normalizedName.includes('sealed') ||
      normalizedName.includes('redacted') ||
      normalizedName.includes('confidential')

    return {
      analyzerId: 'pdf-signal-analyzer',
      pageCount: file.pageCount,
      fileSizeBytes: file.sizeBytes,
      mimeType: file.mimeType,
      searchableText,
      normalizedText: signals.join(' '),
      wordCount: signals.join(' ').split(/\s+/).filter(Boolean).length,
      sectionMap: [],
      certificateOfServiceDetected,
      certificateOfComplianceDetected,
      certificateSnippets: [],
      legalCitations: [],
      recordCitations: signals.filter((signal) => signal.includes('record citation')),
      appendixCitations: signals.filter((signal) => signal.includes('appendix')),
      sealedOrRedactionWarning,
      privacySealWarnings: sealedOrRedactionWarning
        ? ['Filename suggests seal, redaction, or confidentiality review.']
        : [],
      textExtractionStatus: searchableText ? 'fallback' : 'not_searchable',
      extractionConfidence: searchableText ? 0.25 : 0.1,
      warnings: [
        ...(file.mimeType !== 'application/pdf' ? ['Document is not a PDF.'] : []),
        ...(file.sizeBytes > 25 * 1024 * 1024
          ? ['Document exceeds the simulator e-filing size warning threshold.']
          : []),
        ...(!searchableText ? ['No searchable text signal was detected.'] : []),
        ...(sealedOrRedactionWarning
          ? ['Filename suggests seal, redaction, or confidentiality review.']
          : []),
      ],
    }
  },
}
