import type {
  CaseSession,
  EcfEventAvailability,
  FilingDraft,
  FilingMetadata,
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

function participantOptions(session: CaseSession, event: EcfEventAvailability | null) {
  if (!event) return []
  return session.participants.filter((participant) =>
    event.eligibleRoles.includes(participant.role),
  )
}

export function FilingMetadataStep({
  draft,
  event,
  metadata,
  session,
  onDraftChange,
  onMetadataChange,
}: {
  draft: FilingDraft
  event: EcfEventAvailability | null
  metadata: FilingMetadata
  session: CaseSession
  onDraftChange: (draft: FilingDraft) => void
  onMetadataChange: (metadata: FilingMetadata) => void
}) {
  const parties = participantOptions(session, event)
  const selectedRelated = metadata.relatedDocketEntryId ?? ''

  return (
    <section className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm font-medium">
          Filing title
          <input
            className="h-11 w-full rounded-md border border-[#c9c1b3] bg-white px-3"
            onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
            value={draft.title}
          />
        </label>
        <label className="space-y-2 text-sm font-medium">
          Filing attorney
          <input
            className="h-11 w-full rounded-md border border-[#c9c1b3] bg-white px-3"
            onChange={(event) =>
              onMetadataChange({ ...metadata, filingAttorneyName: event.target.value })
            }
            value={metadata.filingAttorneyName ?? ''}
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm font-medium">
          Party represented
          <select
            className="h-11 w-full rounded-md border border-[#c9c1b3] bg-white px-3"
            onChange={(event) =>
              onMetadataChange({ ...metadata, representedPartyId: event.target.value })
            }
            value={metadata.representedPartyId ?? parties[0]?.id ?? ''}
          >
            {parties.map((party) => (
              <option key={party.id} value={party.id}>
                {party.displayName} ({formatLabel(party.role)})
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-sm font-medium">
          Fee status
          <select
            className="h-11 w-full rounded-md border border-[#c9c1b3] bg-white px-3"
            onChange={(event) =>
              onMetadataChange({
                ...metadata,
                feePaymentStatus: event.target.value as FilingMetadata['feePaymentStatus'],
              })
            }
            value={metadata.feePaymentStatus ?? 'not_required'}
          >
            {['not_required', 'paid', 'deferred', 'waived', 'pending'].map((option) => (
              <option key={option} value={option}>
                {formatLabel(option)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {event?.requiresReliefText ? (
        <label className="block space-y-2 text-sm font-medium">
          Relief requested
          <textarea
            className="min-h-24 w-full rounded-md border border-[#c9c1b3] bg-white p-3"
            onChange={(event) =>
              onMetadataChange({ ...metadata, reliefRequested: event.target.value })
            }
            value={metadata.reliefRequested ?? ''}
          />
        </label>
      ) : null}

      {event?.requiresRelatedEntry ? (
        <label className="block space-y-2 text-sm font-medium">
          Related docket entry
          <select
            className="h-11 w-full rounded-md border border-[#c9c1b3] bg-white px-3"
            onChange={(event) =>
              onMetadataChange({ ...metadata, relatedDocketEntryId: event.target.value })
            }
            value={selectedRelated}
          >
            <option value="">Select related entry</option>
            {session.docketEntries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.entryNumber}. {entry.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {event?.category === 'sealed' || metadata.sealed ? (
        <section className="grid gap-4 rounded-lg border border-[#e2dbcf] bg-white p-3 md:grid-cols-2">
          <label className="space-y-2 text-sm font-medium">
            Sealed document type
            <select
              className="h-11 w-full rounded-md border border-[#c9c1b3] bg-white px-3"
              onChange={(event) =>
                onMetadataChange({ ...metadata, sealedDocumentType: event.target.value })
              }
              value={metadata.sealedDocumentType ?? ''}
            >
              <option value="">Select sealed type</option>
              <option value="sealed brief">Sealed Brief</option>
              <option value="sealed appendix">Sealed Appendix</option>
              <option value="sealed document">Sealed Document</option>
              <option value="motion to seal">Motion To Seal</option>
            </select>
          </label>
          <div className="grid gap-2">
            <label className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-[#c9c1b3] bg-white px-3 text-sm font-semibold">
              Privacy acknowledged
              <input
                checked={metadata.privacyAcknowledged ?? false}
                className="h-4 w-4 accent-[#1d4d4f]"
                onChange={(event) =>
                  onMetadataChange({
                    ...metadata,
                    privacyAcknowledged: event.target.checked,
                    redactionAcknowledged: event.target.checked,
                  })
                }
                type="checkbox"
              />
            </label>
            <label className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-[#c9c1b3] bg-white px-3 text-sm font-semibold">
              Public redacted version
              <input
                checked={metadata.publicRedactedVersionIncluded ?? false}
                className="h-4 w-4 accent-[#1d4d4f]"
                onChange={(event) =>
                  onMetadataChange({
                    ...metadata,
                    publicRedactedVersionIncluded: event.target.checked,
                  })
                }
                type="checkbox"
              />
            </label>
          </div>
        </section>
      ) : null}
    </section>
  )
}

