import { FileCheck2 } from 'lucide-react'

import {
  buildNoticeOfDocketActivityPreview,
  filingDraftToSubmission,
} from '../../domain/filing/ecf'
import type {
  CaseSession,
  EcfEventAvailability,
  FilingDraft,
  FilingMetadata,
  FilingSubmission,
  ValidationIssue,
} from '../../domain/types'

function formatLabel(value: string) {
  return value
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bEcf\b/g, 'ECF')
    .replace(/\bPdf\b/g, 'PDF')
}

function nextOpenDeadline(session: CaseSession) {
  return session.deadlines
    .filter((deadline) => deadline.status === 'open')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
}

const utcDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
})

function formatDateUtc(value: string) {
  return utcDateFormatter.format(new Date(value))
}

export function submissionPreview(
  draft: FilingDraft,
  metadata: FilingMetadata,
): FilingSubmission | null {
  return filingDraftToSubmission(draft, metadata)
}

export function ReceiptPreview({
  draft,
  event,
  metadata,
  session,
  validationIssues,
}: {
  draft: FilingDraft
  event: EcfEventAvailability | null
  metadata: FilingMetadata
  session: CaseSession
  validationIssues: ValidationIssue[]
}) {
  const submission = submissionPreview(draft, metadata)
  const preview = submission ? buildNoticeOfDocketActivityPreview(session, submission) : null
  const nextDeadline = nextOpenDeadline(session)
  const warnings = validationIssues.filter((issue) => issue.severity === 'warning')
  const deficiencies = validationIssues.filter((issue) => issue.severity === 'error')

  return (
    <section className="rounded-lg border border-[#e2dbcf] bg-white p-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
        <FileCheck2 className="h-4 w-4" aria-hidden="true" />
        NODA Preview
      </div>
      <div className="space-y-3 text-sm">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#7c827d]">
            Docket text
          </div>
          <p className="mt-1 leading-6 text-[#3e4843]">
            {preview?.docketText ?? 'Attach a main PDF to preview docket text.'}
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <InfoBlock label="Event" value={event?.displayName ?? draft.eventId} />
          <InfoBlock
            label="Filing ID"
            value={preview?.receiptNumber ? `${preview.receiptNumber}-preview` : 'Pending'}
          />
          <InfoBlock
            label="Next deadline"
            value={
              nextDeadline
                ? `${nextDeadline.label} (${formatDateUtc(nextDeadline.dueDate)})`
                : 'None'
            }
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <InfoBlock
            label="Documents"
            value={
              draft.documents.length
                ? draft.documents
                    .map((document, index) =>
                      index === 0
                        ? `Main: ${document.fileName}`
                        : `Attachment: ${document.fileName}`,
                    )
                    .join('; ')
                : 'None'
            }
          />
          <InfoBlock
            label="Service recipients"
            value={preview?.recipients.join(', ') || 'None'}
          />
        </div>
        {warnings.length || deficiencies.length ? (
          <div className="grid gap-2">
            {warnings.map((warning) => (
              <div className="rounded-md border border-[#ead7a7] bg-[#fff8e5] p-2 text-xs font-medium text-[#785b16]" key={warning.code ?? warning.message}>
                Warning: {warning.message}
              </div>
            ))}
            {deficiencies.map((deficiency) => (
              <div className="rounded-md border border-[#edc6bc] bg-[#fff1ee] p-2 text-xs font-medium text-[#8a321f]" key={deficiency.code ?? deficiency.message}>
                Deficiency: {deficiency.message}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-[#c8dfcb] bg-[#eff8f0] p-2 text-xs font-semibold text-[#285b38]">
            {formatLabel('receipt_preview_ready')}
          </div>
        )}
      </div>
    </section>
  )
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#7c827d]">
        {label}
      </div>
      <div className="mt-1 leading-snug">{value}</div>
    </div>
  )
}
