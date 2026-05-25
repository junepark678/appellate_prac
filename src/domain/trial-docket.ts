import type {
  CaseSession,
  DocketEntry,
  FilingRecord,
  Scenario,
  ScenarioDocumentAsset,
  TrialDocket,
  TrialDocketDocument,
  TrialDocketEntry,
} from './types'

function isTestRuntime() {
  return typeof process !== 'undefined' && process.env.NODE_ENV === 'test'
}

function fallbackDocketNumber(scenario: Scenario) {
  const hash = [...scenario.id].reduce(
    (value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) >>> 0,
    17,
  )
  return `1:26-cv-${String((hash % 9000) + 1000).padStart(4, '0')}`
}

function scenarioRecordText(scenario: Scenario) {
  return [
    scenario.proceduralPosture,
    ...scenario.meritsRecord.slice(0, 3),
    ...(scenario.recordExcerpts?.slice(0, 2).map((excerpt) => excerpt.text) ?? []),
  ].join(' ')
}

function fallbackDocument(
  scenario: Scenario,
  entryNumber: number,
  title: string,
): TrialDocketDocument {
  const fileName = `${String(entryNumber).padStart(3, '0')}-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}.pdf`
  return {
    id: `${scenario.id}-${String(entryNumber).padStart(3, '0')}-fallback`,
    label: title,
    fileName,
    mimeType: 'application/pdf',
    source: 'synthetic',
    publicUrl: `/trial-records/${scenario.id}/${fileName}`,
    sizeBytes: Math.max(1024, scenarioRecordText(scenario).length * 20),
    pageCount: 1,
    extractedText: `${title}. ${scenario.shortCaption}. ${scenarioRecordText(scenario)}`,
  }
}

function documentFromFiling(
  filing: FilingRecord,
  document: FilingRecord['documents'][number],
): TrialDocketDocument {
  return {
    id: document.id,
    label: filing.title,
    fileName: document.fileName,
    mimeType: 'application/pdf',
    source: 'uploaded',
    ...(document.storageId ? { storageId: document.storageId } : {}),
    ...(document.sha256 ? { sha256: document.sha256 } : {}),
    sizeBytes: document.sizeBytes,
    pageCount: document.pageCount ?? 1,
    ...(document.extractedText ? { extractedText: document.extractedText } : {}),
  }
}

function filingDocumentsForEntry(
  session: CaseSession,
  entry: DocketEntry,
): TrialDocketDocument[] {
  if (!entry.filingId) return []
  const filing = session.filings.find((candidate) => candidate.id === entry.filingId)
  if (!filing) return []
  return filing.documents
    .filter((document) => document.mimeType === 'application/pdf')
    .map((document) => documentFromFiling(filing, document))
}

function fallbackEntry(
  scenario: Scenario,
  entryNumber: number,
  filedAt: string,
  title: string,
  text: string,
  attachDocument = false,
): TrialDocketEntry {
  return {
    id: `${scenario.id}-fallback-${String(entryNumber).padStart(3, '0')}`,
    entryNumber,
    filedAt,
    title,
    text,
    documents: attachDocument ? [fallbackDocument(scenario, entryNumber, title)] : [],
  }
}

