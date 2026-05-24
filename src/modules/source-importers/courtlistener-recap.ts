import {
  searchCourtListenerDockets,
  type CourtListenerSearchResult,
} from '../../integrations/courtlistener'
import type { SourceCaseDraft, SourceImporter, SourceSearchResult } from '../types'

function normalizeResult(result: CourtListenerSearchResult): SourceSearchResult {
  const title = result.caseNameFull ?? result.caseName ?? `CourtListener result ${result.id}`
  return {
    id: String(result.id),
    title,
    sourceUrl: result.absolute_url
      ? `https://www.courtlistener.com${result.absolute_url}`
      : undefined,
    metadata: result as Record<string, unknown>,
  }
}

export function createCourtListenerRecapImporter(token?: string): SourceImporter {
  return {
    id: 'courtlistener-recap-metadata',
    sourceSystem: 'courtlistener',
    async search(query) {
      const results = await searchCourtListenerDockets(query, token)
      return results.map(normalizeResult)
    },
    async import(result): Promise<SourceCaseDraft> {
      return {
        title: result.title,
        source: 'generated_from_import',
        courtPackId: 'us-federal-ca4-civil-appeal',
        shortCaption: result.title,
        lowerTribunal: String(result.metadata.court ?? 'Imported lower tribunal'),
        natureOfSuit: 'Civil appeal imported from public docket metadata',
        proceduralPosture: 'Draft scenario pending human review.',
        issuesPresented: [],
        meritsRecord: [],
        sourceCaseUrl: result.sourceUrl,
        provenance: {
          importerId: 'courtlistener-recap-metadata',
          sourceSystem: 'courtlistener',
          sourceMetadata: result.metadata,
        },
      }
    },
  }
}
