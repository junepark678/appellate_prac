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

import { CheckCircle2, FileCheck2 } from 'lucide-react'

import {
  filingDraftToSubmission,
  serviceRecipientsForSubmission,
} from '../../domain/filing/ecf'
import { ReceiptPreview } from './ReceiptPreview'
import type {
  CaseSession,
  EcfEventAvailability,
  FilingDraft,
  FilingMetadata,
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
}

function validationTone(issue: ValidationIssue) {
  if (issue.severity === 'error') return 'border-[#edc6bc] bg-[#fff1ee] text-[#8a321f]'
  if (issue.severity === 'warning') return 'border-[#ead7a7] bg-[#fff8e5] text-[#785b16]'
  return 'border-[#cdd8e8] bg-[#f0f5ff] text-[#334f7c]'
}

export function ServiceReviewStep({
  busy,
  draft,
  event,
  metadata,
  session,
  validationIssues,
  documentPending,
  onMetadataChange,
  onSubmit,
}: {
  busy: boolean
  draft: FilingDraft
  event: EcfEventAvailability | null
  metadata: FilingMetadata
  session: CaseSession
  validationIssues: ValidationIssue[]
  documentPending: boolean
  onMetadataChange: (metadata: FilingMetadata) => void
  onSubmit: () => void
}) {
  const submission = filingDraftToSubmission(draft, metadata)
  const recipients = submission ? serviceRecipientsForSubmission(session, submission) : []
  const errors = validationIssues.filter((issue) => issue.severity === 'error')
  const unavailable = event && (!event.available || !event.eligibleRoles.includes(draft.participantRole))
  const submitDisabled = busy || errors.length > 0 || documentPending || Boolean(unavailable)

  return (
    <section className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-[#e2dbcf] bg-white p-3">
          <div className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
            Service Review
          </div>
          <div className="space-y-2 text-sm">
            {recipients.map((recipient) => (
              <div className="flex items-center gap-2" key={recipient}>
                <CheckCircle2 className="h-4 w-4 text-[#285b38]" aria-hidden="true" />
                <span>{recipient}</span>
              </div>
            ))}
            {!recipients.length ? (
              <div className="text-[#68716c]">No service recipients selected.</div>
            ) : null}
          </div>
        </section>

        <section className="rounded-lg border border-[#e2dbcf] bg-white p-3">
          <div className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
            Manual Service
          </div>
          <label className="block space-y-2 text-sm font-medium">
            Additional recipients
            <textarea
              className="min-h-24 w-full rounded-md border border-[#c9c1b3] bg-white p-3"
              onChange={(event) =>
                onMetadataChange({
                  ...metadata,
                  serviceListOverrides: {
                    ...metadata.serviceListOverrides,
                    additionalRecipients: event.target.value
                      .split('\n')
                      .map((value) => value.trim())
                      .filter(Boolean),
                  },
                })
              }
              placeholder="One recipient per line"
              value={metadata.serviceListOverrides?.additionalRecipients?.join('\n') ?? ''}
            />
          </label>
        </section>
      </div>

      <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#d8d1c4] bg-white/95 p-3 shadow-sm backdrop-blur">
        <div className="text-sm font-medium text-[#3e4843]">
          {errors.length
            ? `${errors.length} filing error${errors.length === 1 ? '' : 's'} must be cured before submission.`
            : documentPending
              ? 'Document analysis is still running.'
              : unavailable
                ? 'This event is not available to the selected filer.'
                : 'Ready for final ECF submission.'}
        </div>
        <button
          className="flex h-11 items-center gap-2 rounded-md bg-[#1d4d4f] px-4 text-sm font-semibold text-white hover:bg-[#173e40] disabled:cursor-not-allowed disabled:bg-[#9aa6a2]"
          disabled={submitDisabled}
          onClick={onSubmit}
          type="button"
        >
          <FileCheck2 className="h-4 w-4" aria-hidden="true" />
          Submit ECF Filing
        </button>
      </div>

      <ReceiptPreview
        draft={draft}
        event={event}
        metadata={metadata}
        session={session}
        validationIssues={validationIssues}
      />

      {validationIssues.length ? (
        <section className="space-y-2">
          {validationIssues.map((issue, index) => (
            <div
              className={`rounded-md border p-3 text-sm ${validationTone(issue)}`}
              key={`${issue.code ?? issue.message}-${index}`}
            >
              <div className="font-semibold">{formatLabel(issue.severity)}</div>
              <p className="mt-1 leading-5">{issue.message}</p>
              {issue.cureSuggestion ? (
                <p className="mt-2 leading-5">{issue.cureSuggestion}</p>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {unavailable ? (
        <div className="rounded-md border border-[#ead7a7] bg-[#fff8e5] p-3 text-sm font-medium text-[#785b16]">
          {event?.unavailableReasons.join(' ') || 'This event is not available to the selected filer.'}
        </div>
      ) : null}

      <div className="sticky bottom-0 z-10 flex justify-end border-t border-[#e2dbcf] bg-[#fbfaf7]/95 py-3 backdrop-blur">
        <button
          className="flex h-11 items-center gap-2 rounded-md bg-[#1d4d4f] px-4 text-sm font-semibold text-white hover:bg-[#173e40] disabled:cursor-not-allowed disabled:bg-[#9aa6a2]"
          disabled={submitDisabled}
          onClick={onSubmit}
          type="button"
        >
          <FileCheck2 className="h-4 w-4" aria-hidden="true" />
          Submit ECF Filing
        </button>
      </div>
    </section>
  )
}
