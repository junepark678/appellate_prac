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
): TrialDocketEntry {
  return {
    id: `${scenario.id}-fallback-${String(entryNumber).padStart(3, '0')}`,
    entryNumber,
    filedAt,
    title,
    text,
    documents: [fallbackDocument(scenario, entryNumber, title)],
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
    ),
    fallbackEntry(
      scenario,
      18,
      '2025-11-03T16:20:00.000Z',
      'Dispositive Motion or Response',
      `Dispositive motion practice in the lower tribunal. Posture: ${scenario.proceduralPosture}`,
    ),
    fallbackEntry(
      scenario,
      31,
      '2026-02-06T19:45:00.000Z',
      'Opinion and Order',
      `The lower tribunal issued an order creating the appellate posture for ${scenario.shortCaption}.`,
    ),
    fallbackEntry(
      scenario,
      32,
      '2026-02-06T19:48:00.000Z',
      'Judgment or Appealable Order',
      `Judgment or appealable order entered in the ${scenario.natureOfSuit.toLowerCase()} matter.`,
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
