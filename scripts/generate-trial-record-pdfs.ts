import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Scenario, ScenarioDocumentAsset, ScenarioTrialDocket } from '../src/domain/types'

type MutableScenario = Scenario & {
  trialDocket?: ScenarioTrialDocket
  documentAssets?: ScenarioDocumentAsset[]
}

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const seedPath = join(rootDir, 'src/domain/scenarios.seed.json')
const recordsRoot = join(rootDir, 'public/trial-records')

const fileNames = [
  '001-complaint-or-opening-pleading.pdf',
  '018-dispositive-motion-or-response.pdf',
  '031-opinion-and-order.pdf',
  '032-judgment-or-appealable-order.pdf',
] as const

function pdfEscape(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
}

function wrapWords(value: string, width = 86) {
  const words = value.replace(/\s+/g, ' ').trim().split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length > width && current) {
      lines.push(current)
      current = word
    } else {
      current = next
    }
  }
  if (current) lines.push(current)
  return lines
}

function createPdf(title: string, lines: string[]) {
  const contentLines = [
    'BT',
    '/F1 12 Tf',
    '50 760 Td',
    '14 TL',
    `(${pdfEscape(title)}) Tj`,
    'T*',
    '/F1 10 Tf',
    ...lines.flatMap((line) => [`(${pdfEscape(line)}) Tj`, 'T*']),
    'ET',
  ]
  const stream = contentLines.join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return pdf
}

function docketNumberFor(scenario: Scenario) {
  const hash = [...scenario.id].reduce(
    (value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) >>> 0,
    23,
  )
  if (scenario.courtPackId.includes('criminal')) {
    return `3:25-cr-${String((hash % 900) + 100).padStart(4, '0')}`
  }
  if (scenario.courtPackId.includes('agency')) {
    return `A${String((hash % 900000) + 100000)}`
  }
  if (scenario.courtPackId.includes('writ')) {
    return `1:26-mc-${String((hash % 900) + 100).padStart(4, '0')}`
  }
  return `1:25-cv-${String((hash % 9000) + 1000).padStart(4, '0')}`
}

function titlesFor(scenario: Scenario) {
  if (scenario.courtPackId.includes('criminal')) {
    return [
      'Indictment and Plea Agreement',
      'Sentencing Memorandum and Objections',
      'Sentencing Transcript',
      'Criminal Judgment',
    ] as const
  }
  if (scenario.courtPackId.includes('agency')) {
    return [
      'Agency Decision',
      'Certified Administrative Record Excerpts',
      'Certified Agency Order',
      'Petitionable Final Order',
    ] as const
  }
  if (scenario.courtPackId.includes('writ')) {
    return [
      'Discovery Order',
      'Stay Denial',
      'Privilege Log Excerpts',
      'Mandamus Order',
    ] as const
  }
  return [
    'Complaint',
    'Dispositive Motion or Response',
    'Memorandum Opinion and Order',
    'Judgment',
  ] as const
}

function entryTextFor(scenario: Scenario, title: string, index: number) {
  const issue = scenario.issues?.[index % Math.max(1, scenario.issues.length)]
  const excerpt = scenario.recordExcerpts?.[index % Math.max(1, scenario.recordExcerpts.length)]
  const merits = scenario.meritsRecord[index % Math.max(1, scenario.meritsRecord.length)]
  return [
    `${title} in ${scenario.shortCaption}.`,
    `Procedural posture: ${scenario.proceduralPosture}`,
    `Record material: ${merits}`,
    issue ? `Issue: ${issue.label}. Standard of review: ${issue.standardOfReview}.` : '',
    excerpt ? `Record excerpt: ${excerpt.label}. ${excerpt.text}` : '',
    `Nature of suit: ${scenario.natureOfSuit}. Lower tribunal: ${scenario.lowerTribunal}.`,
  ].filter(Boolean).join(' ')
}

function createAssets(scenario: Scenario) {
  const titles = titlesFor(scenario)
  const dir = join(recordsRoot, scenario.id)
  mkdirSync(dir, { recursive: true })

  return titles.map((title, index): ScenarioDocumentAsset => {
    const fileName = fileNames[index]
    const extractedText = entryTextFor(scenario, title, index)
    const pdf = createPdf(
      `${scenario.shortCaption} - ${title}`,
      wrapWords(extractedText),
    )
    writeFileSync(join(dir, fileName), pdf)
    return {
      id: `${scenario.id}-${fileName.replace(/\.pdf$/, '')}`,
      label: title,
      fileName,
      mimeType: 'application/pdf',
      source: 'synthetic',
      publicUrl: `/trial-records/${scenario.id}/${fileName}`,
      sizeBytes: Buffer.byteLength(pdf),
      pageCount: 1,
      extractedText,
    }
  })
}

function createTrialDocket(scenario: Scenario, assets: ScenarioDocumentAsset[]): ScenarioTrialDocket {
  const entryNumbers = [1, 18, 31, 32]
  const filedAt = [
    '2025-08-18T14:32:00.000Z',
    '2025-11-03T16:20:00.000Z',
    '2026-02-06T19:45:00.000Z',
    '2026-02-06T19:48:00.000Z',
  ]
  return {
    caption: scenario.shortCaption,
    court: scenario.lowerTribunal,
    docketNumber: docketNumberFor(scenario),
    entries: assets.map((asset, index) => ({
      id: `${scenario.id}-trial-docket-${String(entryNumbers[index]).padStart(3, '0')}`,
      entryNumber: entryNumbers[index],
      filedAt: filedAt[index],
      title: asset.label,
      text: asset.extractedText ?? entryTextFor(scenario, asset.label, index),
      documentAssetIds: [asset.id],
    })),
  }
}

const scenarios = JSON.parse(readFileSync(seedPath, 'utf8')) as MutableScenario[]

for (const scenario of scenarios) {
  const documentAssets = createAssets(scenario)
  scenario.documentAssets = documentAssets
  scenario.trialDocket = createTrialDocket(scenario, documentAssets)
}

writeFileSync(seedPath, `${JSON.stringify(scenarios, null, 2)}\n`)
