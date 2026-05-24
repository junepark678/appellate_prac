import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { EcfEventAvailability, ParticipantRole } from '../../domain/types'

function formatLabel(value: string) {
  return value
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bEcf\b/g, 'ECF')
    .replace(/\bCm\b/g, 'CM')
}

export function EventSelector({
  events,
  learnerRole,
  selectedEventId,
  onSelect,
}: {
  events: EcfEventAvailability[]
  learnerRole: ParticipantRole
  selectedEventId: string
  onSelect: (eventId: string) => void
}) {
  const [query, setQuery] = useState('')
  const filteredEvents = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return events
    return events.filter((event) =>
      [
        event.displayName,
        event.eventId,
        event.courtEventCode,
        event.category,
        event.menuPath.join(' '),
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalized),
    )
  }, [events, query])

  return (
    <section className="space-y-3">
      <label className="block text-sm font-medium">
        Event search
        <div className="mt-2 flex h-11 items-center gap-2 rounded-md border border-[#c9c1b3] bg-white px-3">
          <Search className="h-4 w-4 text-[#68716c]" aria-hidden="true" />
          <input
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search event, code, or menu"
            value={query}
          />
        </div>
      </label>
      <div className="max-h-[520px] divide-y divide-[#e2dbcf] overflow-auto rounded-lg border border-[#e2dbcf] bg-white">
        {filteredEvents.map((event) => {
          const roleAllowed = event.eligibleRoles.includes(learnerRole)
          const enabled = event.available && roleAllowed
          const selected = event.eventId === selectedEventId
          return (
            <button
              className={`grid w-full gap-2 p-3 text-left text-sm ${
                selected ? 'bg-[#eef6f3]' : 'hover:bg-[#fbfaf7]'
              } ${enabled ? '' : 'opacity-70'}`}
              disabled={!enabled}
              key={event.eventId}
              onClick={() => onSelect(event.eventId)}
              type="button"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{event.displayName}</span>
                <span className="rounded bg-[#eef1ed] px-2 py-1 text-xs font-semibold text-[#4f5f57]">
                  {event.courtEventCode}
                </span>
                <span className="rounded border border-[#d8d1c4] bg-white px-2 py-1 text-xs">
                  {formatLabel(event.category)}
                </span>
              </div>
              <div className="text-xs font-medium text-[#3e4843]">
                Court event: {event.courtEventName ?? event.displayName}
              </div>
              <div className="text-xs text-[#68716c]">{event.menuPath.join(' > ')}</div>
              {event.sourceUrl ? (
                <div className="break-all text-xs font-semibold text-[#1d4d4f]">
                  Source: {event.sourceUrl}
                </div>
              ) : null}
              {!roleAllowed ? (
                <div className="text-xs font-medium text-[#8a321f]">
                  {formatLabel(learnerRole)} cannot file this event.
                </div>
              ) : event.unavailableReasons.length ? (
                <div className="text-xs font-medium text-[#785b16]">
                  {event.unavailableReasons.join(' ')}
                </div>
              ) : event.availabilityReason ? (
                <div className="text-xs font-medium text-[#285b38]">
                  {event.availabilityReason}
                </div>
              ) : null}
            </button>
          )
        })}
      </div>
    </section>
  )
}
