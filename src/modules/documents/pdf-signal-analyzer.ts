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
      certificateOfServiceDetected,
      certificateOfComplianceDetected,
      sealedOrRedactionWarning,
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
