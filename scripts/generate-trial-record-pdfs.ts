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

type TrialDocketEntryDraft = {
  entryNumber: number
  day: number
  title: string
  text: string
  assetIndex?: number
}

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
  if (scenario.id.includes('preliminary-injunction')) {
    return [
      'Verified Complaint',
      'Motion for Preliminary Injunction',
      'Order Denying Preliminary Injunction',
      'Notice of Interlocutory Appeal',
    ] as const
  }
  if (scenario.id.includes('qualified-immunity')) {
    return [
      'Complaint',
      'Motion for Summary Judgment on Qualified Immunity',
      'Order Denying Qualified Immunity',
      'Notice of Interlocutory Appeal',
    ] as const
  }
  if (scenario.id.includes('post-trial')) {
    return [
      'Complaint',
      'Renewed Motion for Judgment as a Matter of Law',
      'Memorandum Opinion Denying Post-Trial Motions',
      'Final Judgment',
    ] as const
  }
  if (scenario.id.includes('finality-rule54')) {
    return [
      'Complaint',
      'Motion for Partial Summary Judgment',
      'Order Granting Partial Summary Judgment',
      'Partial Judgment Without Rule 54(b) Certification',
    ] as const
  }
  if (scenario.id.includes('sealed-foia')) {
    return [
      'FOIA Complaint',
      'Cross-Motions for Summary Judgment',
      'Memorandum Opinion and Sealing Order',
      'Final Judgment',
    ] as const
  }
  if (scenario.courtPackId.includes('criminal')) {
    return [
      'Indictment',
      'Plea Agreement and Rule 11 Transcript',
      'Sentencing Memorandum and Objections',
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
    'Motion for Summary Judgment',
    'Memorandum Opinion and Order',
    'Final Judgment',
  ] as const
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function fileNameFor(entryNumber: number, title: string) {
  return `${String(entryNumber).padStart(3, '0')}-${slugify(title)}.pdf`
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

function filing(
  entryNumber: number,
  day: number,
  title: string,
  text: string,
  assetIndex?: number,
): TrialDocketEntryDraft {
  return {
    entryNumber,
    day,
    title,
    text,
    ...(assetIndex === undefined ? {} : { assetIndex }),
  }
}

function civilSummaryJudgmentEntries(scenario: Scenario): TrialDocketEntryDraft[] {
  const titles = titlesFor(scenario)
  return [
    filing(1, 0, titles[0], `Complaint filed by plaintiff in ${scenario.shortCaption}.`, 0),
    filing(2, 0, 'Civil Cover Sheet', `Civil cover sheet filed. Nature of suit: ${scenario.natureOfSuit}.`),
    filing(3, 1, 'Summons Issued', 'Summons issued as to defendant.'),
    filing(4, 9, 'Return of Service', 'Summons returned executed; answer due set by rule.'),
    filing(5, 18, 'Notice of Appearance', 'Counsel appeared for defendant.'),
    filing(6, 28, 'Answer', 'Answer filed with affirmative defenses.'),
    filing(7, 31, 'Corporate Disclosure Statement', 'Defendant filed corporate disclosure statement.'),
    filing(8, 42, 'Rule 26(f) Report', 'Joint discovery plan filed by the parties.'),
    filing(9, 48, 'Scheduling Order', 'Initial pretrial order entered with discovery and dispositive-motion deadlines.'),
    filing(10, 74, 'Initial Disclosures', 'Initial disclosures exchanged and notice filed.'),
    filing(11, 97, 'Consent Protective Order', 'Protective order entered for confidential discovery materials.'),
    filing(12, 121, 'Motion to Compel', 'Plaintiff moved to compel production of comparator and personnel materials.'),
    filing(13, 130, 'Response to Motion to Compel', 'Defendant opposed motion to compel and asserted burden and confidentiality objections.'),
    filing(14, 137, 'Reply in Support of Motion to Compel', 'Plaintiff filed reply regarding discovery deficiencies.'),
    filing(15, 146, 'Order on Motion to Compel', 'Court granted motion to compel in part and extended fact discovery.'),
    filing(16, 167, 'Notice of Deposition Transcripts', 'Parties filed notice that deposition transcripts were received.'),
    filing(17, 190, 'Joint Motion to Amend Scheduling Order', 'Parties jointly requested limited extensions for expert and dispositive deadlines.'),
    filing(18, 195, 'Amended Scheduling Order', 'Court amended discovery and dispositive-motion deadlines.'),
    filing(19, 221, 'Expert Disclosure Notice', 'Expert disclosures served and notice filed.'),
    filing(20, 246, 'Discovery Status Report', 'Parties reported completion of fact discovery with limited follow-up production outstanding.'),
    filing(21, 270, 'Motion to Seal Summary Judgment Exhibits', 'Defendant moved to seal confidential personnel and business records.'),
    filing(22, 271, titles[1], `${titles[1]} filed with memorandum, statement of facts, and exhibits.`, 1),
    filing(23, 272, 'Statement of Undisputed Material Facts', 'Movant filed numbered statement of undisputed material facts.'),
    filing(24, 280, 'Order Granting Temporary Seal', 'Court temporarily sealed designated summary judgment exhibits pending further order.'),
    filing(25, 292, 'Response in Opposition to Summary Judgment', 'Plaintiff opposed summary judgment and filed counterstatement of disputed facts.'),
    filing(26, 292, 'Opposition Exhibits', 'Plaintiff filed deposition excerpts, declarations, and comparator records.'),
    filing(27, 301, 'Reply in Support of Summary Judgment', 'Defendant filed reply in support of summary judgment.'),
    filing(28, 303, 'Evidentiary Objections', 'Defendant objected to late-filed declaration and disputed comparator materials.'),
    filing(29, 312, 'Notice of Hearing', 'Motion hearing set on dispositive motions and sealing issues.'),
    filing(30, 327, 'Minute Entry for Motion Hearing', 'Court heard argument on summary judgment and evidentiary objections.'),
    filing(31, 344, titles[2], `${titles[2]} entered resolving dispositive motion practice.`, 2),
    filing(32, 344, titles[3], `${titles[3]} entered by the Clerk.`, 3),
    filing(33, 345, 'Bill of Costs Notice', 'Clerk issued notice concerning taxable costs.'),
    filing(34, 351, 'Notice of Appeal', 'Notice of appeal filed from the dispositive order and judgment.'),
    filing(35, 353, 'Appeal Processing Letter', 'Clerk transmitted notice of appeal and appeal processing letter.'),
    filing(36, 356, 'Transcript Order Form', 'Appellant filed transcript order form.'),
    filing(37, 361, 'Record Transmitted to Court of Appeals', 'District clerk transmitted the electronic record to the court of appeals.'),
  ]
}

function preliminaryInjunctionEntries(scenario: Scenario): TrialDocketEntryDraft[] {
  const titles = titlesFor(scenario)
  return [
    filing(1, 0, titles[0], `Verified complaint filed by plaintiffs in ${scenario.shortCaption}.`, 0),
    filing(2, 0, 'Civil Cover Sheet', `Civil cover sheet filed. Nature of suit: ${scenario.natureOfSuit}.`),
    filing(3, 0, titles[1], 'Motion for preliminary injunction filed with declarations and proposed order.', 1),
    filing(4, 1, 'Summons Issued', 'Summons issued as to municipal defendants.'),
    filing(5, 2, 'Notice of Appearance', 'Counsel appeared for city defendants.'),
    filing(6, 3, 'Motion for Expedited Briefing', 'Plaintiffs moved for expedited briefing and hearing.'),
    filing(7, 5, 'Order Setting Expedited Schedule', 'Court set an expedited opposition, reply, and hearing schedule.'),
    filing(8, 8, 'Administrative Record Lodged', 'City lodged ordinance history and enforcement materials.'),
    filing(9, 10, 'Response in Opposition', 'Defendants opposed preliminary injunction.'),
    filing(10, 12, 'Amicus Notice', 'Nonparty association filed notice seeking leave to appear as amicus.'),
    filing(11, 13, 'Reply in Support of Preliminary Injunction', 'Plaintiffs filed reply with supplemental declarations.'),
    filing(12, 16, 'Motion to Strike Supplemental Declaration', 'Defendants moved to strike supplemental declaration.'),
    filing(13, 18, 'Notice of Hearing', 'Preliminary injunction hearing set.'),
    filing(14, 24, 'Minute Entry for Preliminary Injunction Hearing', 'Court heard argument and took the motion under advisement.'),
    filing(15, 25, 'Post-Hearing Submission', 'Plaintiffs filed requested ordinance-comparison chart.'),
    filing(16, 27, 'Defendants Post-Hearing Submission', 'Defendants filed enforcement-history submission.'),
    filing(17, 34, titles[2], 'Order entered denying preliminary injunction.', 2),
    filing(18, 35, 'Motion for Injunction Pending Appeal', 'Plaintiffs moved in district court for injunction pending appeal.'),
    filing(19, 36, 'Response to Motion for Injunction Pending Appeal', 'Defendants opposed injunction pending appeal.'),
    filing(20, 39, 'Order Denying Injunction Pending Appeal', 'Court denied injunction pending appeal.'),
    filing(21, 40, titles[3], 'Notice of interlocutory appeal filed from the preliminary-injunction order.', 3),
    filing(22, 41, 'Appeal Processing Letter', 'District clerk issued appeal processing letter.'),
    filing(23, 44, 'Transcript Order Form', 'Plaintiffs ordered preliminary injunction hearing transcript.'),
    filing(24, 51, 'Record Transmitted to Court of Appeals', 'Electronic record transmitted to court of appeals.'),
  ]
}

function postTrialEntries(scenario: Scenario): TrialDocketEntryDraft[] {
  const titles = titlesFor(scenario)
  return [
    ...civilSummaryJudgmentEntries(scenario).slice(0, 20).map((entry) =>
      entry.assetIndex === 1 ? { ...entry, assetIndex: undefined } : entry,
    ),
    filing(21, 270, 'Joint Pretrial Statement', 'Parties filed joint pretrial statement, witness lists, and exhibit lists.'),
    filing(22, 271, 'Motions in Limine', 'Parties filed motions in limine before final pretrial conference.'),
    filing(23, 284, 'Final Pretrial Order', 'Final pretrial order entered with trial schedule and exhibit procedures.'),
    filing(24, 293, 'Proposed Jury Instructions', 'Parties filed competing proposed jury instructions and verdict forms.'),
    filing(25, 301, 'Minute Entry for Final Pretrial Conference', 'Court held final pretrial conference and ruled on trial logistics.'),
    filing(26, 320, 'Jury Trial Day 1', 'Jury selected and plaintiff opened its case.'),
    filing(27, 321, 'Jury Trial Day 2', 'Witness testimony continued.'),
    filing(28, 322, 'Jury Trial Day 3', 'Parties presented expert and damages testimony.'),
    filing(29, 323, 'Rule 50(a) Motion', 'Defendant moved orally for judgment as a matter of law.'),
    filing(30, 324, 'Jury Trial Day 4', 'Evidence closed and charge conference held.'),
    filing(31, 325, 'Jury Verdict', 'Jury returned verdict and damages award.'),
    filing(32, 332, 'Judgment on Jury Verdict', 'Judgment entered on jury verdict.'),
    filing(33, 359, titles[1], 'Renewed post-trial motion filed under Rules 50(b) and 59.', 1),
    filing(34, 380, 'Opposition to Post-Trial Motions', 'Opposition filed defending verdict and damages record.'),
    filing(35, 390, 'Reply in Support of Post-Trial Motions', 'Reply filed in support of renewed judgment as a matter of law and new trial.'),
    filing(36, 415, 'Notice of Post-Trial Motion Hearing', 'Post-trial motions set for hearing.'),
    filing(37, 430, 'Minute Entry for Post-Trial Motion Hearing', 'Court heard argument on post-trial motions.'),
    filing(38, 452, titles[2], 'Court denied renewed judgment as a matter of law and new-trial motion.', 2),
    filing(39, 452, titles[3], 'Final judgment entered after disposition of post-trial motions.', 3),
    filing(40, 459, 'Notice of Appeal', 'Notice of appeal filed from final judgment and post-trial order.'),
    filing(41, 464, 'Transcript Order Form', 'Appellant ordered trial and post-trial hearing transcripts.'),
    filing(42, 472, 'Record Transmitted to Court of Appeals', 'District clerk transmitted electronic record to court of appeals.'),
  ]
}

function criminalEntries(scenario: Scenario): TrialDocketEntryDraft[] {
  const titles = titlesFor(scenario)
  return [
    filing(1, 0, titles[0], `Indictment returned in ${scenario.shortCaption}.`, 0),
    filing(2, 1, 'Arrest Warrant Returned Executed', 'Arrest warrant returned executed.'),
    filing(3, 2, 'Initial Appearance', 'Initial appearance held; counsel appointed.'),
    filing(4, 2, 'Order of Detention Pending Trial', 'Defendant detained pending further proceedings.'),
    filing(5, 7, 'Arraignment', 'Defendant arraigned and entered plea of not guilty.'),
    filing(6, 9, 'Discovery Order', 'Standard criminal discovery order entered.'),
    filing(7, 18, 'Protective Order', 'Protective order entered governing discovery.'),
    filing(8, 34, 'Motion to Suppress', 'Defendant moved to suppress statements and evidence.'),
    filing(9, 49, 'Government Response to Motion to Suppress', 'Government opposed suppression motion.'),
    filing(10, 57, 'Reply in Support of Motion to Suppress', 'Defendant replied in support of suppression motion.'),
    filing(11, 70, 'Minute Entry for Suppression Hearing', 'Court held suppression hearing and took motion under advisement.'),
    filing(12, 84, 'Order Denying Motion to Suppress', 'Court denied suppression motion.'),
    filing(13, 116, 'Plea Agreement Filed Under Seal', 'Plea agreement lodged under seal pending Rule 11 hearing.'),
    filing(14, 120, titles[1], 'Guilty plea accepted after Rule 11 colloquy.', 1),
    filing(15, 121, 'Order Accepting Plea', 'Court accepted guilty plea and adjudged defendant guilty.'),
    filing(16, 154, 'Presentence Investigation Report Disclosure Notice', 'Probation disclosed draft presentence investigation report.'),
    filing(17, 172, 'Objections to Presentence Report', 'Defendant filed objections to Guidelines calculations.'),
    filing(18, 180, 'Government Response to PSR Objections', 'Government responded to presentence objections.'),
    filing(19, 196, titles[2], 'Sentencing memorandum and Guidelines objections filed.', 2),
    filing(20, 203, 'Government Sentencing Memorandum', 'Government filed sentencing memorandum.'),
    filing(21, 211, 'Final Presentence Investigation Report', 'Final presentence report filed under seal.'),
    filing(22, 226, 'Minute Entry for Sentencing', 'Sentencing hearing held; sentence pronounced.'),
    filing(23, 226, 'Statement of Reasons', 'Statement of reasons filed under seal.'),
    filing(24, 228, titles[3], 'Criminal judgment entered.', 3),
    filing(25, 232, 'Notice of Appeal', 'Defendant filed timely notice of appeal.'),
    filing(26, 234, 'Appeal Processing Letter', 'Clerk transmitted appeal processing letter.'),
    filing(27, 237, 'Transcript Order Form', 'Defendant ordered plea and sentencing transcripts.'),
    filing(28, 244, 'Record Transmitted to Court of Appeals', 'District clerk transmitted record to court of appeals.'),
  ]
}

function agencyEntries(scenario: Scenario): TrialDocketEntryDraft[] {
  const titles = titlesFor(scenario)
  return [
    filing(1, 0, 'Notice to Appear', `Removal proceedings commenced in ${scenario.shortCaption}.`),
    filing(2, 21, 'Master Calendar Hearing', 'Master calendar hearing held; pleadings taken.'),
    filing(3, 46, 'Application for Relief', 'Applications for asylum, withholding, and CAT protection filed.'),
    filing(4, 78, 'Biometrics Compliance Notice', 'Biometrics compliance notice filed.'),
    filing(5, 112, 'Government Evidence Submission', 'Department filed country conditions and identity materials.'),
    filing(6, 126, 'Respondent Evidence Submission', 'Respondent filed declaration, exhibits, and country reports.'),
    filing(7, 151, 'Individual Hearing', 'Individual merits hearing held before immigration judge.'),
    filing(8, 163, titles[0], 'Immigration judge issued oral decision denying relief.', 0),
    filing(9, 185, 'Notice of Appeal to BIA', 'Respondent appealed immigration judge decision to Board of Immigration Appeals.'),
    filing(10, 219, 'BIA Briefing Schedule', 'Board issued briefing schedule.'),
    filing(11, 247, 'Respondent BIA Brief', 'Respondent filed opening brief before the Board.'),
    filing(12, 275, 'DHS BIA Brief', 'Department filed response brief before the Board.'),
    filing(13, 313, titles[1], 'Certified administrative record excerpts assembled.', 1),
    filing(14, 342, titles[2], 'Board dismissed appeal and affirmed denial of relief.', 2),
    filing(15, 346, titles[3], 'Final administrative order became petitionable.', 3),
    filing(16, 362, 'Petition for Review', 'Petition for review filed in court of appeals.'),
    filing(17, 364, 'Certified List of Administrative Record', 'Agency certified list of administrative record filed.'),
    filing(18, 371, 'Record Filed in Court of Appeals', 'Administrative record transmitted for appellate review.'),
  ]
}

function writEntries(scenario: Scenario): TrialDocketEntryDraft[] {
  const titles = titlesFor(scenario)
  return [
    filing(1, 0, 'Complaint', `Underlying civil action opened in ${scenario.shortCaption}.`),
    filing(2, 2, 'Corporate Disclosure Statement', 'Petitioner filed corporate disclosure statement.'),
    filing(3, 14, 'Answer', 'Defendant answered complaint.'),
    filing(4, 31, 'Scheduling Order', 'Discovery and pretrial schedule entered.'),
    filing(5, 58, 'Protective Order', 'Protective order entered for confidential records.'),
    filing(6, 94, 'First Motion to Compel', 'Plaintiff moved to compel production of disputed documents.'),
    filing(7, 109, 'Opposition to Motion to Compel', 'Defendant opposed production based on privilege and burden.'),
    filing(8, 116, 'Reply in Support of Motion to Compel', 'Plaintiff filed reply in support of motion to compel.'),
    filing(9, 132, 'Discovery Hearing', 'Court heard discovery dispute.'),
    filing(10, 133, titles[0], 'Discovery order compelled production of disputed documents.', 0),
    filing(11, 140, 'Motion for Reconsideration', 'Defendant moved for reconsideration of discovery order.'),
    filing(12, 150, 'Response to Motion for Reconsideration', 'Plaintiff opposed reconsideration.'),
    filing(13, 158, 'Reply in Support of Reconsideration', 'Defendant replied in support of reconsideration.'),
    filing(14, 166, 'Order Denying Reconsideration', 'Court denied reconsideration.'),
    filing(15, 170, titles[1], 'District court denied stay pending mandamus review.', 1),
    filing(16, 173, 'Privilege Log', 'Updated privilege log filed under seal and in redacted public form.'),
    filing(17, 179, titles[2], 'Privilege log excerpts and supporting declarations filed.', 2),
    filing(18, 184, 'Notice of Intended Mandamus Petition', 'Defendant notified district court of intended mandamus petition.'),
    filing(19, 187, titles[3], 'Mandamus-related order entered and production deadline maintained.', 3),
    filing(20, 188, 'Emergency Motion to Stay Production Deadline', 'Emergency stay motion filed in district court.'),
    filing(21, 190, 'Order Denying Emergency Stay', 'District court denied emergency stay.'),
    filing(22, 191, 'Petition for Writ of Mandamus', 'Petition for writ of mandamus filed in court of appeals.'),
    filing(23, 192, 'District Court Transmission Notice', 'District clerk transmitted relevant docket materials to court of appeals.'),
  ]
}

function docketEntriesFor(scenario: Scenario): TrialDocketEntryDraft[] {
  if (scenario.id.includes('preliminary-injunction')) return preliminaryInjunctionEntries(scenario)
  if (scenario.id.includes('post-trial')) return postTrialEntries(scenario)
  if (scenario.courtPackId.includes('criminal')) return criminalEntries(scenario)
  if (scenario.courtPackId.includes('agency')) return agencyEntries(scenario)
  if (scenario.courtPackId.includes('writ')) return writEntries(scenario)
  return civilSummaryJudgmentEntries(scenario)
}

function filedAtFor(day: number, entryNumber: number) {
  const filedAt = new Date(Date.UTC(2025, 7, 18 + day, 14 + (entryNumber % 5), 12 + (entryNumber % 37)))
  return filedAt.toISOString()
}

function createAssets(scenario: Scenario, docketEntries: TrialDocketEntryDraft[]) {
  const assetEntries = docketEntries
    .filter((entry): entry is TrialDocketEntryDraft & { assetIndex: number } => entry.assetIndex !== undefined)
    .sort((left, right) => left.assetIndex - right.assetIndex)
  const dir = join(recordsRoot, scenario.id)
  mkdirSync(dir, { recursive: true })

  return assetEntries.map((entry): ScenarioDocumentAsset => {
    const fileName = fileNameFor(entry.entryNumber, entry.title)
    const extractedText = entryTextFor(scenario, entry.title, entry.assetIndex)
    const pdf = createPdf(
      `${scenario.shortCaption} - ${entry.title}`,
      wrapWords(extractedText),
    )
    writeFileSync(join(dir, fileName), pdf)
    return {
      id: `${scenario.id}-${fileName.replace(/\.pdf$/, '')}`,
      label: entry.title,
      fileName,
      mimeType: 'application/pdf',
      source: 'synthetic',
      sizeBytes: Buffer.byteLength(pdf),
      pageCount: 1,
      extractedText,
    }
  })
}

function createTrialDocket(
  scenario: Scenario,
  docketEntries: TrialDocketEntryDraft[],
  assets: ScenarioDocumentAsset[],
): ScenarioTrialDocket {
  return {
    caption: scenario.shortCaption,
    court: scenario.lowerTribunal,
    docketNumber: docketNumberFor(scenario),
    entries: docketEntries.map((entry) => ({
      id: `${scenario.id}-trial-docket-${String(entry.entryNumber).padStart(3, '0')}`,
      entryNumber: entry.entryNumber,
      filedAt: filedAtFor(entry.day, entry.entryNumber),
      title: entry.title,
      text:
        entry.assetIndex === undefined
          ? entry.text
          : assets[entry.assetIndex]?.extractedText ?? entry.text,
      documentAssetIds:
        entry.assetIndex === undefined || !assets[entry.assetIndex]
          ? []
          : [assets[entry.assetIndex].id],
    })),
  }
}

const scenarios = JSON.parse(readFileSync(seedPath, 'utf8')) as MutableScenario[]

for (const scenario of scenarios) {
  const docketEntries = docketEntriesFor(scenario)
  const documentAssets = createAssets(scenario, docketEntries)
  scenario.documentAssets = documentAssets
  scenario.trialDocket = createTrialDocket(scenario, docketEntries, documentAssets)
}

writeFileSync(seedPath, `${JSON.stringify(scenarios, null, 2)}\n`)