function fallbackTrialEntries(session: CaseSession): TrialDocketEntry[] {
  const { scenario } = session
  const lowerCourtEntries = [
    fallbackEntry(
      scenario,
      1,
      '2025-08-18T14:32:00.000Z',
      'Opening Pleading',
      `Opening pleading filed in ${scenario.shortCaption}. Nature of suit: ${scenario.natureOfSuit}.`,
      true,
    ),
    fallbackEntry(
      scenario,
      2,
      '2025-08-18T14:36:00.000Z',
      'Civil Cover Sheet',
      `Civil cover sheet filed. Nature of suit: ${scenario.natureOfSuit}.`,
    ),
    fallbackEntry(
      scenario,
      3,
      '2025-08-19T15:13:00.000Z',
      'Summons Issued',
      'Summons issued as to defendant or respondent.',
    ),
    fallbackEntry(
      scenario,
      4,
      '2025-08-28T17:22:00.000Z',
      'Return of Service',
      'Service returned executed and response deadline set.',
    ),
    fallbackEntry(
      scenario,
      5,
      '2025-09-04T16:20:00.000Z',
      'Notice of Appearance',
      'Counsel appeared for opposing party.',
    ),
    fallbackEntry(
      scenario,
      6,
      '2025-09-15T15:45:00.000Z',
      'Responsive Pleading',
      'Responsive pleading filed with defenses and admissions.',
    ),
    fallbackEntry(
      scenario,
      7,
      '2025-09-29T18:10:00.000Z',
      'Rule 26(f) Report',
      'Joint discovery plan filed by the parties.',
    ),
    fallbackEntry(
      scenario,
      8,
      '2025-10-03T14:05:00.000Z',
      'Scheduling Order',
      'Court entered discovery and dispositive-motion schedule.',
    ),
    fallbackEntry(
      scenario,
      9,
      '2025-10-28T15:18:00.000Z',
      'Protective Order',
      'Protective order entered for confidential discovery material.',
    ),
    fallbackEntry(
      scenario,
      10,
      '2025-11-12T17:24:00.000Z',
      'Discovery Motion',
      'Discovery motion filed concerning materials later relevant to appeal.',
    ),
    fallbackEntry(
      scenario,
      11,
      '2025-11-24T14:43:00.000Z',
      'Order on Discovery Motion',
      'Court resolved discovery dispute and adjusted schedule.',
    ),
    fallbackEntry(
      scenario,
      12,
      '2025-12-18T16:20:00.000Z',
      'Dispositive Motion or Response',
      `Dispositive motion practice in the lower tribunal. Posture: ${scenario.proceduralPosture}`,
      true,
    ),
    fallbackEntry(
      scenario,
      13,
      '2026-01-03T18:25:00.000Z',
      'Opposition or Response Brief',
      'Opposition brief and supporting record excerpts filed.',
    ),
    fallbackEntry(
      scenario,
      14,
      '2026-01-12T15:35:00.000Z',
      'Reply Brief',
      'Reply brief filed in support of dispositive relief.',
    ),
    fallbackEntry(
      scenario,
      15,
      '2026-01-24T19:00:00.000Z',
      'Notice of Hearing',
      'Court set hearing on dispositive or appeal-generating motion.',
    ),
    fallbackEntry(
      scenario,
      16,
      '2026-02-02T16:05:00.000Z',
      'Minute Entry for Motion Hearing',
      'Court heard argument and took the matter under advisement.',
    ),
    fallbackEntry(
      scenario,
      17,
      '2026-02-06T19:45:00.000Z',
      'Opinion and Order',
      `The lower tribunal issued an order creating the appellate posture for ${scenario.shortCaption}.`,
      true,
    ),
    fallbackEntry(
      scenario,
      18,
      '2026-02-06T19:48:00.000Z',
      'Judgment or Appealable Order',
      `Judgment or appealable order entered in the ${scenario.natureOfSuit.toLowerCase()} matter.`,
      true,
    ),
    fallbackEntry(
      scenario,
      19,
      '2026-02-10T16:18:00.000Z',
      'Notice of Appeal',
      'Notice of appeal filed from the appealable order.',
    ),
    fallbackEntry(
      scenario,
      20,
      '2026-02-13T15:22:00.000Z',
      'Record Transmitted to Court of Appeals',
      'Lower tribunal transmitted electronic record to the court of appeals.',
    ),
  ]

  const filingEntries = session.docketEntries
    .filter((entry) => entry.filingId)
    .map((entry) => {
      const documents = filingDocumentsForEntry(session, entry)
      return {
        id: entry.id,
        entryNumber: entry.entryNumber,
        filedAt: entry.filedAt,
        title: entry.title,
        text: entry.text,
        documents:
          documents.length > 0
            ? documents
            : [fallbackDocument(scenario, entry.entryNumber, entry.title)],
      }
    })

  return [...lowerCourtEntries, ...filingEntries]
}

export function createTrialDocket(session: CaseSession): TrialDocket {
  const { scenario } = session

  if (scenario.trialDocket) {
    const assetById = new Map(
      (scenario.documentAssets ?? []).map((asset) => [asset.id, asset]),
    )
    const entries = scenario.trialDocket.entries.map((entry) => {
      const documents = entry.documentAssetIds
        .map((assetId) => assetById.get(assetId))
        .filter((asset): asset is ScenarioDocumentAsset => Boolean(asset))
      if (documents.length !== entry.documentAssetIds.length && isTestRuntime()) {
        const missing = entry.documentAssetIds.filter((assetId) => !assetById.has(assetId))
        throw new Error(
          `Scenario ${scenario.id} trial docket entry ${entry.id} references missing assets: ${missing.join(', ')}`,
        )
      }
      return {
        id: entry.id,
        entryNumber: entry.entryNumber,
        filedAt: entry.filedAt,
        title: entry.title,
        text: entry.text,
        documents,
      }
    })

    return {
      caption: scenario.trialDocket.caption,
      court: scenario.trialDocket.court,
      docketNumber: scenario.trialDocket.docketNumber,
      ...(scenario.trialDocket.sourceUrl ? { sourceUrl: scenario.trialDocket.sourceUrl } : {}),
      entries,
    }
  }

  return {
    caption: scenario.shortCaption,
    court: scenario.lowerTribunal,
    docketNumber: fallbackDocketNumber(scenario),
    ...(scenario.sourceCaseUrl ? { sourceUrl: scenario.sourceCaseUrl } : {}),
    entries: fallbackTrialEntries(session),
  }
}
