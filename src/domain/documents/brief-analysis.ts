import { ruleRefs } from '../packs'
import type {
  CaseSession,
  DocumentAnalysis,
  FilingSubmission,
  RuleRef,
  ScenarioIssue,
  UploadedDocument,
  ValidationIssue,
} from '../types'

type BriefAnalysisCheck = {
  id: string
  label: string
  present: boolean
  severity: ValidationIssue['severity']
  message: string
  cureSuggestion: string
  ruleRefs: RuleRef[]
}

function normalized(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function documentAnalysis(document: UploadedDocument): DocumentAnalysis | undefined {
  return document.analysis
}

function documentText(document: UploadedDocument) {
  const analysis = documentAnalysis(document)
  return normalized(
    [
      document.fileName,
      analysis?.normalizedText,
      document.extractedText,
      ...(document.extractedSignals ?? []),
      ...(analysis?.sectionMap?.map((section) => section.label) ?? []),
      ...(analysis?.recordCitations ?? []),
      ...(analysis?.appendixCitations ?? []),
    ]
      .filter(Boolean)
      .join(' '),
  )
}

function hasSection(document: UploadedDocument, sectionId: string, patterns: string[]) {
  const analysis = documentAnalysis(document)
  if (analysis?.sectionMap?.some((section) => section.id === sectionId)) return true
  const text = documentText(document)
  return patterns.some((pattern) => text.includes(pattern))
}

function issue(
  severity: ValidationIssue['severity'],
  code: string,
  message: string,
  ruleRefsForIssue: RuleRef[],
  cureSuggestion: string,
): ValidationIssue {
  return {
    severity,
    code,
    message,
    ruleRefs: ruleRefsForIssue,
    cureSuggestion,
  }
}

function allDocuments(submission: FilingSubmission) {
  return [
    submission.mainDocument,
    ...submission.attachments.map((attachment) => attachment.document),
  ]
}

function scenarioIssues(session: CaseSession): ScenarioIssue[] {
  return session.scenario.issues?.length
    ? session.scenario.issues
    : session.scenario.issuesPresented.map((label, index) => ({
        id: `issue-${index + 1}`,
        label,
        standardOfReview: 'de novo',
        preservationFacts: [],
        recordSupportFacts: session.scenario.meritsRecord,
        likelyArgumentsForAppellant: [label],
        likelyArgumentsForAppellee: [],
        possibleRelief: ['affirm', 'vacate', 'remand'],
      }))
}

function containsIssue(text: string, scenarioIssue: ScenarioIssue) {
  const fragments = [
    scenarioIssue.id.replaceAll('-', ' '),
    scenarioIssue.label,
    ...scenarioIssue.likelyArgumentsForAppellant,
  ].map(normalized)

  return fragments.some((fragment) => fragment.length > 10 && text.includes(fragment))
}

function containsRecordExcerpt(text: string, values: string[]) {
  return values.some((value) => {
    const fragment = normalized(value).slice(0, 80)
    return fragment.length > 20 && text.includes(fragment)
  })
}

export function briefContentChecks(
  submission: FilingSubmission,
): BriefAnalysisCheck[] {
  const main = submission.mainDocument
  const analysis = documentAnalysis(main)
  const text = documentText(main)
  const isBrief = ['opening_brief', 'appellee_brief', 'reply_brief', 'amicus_brief'].includes(
    submission.eventId,
  )

  if (!isBrief) return []

  const recordCitationCount = analysis?.recordCitations?.length ?? 0
  const appendixCitationCount = analysis?.appendixCitations?.length ?? 0

  return [
    {
      id: 'jurisdictional_statement_missing',
      label: 'Jurisdictional statement',
      present: submission.eventId !== 'opening_brief' || hasSection(main, 'jurisdiction', ['jurisdiction']),
      severity: 'warning',
      message: 'Opening brief does not show a jurisdictional statement in extracted text.',
      cureSuggestion: 'Add a jurisdictional statement that identifies the judgment, appeal deadline, and appellate jurisdiction.',
      ruleRefs: [ruleRefs.frap28],
    },
    {
      id: 'issues_presented_missing',
      label: 'Issues presented',
      present: hasSection(main, 'issues', ['statement of issues', 'issues presented', 'questions presented']),
      severity: 'warning',
      message: 'Brief does not show an issues-presented section.',
      cureSuggestion: 'Add a concise issues-presented section before the argument.',
      ruleRefs: [ruleRefs.frap28, ruleRefs.ca4Local28],
    },
    {
      id: 'standard_of_review_missing',
      label: 'Standard of review',
      present: hasSection(main, 'standard_of_review', ['standard of review']),
      severity: 'warning',
      message: 'Brief does not show a standard-of-review section.',
      cureSuggestion: 'Add the standard of review for each preserved issue.',
      ruleRefs: [ruleRefs.frap28, ruleRefs.ca4Local28],
    },
    {
      id: 'argument_section_missing',
      label: 'Argument',
      present: hasSection(main, 'argument', ['argument']),
      severity: 'warning',
      message: 'Brief does not show an argument section.',
      cureSuggestion: 'Add argument headings and develop each issue with record support.',
      ruleRefs: [ruleRefs.frap28],
    },
    {
      id: 'conclusion_relief_missing',
      label: 'Conclusion / relief',
      present: hasSection(main, 'conclusion', ['conclusion', 'relief requested', 'request for relief']),
      severity: 'warning',
      message: 'Brief does not show a conclusion or relief-requested section.',
      cureSuggestion: 'Add a conclusion that states the precise appellate relief requested.',
      ruleRefs: [ruleRefs.frap28],
    },
    {
      id: 'certificate_of_service_text_missing',
      label: 'Certificate of service',
      present: submission.metadata.certificateOfService || analysis?.certificateOfServiceDetected === true,
      severity: 'error',
      message: 'Brief does not show a certificate of service.',
      cureSuggestion: 'Attach or include a certificate of service and verify the service metadata.',
      ruleRefs: [ruleRefs.frap25],
    },
    {
      id: 'certificate_of_compliance_text_missing',
      label: 'Certificate of compliance',
      present:
        submission.metadata.certificateOfCompliance ||
        analysis?.certificateOfComplianceDetected === true,
      severity: 'error',
      message: 'Brief does not show a certificate of compliance.',
      cureSuggestion: 'Attach or include a type-volume certificate before filing.',
      ruleRefs: [ruleRefs.frap32],
    },
    {
      id: 'record_citations_missing',
      label: 'Record citations',
      present:
        recordCitationCount > 0 ||
        appendixCitationCount > 0 ||
        text.includes('record citation'),
      severity: 'warning',
      message: 'Brief does not show record citations in extracted text.',
      cureSuggestion: 'Add citations to the record or joint appendix for each material factual assertion.',
      ruleRefs: [ruleRefs.frap28, ruleRefs.ca4Local28],
    },
    {
      id: 'appendix_references_missing',
      label: 'Appendix references',
      present:
        submission.eventId !== 'opening_brief' ||
        appendixCitationCount > 0 ||
        text.includes('appendix') ||
        text.includes('j.a.'),
      severity: 'warning',
      message: 'Opening brief does not show joint appendix references.',
      cureSuggestion: 'Use J.A. or appendix citations that match the joint appendix excerpts.',
      ruleRefs: [ruleRefs.frap30, ruleRefs.ca4Local30],
    },
  ]
}

export function briefAnalysisIssues(
  session: CaseSession,
  submission: FilingSubmission,
): ValidationIssue[] {
  const main = submission.mainDocument
  const text = documentText(main)
  const checks = briefContentChecks(submission)
  const issues = checks
    .filter((check) => !check.present)
    .map((check) =>
      issue(check.severity, check.id, check.message, check.ruleRefs, check.cureSuggestion),
    )

  if (submission.eventId === 'opening_brief') {
    for (const scenarioIssue of scenarioIssues(session)) {
      if (!containsIssue(text, scenarioIssue)) {
        issues.push(
          issue(
            'warning',
            `issue_coverage_${scenarioIssue.id}_missing`,
            `Opening brief does not clearly cover scenario issue: ${scenarioIssue.label}.`,
            [ruleRefs.frap28, ruleRefs.ca4Local28],
            'Add an issue heading and argument section that expressly preserves this issue.',
          ),
        )
      }
    }
  }

  if (submission.eventId === 'joint_appendix') {
    const appendixText = allDocuments(submission).map(documentText).join(' ')
    for (const scenarioIssue of scenarioIssues(session)) {
      if (!containsRecordExcerpt(appendixText, scenarioIssue.recordSupportFacts)) {
        issues.push(
          issue(
            'warning',
            `appendix_support_${scenarioIssue.id}_missing`,
            `Joint appendix does not clearly include record support for: ${scenarioIssue.label}.`,
            [ruleRefs.frap30, ruleRefs.ca4Local30],
            'Include the record excerpts needed to support the issue or cite where they appear.',
          ),
        )
      }
    }
  }

  if (main.analysis?.textExtractionStatus === 'not_searchable') {
    issues.push(
      issue(
        'warning',
        'pdf_text_not_searchable',
        'PDF has little or no searchable text, so document analysis confidence is low.',
        [ruleRefs.frap25, ruleRefs.frap32],
        'Upload a text-searchable PDF. OCR is not implemented in this phase.',
      ),
    )
  }

  return issues
}
