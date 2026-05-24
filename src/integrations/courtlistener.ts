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
