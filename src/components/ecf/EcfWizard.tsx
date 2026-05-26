import { FileText, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'

import { DocumentAssemblyStep } from './DocumentAssemblyStep'
import { EventSelector } from './EventSelector'
import { FilingMetadataStep } from './FilingMetadataStep'
import { ServiceReviewStep } from './ServiceReviewStep'
import type {
  CaseSession,
  EcfEventAvailability,
  FilingDraft,
  FilingMetadata,
  ParticipantRole,
  ValidationIssue,
} from '../../domain/types'

type WizardStep = 'event' | 'metadata' | 'documents' | 'review'

const steps: Array<{ key: WizardStep; label: string }> = [
  { key: 'event', label: 'Event' },
  { key: 'metadata', label: 'Metadata' },
  { key: 'documents', label: 'Documents' },
  { key: 'review', label: 'Review' },
]

function stepIndex(step: WizardStep) {
  return steps.findIndex((candidate) => candidate.key === step)
}

function briefSignalIssue(issue: ValidationIssue) {
  return [
    'jurisdictional_statement_missing',
    'issues_presented_missing',
    'standard_of_review_missing',
    'argument_section_missing',
    'conclusion_relief_missing',
    'record_citations_missing',
    'appendix_references_missing',
  ].includes(issue.code ?? '')
}

function appendixSignalIssue(issue: ValidationIssue) {
  return (
    (issue.code ?? '').startsWith('appendix_support_') ||
    (issue.code ?? '').startsWith('issue_coverage_')
  )
}

export function EcfWizard({
  busy,
  documentError,
  documentPending,
  draft,
  eventAvailability,
  learnerRole,
  metadata,
  session,
  validationIssues,
  onDocumentsSelected,
  onDraftChange,
  onMetadataChange,
  onReset,
  onSubmit,
}: {
  busy: boolean
  documentError: string
  documentPending: boolean
  draft: FilingDraft
  eventAvailability: EcfEventAvailability[]
  learnerRole: ParticipantRole
  metadata: FilingMetadata
  session: CaseSession
  validationIssues: ValidationIssue[]
  onDocumentsSelected: (files: FileList | null) => void
  onDraftChange: (draft: FilingDraft) => void
  onMetadataChange: (metadata: FilingMetadata) => void
  onReset: (eventId?: string) => void
  onSubmit: () => void
}) {
  const [activeStep, setActiveStep] = useState<WizardStep>('event')
  const selectedEvent = useMemo(
    () => eventAvailability.find((event) => event.eventId === draft.eventId) ?? null,
    [draft.eventId, eventAvailability],
  )
  const currentStepIndex = stepIndex(activeStep)
  const signalWarnings = validationIssues.filter(
    (issue) => briefSignalIssue(issue) || appendixSignalIssue(issue),
  )

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7] p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
            <FileText className="h-4 w-4" aria-hidden="true" />
            CM/ECF Filing Workflow
          </div>
          <button
            className="flex h-9 items-center gap-2 rounded-md border border-[#d8d1c4] bg-white px-3 text-sm font-semibold"
            onClick={() => onReset()}
            type="button"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Reset
          </button>
        </div>

        <div className="mb-4 grid gap-2 md:grid-cols-4">
          {steps.map((step, index) => (
            <button
              className={`rounded-md border px-3 py-2 text-left text-sm ${
                activeStep === step.key
                  ? 'border-[#1d4d4f] bg-[#eef6f3]'
                  : 'border-[#d8d1c4] bg-white'
              }`}
              key={step.key}
              onClick={() => setActiveStep(step.key)}
              type="button"
            >
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#68716c]">
                Step {index + 1}
              </div>
              <div className="mt-1 font-semibold">{step.label}</div>
            </button>
          ))}
        </div>

        {activeStep === 'event' ? (
          <EventSelector
            events={eventAvailability}
            learnerRole={learnerRole}
            onSelect={(eventId) => {
              onReset(eventId)
              setActiveStep('metadata')
            }}
            selectedEventId={draft.eventId}
          />
        ) : null}

        {activeStep === 'metadata' ? (
          <FilingMetadataStep
            draft={draft}
            event={selectedEvent}
            metadata={metadata}
            onDraftChange={onDraftChange}
            onMetadataChange={onMetadataChange}
            session={session}
          />
        ) : null}

        {activeStep === 'documents' ? (
          <DocumentAssemblyStep
            documentError={documentError}
            documentPending={documentPending}
            draft={draft}
            metadata={metadata}
            onDocumentsSelected={onDocumentsSelected}
            onDraftChange={onDraftChange}
            onMetadataChange={onMetadataChange}
          />
        ) : null}

        {activeStep === 'review' ? (
          <ServiceReviewStep
            documentPending={documentPending}
            draft={draft}
            event={selectedEvent}
            metadata={metadata}
            onMetadataChange={onMetadataChange}
            onSubmit={onSubmit}
            session={session}
            busy={busy}
            validationIssues={validationIssues}
          />
        ) : null}

        <div className="mt-4 flex justify-between gap-2">
          <button
            className="h-10 rounded-md border border-[#d8d1c4] bg-white px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            disabled={currentStepIndex === 0}
            onClick={() => setActiveStep(steps[currentStepIndex - 1]?.key ?? 'event')}
            type="button"
          >
            Back
          </button>
          <button
            className="h-10 rounded-md bg-[#1d4d4f] px-3 text-sm font-semibold text-white hover:bg-[#173f41] disabled:cursor-not-allowed disabled:bg-[#9aa6a2]"
            disabled={currentStepIndex === steps.length - 1}
            onClick={() => setActiveStep(steps[currentStepIndex + 1]?.key ?? 'review')}
            type="button"
          >
            Next
          </button>
        </div>
      </section>

      <aside className="space-y-4">
        <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7] p-4">
          <div className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
            Event Detail
          </div>
          <div className="space-y-3 text-sm">
            <InfoRow label="Event" value={selectedEvent?.displayName ?? draft.eventId} />
            <InfoRow
              label="Menu"
              value={selectedEvent?.menuPath.join(' > ') ?? 'Unavailable'}
            />
            <InfoRow
              label="Fee"
              value={selectedEvent?.feeBehavior.replaceAll('_', ' ') ?? 'none'}
            />
            <InfoRow
              label="Service"
              value={selectedEvent?.serviceBehavior.replaceAll('_', ' ') ?? 'cm ecf'}
            />
          </div>
        </section>

        {signalWarnings.length ? (
          <section className="rounded-lg border border-[#ead7a7] bg-[#fff8e5] p-3">
            <div className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#785b16]">
              Brief Analysis Warnings
            </div>
            <div className="space-y-2">
              {signalWarnings.slice(0, 6).map((warning, index) => (
                <div className="text-sm leading-5 text-[#785b16]" key={`${warning.code}-${index}`}>
                  {warning.message}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7] p-4">
          <div className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
            Validation
          </div>
          <div className="space-y-2">
            {validationIssues.length ? (
              validationIssues.slice(0, 8).map((issue, index) => (
                <div
                  className={`rounded-md border p-3 text-sm ${
                    issue.severity === 'error'
                      ? 'border-[#edc6bc] bg-[#fff1ee] text-[#8a321f]'
                      : issue.severity === 'warning'
                        ? 'border-[#ead7a7] bg-[#fff8e5] text-[#785b16]'
                        : 'border-[#cdd8e8] bg-[#f0f5ff] text-[#334f7c]'
                  }`}
                  key={`${issue.code ?? issue.message}-${index}`}
                >
                  <div className="font-semibold">{issue.severity.toUpperCase()}</div>
                  <p className="mt-1 leading-5">{issue.message}</p>
                </div>
              ))
            ) : (
              <div className="rounded-md border border-[#c8dfcb] bg-[#eff8f0] p-3 text-sm text-[#285b38]">
                Ready for filing
              </div>
            )}
          </div>
        </section>
      </aside>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#7c827d]">
        {label}
      </div>
      <div className="mt-1 leading-snug">{value}</div>
    </div>
  )
}
