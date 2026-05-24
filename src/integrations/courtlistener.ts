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

export async function searchCourtListenerDockets(
  query: string,
  token?: string,
): Promise<CourtListenerSearchResult[]> {
  const url = new URL(`${courtListenerBase}/search/`)
  url.searchParams.set('type', 'r')
  url.searchParams.set('q', query)
  url.searchParams.set('order_by', 'score desc')

  const response = await fetch(url, {
    headers: token ? { Authorization: `Token ${token}` } : undefined,
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

  const response = await fetch(url, {
    headers: token ? { Authorization: `Token ${token}` } : undefined,
  })

  if (!response.ok) {
    throw new Error(`RECAP document lookup failed: ${response.status}`)
  }

  const payload = (await response.json()) as { results?: RecapDocumentSummary[] }
  return payload.results ?? []
}

async function fetchCourtListener<T>(path: string, token?: string): Promise<T> {
  const response = await fetch(`${courtListenerBase}${path}`, {
    headers: token ? { Authorization: `Token ${token}` } : undefined,
  })

  if (!response.ok) {
    throw new Error(`CourtListener request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
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
  const payload = await fetchCourtListener<{ results?: CourtListenerDocketEntry[] }>(
    `/docket-entries/?docket=${docketId}`,
    token,
  )
  return payload.results ?? []
}

export async function getCourtListenerParties(
  docketId: number,
  token?: string,
): Promise<CourtListenerParty[]> {
  const payload = await fetchCourtListener<{ results?: CourtListenerParty[] }>(
    `/parties/?docket=${docketId}`,
    token,
  )
  return payload.results ?? []
}

export async function getCourtListenerAttorneys(
  docketId: number,
  token?: string,
): Promise<CourtListenerAttorney[]> {
  const payload = await fetchCourtListener<{ results?: CourtListenerAttorney[] }>(
    `/attorneys/?docket=${docketId}`,
    token,
  )
  return payload.results ?? []
}
