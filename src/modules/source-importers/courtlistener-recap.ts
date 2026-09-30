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
