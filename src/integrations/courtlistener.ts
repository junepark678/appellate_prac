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

export type CourtListenerSearchResult = {
  id: number
  absolute_url?: string
  caseName?: string
  caseNameFull?: string
  docket_id?: number
  docketNumber?: string
  court?: string
  court_id?: string
  dateFiled?: string
  more_docs?: boolean
  snippet?: string
}

export type RecapDocumentSummary = {
  id: number
  description?: string
  document_number?: string
  is_available?: boolean
  is_sealed?: boolean
  page_count?: number
  absolute_url?: string
}

export type CourtListenerDocket = {
  id: number
  absolute_url?: string
  case_name?: string
  docket_number?: string
  court_id?: string
  date_filed?: string
}

export type CourtListenerDocketEntry = {
  id: number
  entry_number?: number
  date_filed?: string
  description?: string
  recap_documents?: RecapDocumentSummary[]
}

export type CourtListenerParty = {
  id: number
  name?: string
  party_types?: Array<{ name?: string }>
}

export type CourtListenerAttorney = {
  id: number
  name?: string
  contact_raw?: string
}

const courtListenerBase = 'https://www.courtlistener.com/api/rest/v4'
const courtListenerTimeoutMs = 12_000
const maxCourtListenerPages = 5

function timeoutSignal(ms: number) {
  if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
    return AbortSignal.timeout(ms)
  }
  const controller = new AbortController()
  setTimeout(() => controller.abort(), ms)
  return controller.signal
}

function authorizationHeaders(token?: string) {
  return token ? { Authorization: `Token ${token}` } : undefined
}

export async function searchCourtListenerDockets(
  query: string,
  token?: string,
): Promise<CourtListenerSearchResult[]> {
  const url = new URL(`${courtListenerBase}/search/`)
  url.searchParams.set('type', 'r')
  url.searchParams.set('q', query)
  url.searchParams.set('order_by', 'score desc')

  const response = await fetch(url, {
    headers: authorizationHeaders(token),
    signal: timeoutSignal(courtListenerTimeoutMs),
  })

  if (!response.ok) {
    throw new Error(`CourtListener search failed: ${response.status}`)
  }

  const payload = (await response.json()) as {
    results?: Array<{
      id?: number
      absolute_url?: string
      caseName?: string
      caseNameFull?: string
      docket_id?: number
      docketNumber?: string
      court?: string
      court_id?: string
      dateFiled?: string
      more_docs?: boolean
      snippet?: string
    }>
  }

  return (payload.results ?? [])
    .filter((result): result is CourtListenerSearchResult => typeof result.id === 'number')
    .slice(0, 20)
}

export async function getRecapDocumentsForDocketEntry(
  docketEntryId: number,
  token?: string,
): Promise<RecapDocumentSummary[]> {
  const url = new URL(`${courtListenerBase}/recap-documents/`)
  url.searchParams.set('docket_entry', String(docketEntryId))
  url.searchParams.set('fields', 'id,description,document_number,is_available,is_sealed,page_count,absolute_url')
  return fetchCourtListenerPaginated<RecapDocumentSummary>(
    `/recap-documents/?${url.searchParams.toString()}`,
    token,
  )
}

async function fetchCourtListener<T>(path: string, token?: string): Promise<T> {
  const response = await fetch(`${courtListenerBase}${path}`, {
    headers: authorizationHeaders(token),
    signal: timeoutSignal(courtListenerTimeoutMs),
  })

  if (!response.ok) {
    throw new Error(`CourtListener request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

async function fetchCourtListenerUrl<T>(url: string, token?: string): Promise<T> {
  const parsed = new URL(url)
  if (parsed.origin !== new URL(courtListenerBase).origin) {
    throw new Error('CourtListener pagination returned an unexpected origin')
  }
  const response = await fetch(parsed, {
    headers: authorizationHeaders(token),
    signal: timeoutSignal(courtListenerTimeoutMs),
  })

  if (!response.ok) {
    throw new Error(`CourtListener request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

async function fetchCourtListenerPaginated<T>(
  path: string,
  token?: string,
): Promise<T[]> {
  const results: T[] = []
  let nextUrl: string | undefined = `${courtListenerBase}${path}`
  let pages = 0

  while (nextUrl && pages < maxCourtListenerPages) {
    const payload: { results?: T[]; next?: string | null } =
      await fetchCourtListenerUrl<{ results?: T[]; next?: string | null }>(
        nextUrl,
        token,
      )
    results.push(...(payload.results ?? []))
    nextUrl = payload.next ?? undefined
    pages += 1
  }

  return results
}

export async function getCourtListenerDocket(
  docketId: number,
  token?: string,
): Promise<CourtListenerDocket> {
  return fetchCourtListener<CourtListenerDocket>(`/dockets/${docketId}/`, token)
}

export async function getCourtListenerDocketEntries(
  docketId: number,
  token?: string,
): Promise<CourtListenerDocketEntry[]> {
  return fetchCourtListenerPaginated<CourtListenerDocketEntry>(
    `/docket-entries/?docket=${docketId}`,
    token,
  )
}

export async function getCourtListenerParties(
  docketId: number,
  token?: string,
): Promise<CourtListenerParty[]> {
  return fetchCourtListenerPaginated<CourtListenerParty>(`/parties/?docket=${docketId}`, token)
}

export async function getCourtListenerAttorneys(
  docketId: number,
  token?: string,
): Promise<CourtListenerAttorney[]> {
  return fetchCourtListenerPaginated<CourtListenerAttorney>(
    `/attorneys/?docket=${docketId}`,
    token,
  )
}
