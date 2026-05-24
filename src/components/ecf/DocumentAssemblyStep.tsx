import { FileArchive } from 'lucide-react'

import type { FilingDraft, FilingMetadata, UploadedDocument } from '../../domain/types'

function formatLabel(value: string) {
  return value
    .replaceAll('_', ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bPdf\b/g, 'PDF')
}

function formatDocumentAnalysis(document: UploadedDocument) {
  const status = document.textExtractionStatus ?? document.analysis?.textExtractionStatus
  const recordCites = document.analysis?.recordCitations?.length ?? 0
  const appendixCites = document.analysis?.appendixCitations?.length ?? 0
  if (!status) return document.extractedSignals.join(', ') || 'metadata only'
  return `${formatLabel(status)} - ${recordCites} record cite${recordCites === 1 ? '' : 's'} - ${appendixCites} appendix cite${appendixCites === 1 ? '' : 's'}`
}

function certificateStatus(document: UploadedDocument) {
  const service = document.analysis?.certificateOfServiceDetected
  const compliance = document.analysis?.certificateOfComplianceDetected
  if (service && compliance) return 'service + compliance'
  if (service) return 'service'
  if (compliance) return 'compliance'
  return 'not detected'
}

function DocumentMetric({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded border border-[#d8d1c4] bg-[#fbfaf7] px-2 py-1 text-xs font-medium text-[#3e4843]">
      {label}: {value}
    </span>
  )
}

export function DocumentAssemblyStep({
  documentError,
  documentPending,
  draft,
  metadata,
  onDocumentsSelected,
  onDraftChange,
  onMetadataChange,
}: {
  documentError: string
  documentPending: boolean
  draft: FilingDraft
  metadata: FilingMetadata
  onDocumentsSelected: (files: FileList | null) => void
  onDraftChange: (draft: FilingDraft) => void
  onMetadataChange: (metadata: FilingMetadata) => void
}) {
  return (
    <section className="space-y-4">
      <label className="block space-y-2 text-sm font-medium">
        PDF documents
        <div className="grid min-h-36 place-items-center rounded-lg border border-dashed border-[#b7aa98] bg-white px-4 py-6 text-center">
          <div>
            <FileArchive className="mx-auto h-8 w-8 text-[#1d4d4f]" aria-hidden="true" />
            <input
              accept="application/pdf"
              className="mt-4 w-full max-w-sm text-sm"
              disabled={documentPending}
              multiple
              onChange={(event) => onDocumentsSelected(event.target.files)}
              type="file"
            />
            {documentPending ? (
              <div className="mt-3 text-xs font-semibold text-[#68716c]">
                Extracting PDF text and storing upload...
              </div>
            ) : null}
            {documentError ? (
              <div className="mt-3 text-xs font-semibold text-[#8a321f]">
                {documentError}
              </div>
            ) : null}
          </div>
        </div>
      </label>

      {draft.documents.length ? (
        <div className="divide-y divide-[#e2dbcf] rounded-lg border border-[#e2dbcf] bg-white">
          {draft.documents.map((document, index) => (
            <div className="grid gap-2 px-3 py-3 text-sm md:grid-cols-[1fr_auto]" key={document.id}>
              <div>
                <div className="font-semibold">
                  {index === 0 ? 'Main document: ' : 'Attachment: '}
                  {document.fileName}
                </div>
                <div className="text-xs text-[#68716c]">
                  {(document.sizeBytes / 1024).toFixed(1)} KB - {formatDocumentAnalysis(document)}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <DocumentMetric label="Text" value={formatLabel(document.textExtractionStatus ?? document.analysis?.textExtractionStatus ?? 'fallback')} />
                  <DocumentMetric label="Pages" value={String(document.pageCount ?? document.analysis?.pageCount ?? 'n/a')} />
                  <DocumentMetric label="Words" value={String(document.wordCount ?? document.analysis?.wordCount ?? 'n/a')} />
                  <DocumentMetric label="Certificates" value={certificateStatus(document)} />
                  <DocumentMetric label="Record cites" value={String(document.analysis?.recordCitations?.length ?? 0)} />
                </div>
              </div>
              <span className="h-fit rounded bg-[#eef1ed] px-2 py-1 text-xs font-semibold text-[#4f5f57]">
                {document.mimeType}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex h-11 items-center justify-between rounded-md border border-[#c9c1b3] bg-white px-3 text-sm font-semibold">
          Service
          <input
            checked={draft.certificateOfService}
            className="h-4 w-4 accent-[#1d4d4f]"
            onChange={(event) => {
              onDraftChange({ ...draft, certificateOfService: event.target.checked })
              onMetadataChange({ ...metadata, certificateOfService: event.target.checked })
            }}
            type="checkbox"
          />
        </label>
        <label className="flex h-11 items-center justify-between rounded-md border border-[#c9c1b3] bg-white px-3 text-sm font-semibold">
          Compliance
          <input
            checked={draft.certificateOfCompliance}
            className="h-4 w-4 accent-[#1d4d4f]"
            onChange={(event) => {
              onDraftChange({ ...draft, certificateOfCompliance: event.target.checked })
              onMetadataChange({ ...metadata, certificateOfCompliance: event.target.checked })
            }}
            type="checkbox"
          />
        </label>
        <label className="flex h-11 items-center justify-between rounded-md border border-[#c9c1b3] bg-white px-3 text-sm font-semibold">
          Sealed
          <input
            checked={draft.sealed}
            className="h-4 w-4 accent-[#1d4d4f]"
            onChange={(event) => {
              const sealed = event.target.checked
              onDraftChange({ ...draft, sealed })
              onMetadataChange({
                ...metadata,
                sealed,
                redactionAcknowledged: sealed ? metadata.redactionAcknowledged : true,
                privacyAcknowledged: sealed ? metadata.privacyAcknowledged : true,
                publicRedactedVersionIncluded: sealed
                  ? metadata.publicRedactedVersionIncluded
                  : true,
                ...(sealed && !metadata.sealedDocumentType
                  ? { sealedDocumentType: 'sealed material' }
                  : {}),
              })
            }}
            type="checkbox"
          />
        </label>
      </div>

      <label className="block space-y-2 text-sm font-medium">
        Filing notes
        <textarea
          className="min-h-28 w-full rounded-md border border-[#c9c1b3] bg-white p-3"
          onChange={(event) => onDraftChange({ ...draft, notes: event.target.value })}
          value={draft.notes}
        />
      </label>
    </section>
  )
}
