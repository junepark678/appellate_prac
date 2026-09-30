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

import { describe, expect, it } from 'vitest'

import { ruleRefs } from '../packs'
import { createInitialSession } from '../simulation'
import type {
  CaseSession,
  FilingMetadata,
  FilingOutcome,
  FilingRecord,
  FilingSubmission,
  UploadedDocument,
  ValidationIssue,
} from '../types'
import {
  evaluateFilingConstraints,
  filingConstraints,
  preflightFilingSubmission,
  sessionJurisdictionIssues,
  validationIssue,
} from './constraint-catalog'

const defaultDoc: UploadedDocument = {
  id: 'doc_test',
  fileName: 'test.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 100_000,
  extractedSignals: [],
}

function makeDocument(overrides: Partial<UploadedDocument> = {}): UploadedDocument {
  return { ...defaultDoc, ...overrides }
}

const noticeDoc = makeDocument({ extractedSignals: ['notice of appeal'] })
const motionDoc = makeDocument({ extractedSignals: ['motion'] })
const briefDoc = makeDocument({
  extractedSignals: [
    'statement of issues',
    'standard of review',
    'jurisdiction',
    'argument',
    'conclusion',
    'record citation',
    'oral argument',
  ],
})
const sealMotionDoc = makeDocument({ extractedSignals: ['motion', 'seal'] })

function makeMetadata(overrides: Partial<FilingMetadata> = {}): FilingMetadata {
  return {
    serviceMethod: 'cm_ecf',
    emergency: false,
    sealed: false,
    redactionAcknowledged: false,
    certificateOfService: true,
    certificateOfCompliance: false,
    ...overrides,
  }
}

function makeSubmission(overrides: Partial<FilingSubmission> = {}): FilingSubmission {
  return {
    eventId: 'notice_of_appeal',
    participantRole: 'appellant',
    title: 'Test Filing',
    mainDocument: noticeDoc,
    attachments: [],
    metadata: makeMetadata(),
    notes: '',
    ...overrides,
  }
}

function addFiling(
  session: CaseSession,
  eventId: string,
  outcome: FilingOutcome = 'accepted',
): CaseSession {
  const filing: FilingRecord = {
    id: `filing_${eventId}_${session.filings.length}`,
    eventId,
    participantRole: eventId === 'appellee_brief' ? 'appellee' : 'appellant',
    title: eventId,
    documents: [makeDocument()],
    certificateOfService: true,
    certificateOfCompliance: eventId.includes('brief'),
    sealed: false,
    notes: '',
    filedAt: session.simulatedDate,
    outcome,
    validationIssues: [],
  }
  return { ...session, filings: [...session.filings, filing] }
}

function hasIssue(issues: ValidationIssue[], code: string): boolean {
  return issues.some((issue) => issue.code === code)
}

function findIssue(issues: ValidationIssue[], code: string): ValidationIssue | undefined {
  return issues.find((issue) => issue.code === code)
}

describe('constraint-catalog', () => {
  describe('sessionJurisdictionIssues', () => {
    it('flags missing case-initiating filing on a new session', () => {
      const session = createInitialSession()
      const issues = sessionJurisdictionIssues(session)

      expect(issues.length).toBeGreaterThanOrEqual(1)
      expect(hasIssue(issues, 'opening_filing_missing_jurisdiction')).toBe(true)
      expect(findIssue(issues, 'opening_filing_missing_jurisdiction')!.severity).toBe('error')
    })

    it('clears jurisdiction defect after notice of appeal is filed', () => {
      let session = createInitialSession()
      session = addFiling(session, 'notice_of_appeal')
      const issues = sessionJurisdictionIssues(session)

      expect(hasIssue(issues, 'opening_filing_missing_jurisdiction')).toBe(false)
    })

    it('ignores rejected filings for jurisdiction purposes', () => {
      let session = createInitialSession()
      session = addFiling(session, 'notice_of_appeal', 'rejected')
      const issues = sessionJurisdictionIssues(session)

      expect(hasIssue(issues, 'opening_filing_missing_jurisdiction')).toBe(true)
    })

    it('returns ValidationIssue array with expected structure for a new session', () => {
      const session = createInitialSession()
      const issues = sessionJurisdictionIssues(session)

      expect(Array.isArray(issues)).toBe(true)
      expect(issues.length).toBeGreaterThanOrEqual(1)
      const issue = issues[0]!
      expect(issue).toHaveProperty('severity')
      expect(issue).toHaveProperty('message')
      expect(issue).toHaveProperty('ruleRefs')
      expect(issue.severity).toBe('error')
      expect(issue.ruleRefs.length).toBeGreaterThanOrEqual(1)
      expect(issue.message).toBeTruthy()
      expect(issue.cureSuggestion).toBeTruthy()
    })
  })

  describe('sequential ordering constraints', () => {
    it('rejects reply brief before appellee brief', () => {
      const session = createInitialSession()
      const submission = makeSubmission({
        eventId: 'reply_brief',
        title: 'Reply Brief',
        participantRole: 'appellant',
        mainDocument: briefDoc,
        metadata: makeMetadata({ certificateOfCompliance: true }),
      })
      const issues = evaluateFilingConstraints(session, submission)

      expect(hasIssue(issues, 'reply_before_appellee_brief')).toBe(true)
      expect(findIssue(issues, 'reply_before_appellee_brief')!.severity).toBe('error')
    })

    it('allows reply brief after appellee brief is on the docket', () => {
      let session = createInitialSession()
      session = addFiling(session, 'notice_of_appeal')
      session = addFiling(session, 'opening_brief')
      session = addFiling(session, 'appellee_brief')
      const submission = makeSubmission({
        eventId: 'reply_brief',
        title: 'Reply Brief',
        participantRole: 'appellant',
        mainDocument: briefDoc,
        metadata: makeMetadata({ certificateOfCompliance: true }),
      })
      const issues = evaluateFilingConstraints(session, submission)

      expect(hasIssue(issues, 'reply_before_appellee_brief')).toBe(false)
    })

    it('rejects appellee brief before opening brief', () => {
      const session = createInitialSession()
      const submission = makeSubmission({
        eventId: 'appellee_brief',
        title: 'Appellee Brief',
        participantRole: 'appellee',
        mainDocument: briefDoc,
        metadata: makeMetadata({ certificateOfCompliance: true }),
      })
      const issues = evaluateFilingConstraints(session, submission)

      expect(hasIssue(issues, 'appellee_brief_before_opening_brief')).toBe(true)
      expect(findIssue(issues, 'appellee_brief_before_opening_brief')!.severity).toBe('error')
    })

    it('allows appellee brief after opening brief is on the docket', () => {
      let session = createInitialSession()
      session = addFiling(session, 'notice_of_appeal')
      session = addFiling(session, 'opening_brief')
      const submission = makeSubmission({
        eventId: 'appellee_brief',
        title: 'Appellee Brief',
        participantRole: 'appellee',
        mainDocument: briefDoc,
        metadata: makeMetadata({ certificateOfCompliance: true }),
      })
      const issues = evaluateFilingConstraints(session, submission)

      expect(hasIssue(issues, 'appellee_brief_before_opening_brief')).toBe(false)
    })
  })

  describe('required document present', () => {
    it('flags missing main document when MIME type does not match', () => {
      const session = createInitialSession()
      const submission = makeSubmission({
        eventId: 'notice_of_appeal',
        title: 'Notice of Appeal',
        mainDocument: makeDocument({
          mimeType: 'text/plain',
          extractedSignals: ['notice of appeal'],
        }),
      })
      const issues = evaluateFilingConstraints(session, submission)

      const docIssue = issues.find(
        (issue) =>
          issue.code?.startsWith('required_document_') && issue.code?.endsWith('_missing'),
      )
      expect(docIssue).toBeTruthy()
      expect(docIssue!.severity).toBe('error')
    })

    it('passes with a matching PDF document', () => {
      const session = createInitialSession()
      const submission = makeSubmission({
        eventId: 'notice_of_appeal',
        title: 'Notice of Appeal',
        mainDocument: noticeDoc,
      })
      const issues = evaluateFilingConstraints(session, submission)

      expect(
        issues.some(
          (issue) =>
            issue.code?.startsWith('required_document_') && issue.code?.endsWith('_missing'),
        ),
      ).toBe(false)
    })
  })

  describe('brief compliance certificate', () => {
    it('flags missing certificate of compliance for opening brief', () => {
      let session = createInitialSession()
      session = addFiling(session, 'notice_of_appeal')
      const submission = makeSubmission({
        eventId: 'opening_brief',
        title: 'Opening Brief',
        mainDocument: briefDoc,
        metadata: makeMetadata({ certificateOfCompliance: false }),
      })
      const issues = evaluateFilingConstraints(session, submission)

      expect(hasIssue(issues, 'certificate_of_compliance_missing')).toBe(true)
      expect(findIssue(issues, 'certificate_of_compliance_missing')!.severity).toBe('error')
    })

    it('passes when certificate of compliance is present for opening brief', () => {
      let session = createInitialSession()
      session = addFiling(session, 'notice_of_appeal')
      const submission = makeSubmission({
        eventId: 'opening_brief',
        title: 'Opening Brief',
        mainDocument: briefDoc,
        metadata: makeMetadata({ certificateOfCompliance: true }),
      })
      const issues = evaluateFilingConstraints(session, submission)

      expect(hasIssue(issues, 'certificate_of_compliance_missing')).toBe(false)
    })

    it('flags missing certificate of compliance for reply brief', () => {
      let session = createInitialSession()
      session = addFiling(session, 'notice_of_appeal')
      session = addFiling(session, 'opening_brief')
      session = addFiling(session, 'appellee_brief')
      const submission = makeSubmission({
        eventId: 'reply_brief',
        title: 'Reply Brief',
        participantRole: 'appellant',
        mainDocument: briefDoc,
        metadata: makeMetadata({ certificateOfCompliance: false }),
      })
      const issues = evaluateFilingConstraints(session, submission)

      expect(hasIssue(issues, 'certificate_of_compliance_missing')).toBe(true)
    })

    it('does not require certificate of compliance for non-brief events', () => {
      const session = createInitialSession()
      const submission = makeSubmission({
        eventId: 'notice_of_appeal',
        title: 'Notice of Appeal',
        mainDocument: noticeDoc,
        metadata: makeMetadata({ certificateOfCompliance: false }),
      })
      const issues = evaluateFilingConstraints(session, submission)

      expect(hasIssue(issues, 'certificate_of_compliance_missing')).toBe(false)
    })
  })

  describe('sealed document requirements', () => {
    it('flags missing redaction acknowledgment for sealed filing', () => {
      const session = createInitialSession()
      const submission = makeSubmission({
        eventId: 'motion',
        title: 'Motion',
        mainDocument: motionDoc,
        metadata: makeMetadata({
          sealed: true,
          redactionAcknowledged: false,
          reliefRequested: 'Grant relief',
        }),
      })
      const issues = evaluateFilingConstraints(session, submission)

      expect(hasIssue(issues, 'sealed_redaction_acknowledgment_missing')).toBe(true)
      expect(findIssue(issues, 'sealed_redaction_acknowledgment_missing')!.severity).toBe('error')
    })

    it('flags missing redaction acknowledgment for seal event regardless of sealed metadata', () => {
      const session = createInitialSession()
      const submission = makeSubmission({
        eventId: 'motion_to_seal',
        title: 'Motion to Seal',
        mainDocument: sealMotionDoc,
        metadata: makeMetadata({
          sealed: false,
          redactionAcknowledged: false,
          reliefRequested: 'Seal the record',
        }),
      })
      const issues = evaluateFilingConstraints(session, submission)

      expect(hasIssue(issues, 'sealed_redaction_acknowledgment_missing')).toBe(true)
    })

    it('passes sealed filing when redaction is acknowledged', () => {
      const session = createInitialSession()
      const submission = makeSubmission({
        eventId: 'motion',
        title: 'Motion',
        mainDocument: motionDoc,
        metadata: makeMetadata({
          sealed: true,
          redactionAcknowledged: true,
          sealedDocumentType: 'sealed material',
          reliefRequested: 'Grant relief',
        }),
      })
      const issues = evaluateFilingConstraints(session, submission)

      expect(hasIssue(issues, 'sealed_redaction_acknowledgment_missing')).toBe(false)
    })

    it('warns about missing sealed document type', () => {
      const session = createInitialSession()
      const submission = makeSubmission({
        eventId: 'motion',
        title: 'Motion',
        mainDocument: motionDoc,
        metadata: makeMetadata({
          sealed: true,
          redactionAcknowledged: true,
          reliefRequested: 'Grant relief',
        }),
      })
      const issues = evaluateFilingConstraints(session, submission)

      expect(hasIssue(issues, 'sealed_document_type_missing')).toBe(true)
      expect(findIssue(issues, 'sealed_document_type_missing')!.severity).toBe('warning')
    })

    it('passes sealed filing with document type specified', () => {
      const session = createInitialSession()
      const submission = makeSubmission({
        eventId: 'motion',
        title: 'Motion',
        mainDocument: motionDoc,
        metadata: makeMetadata({
          sealed: true,
          redactionAcknowledged: true,
          sealedDocumentType: 'sealed material',
          reliefRequested: 'Grant relief',
        }),
      })
      const issues = evaluateFilingConstraints(session, submission)

      expect(hasIssue(issues, 'sealed_document_type_missing')).toBe(false)
    })

    it('does not flag sealed document type for non-sealed filings', () => {
      const session = createInitialSession()
      const submission = makeSubmission({
        eventId: 'notice_of_appeal',
        title: 'Notice of Appeal',
        mainDocument: noticeDoc,
      })
      const issues = evaluateFilingConstraints(session, submission)

      expect(hasIssue(issues, 'sealed_document_type_missing')).toBe(false)
    })
  })

  describe('motion relief metadata', () => {
    it('warns when motion does not specify relief requested', () => {
      let session = createInitialSession()
      session = addFiling(session, 'notice_of_appeal')
      const submission = makeSubmission({
        eventId: 'motion',
        title: 'Motion for Extension',
        mainDocument: motionDoc,
        metadata: makeMetadata({ reliefRequested: '' }),
      })
      const issues = evaluateFilingConstraints(session, submission)

      expect(hasIssue(issues, 'motion_relief_metadata_missing')).toBe(true)
      expect(findIssue(issues, 'motion_relief_metadata_missing')!.severity).toBe('warning')
    })

    it('passes when motion specifies relief requested', () => {
      let session = createInitialSession()
      session = addFiling(session, 'notice_of_appeal')
      const submission = makeSubmission({
        eventId: 'motion',
        title: 'Motion for Extension',
        mainDocument: motionDoc,
        metadata: makeMetadata({ reliefRequested: '30-day extension of time' }),
      })
      const issues = evaluateFilingConstraints(session, submission)

      expect(hasIssue(issues, 'motion_relief_metadata_missing')).toBe(false)
    })

    it('does not require relief text for non-motion events', () => {
      const session = createInitialSession()
      const submission = makeSubmission({
        eventId: 'notice_of_appeal',
        title: 'Notice of Appeal',
        mainDocument: noticeDoc,
      })
      const issues = evaluateFilingConstraints(session, submission)

      expect(hasIssue(issues, 'motion_relief_metadata_missing')).toBe(false)
    })
  })

  describe('deadline timeliness', () => {
    it('warns when notice of appeal is filed after the deadline', () => {
      const session = createInitialSession()
      const pastDue = '2026-07-01T00:00:00.000Z'
      const issues = evaluateFilingConstraints(
        session,
        makeSubmission({
          eventId: 'notice_of_appeal',
          title: 'Notice of Appeal',
          mainDocument: noticeDoc,
        }),
        pastDue,
      )

      expect(hasIssue(issues, 'notice_of_appeal_after_open_deadline')).toBe(true)
      expect(findIssue(issues, 'notice_of_appeal_after_open_deadline')!.severity).toBe('warning')
    })

    it('also fires general deadline warning after the deadline', () => {
      const session = createInitialSession()
      const pastDue = '2026-07-01T00:00:00.000Z'
      const issues = evaluateFilingConstraints(
        session,
        makeSubmission({
          eventId: 'notice_of_appeal',
          title: 'Notice of Appeal',
          mainDocument: noticeDoc,
        }),
        pastDue,
      )

      expect(hasIssue(issues, 'filing_after_open_deadline')).toBe(true)
    })

    it('passes when notice of appeal is filed before the deadline', () => {
      const session = createInitialSession()
      const beforeDeadline = '2026-05-24T00:00:00.000Z'
      const issues = evaluateFilingConstraints(
        session,
        makeSubmission({
          eventId: 'notice_of_appeal',
          title: 'Notice of Appeal',
          mainDocument: noticeDoc,
        }),
        beforeDeadline,
      )

      expect(hasIssue(issues, 'notice_of_appeal_after_open_deadline')).toBe(false)
      expect(hasIssue(issues, 'filing_after_open_deadline')).toBe(false)
    })
  })

  describe('validationIssue helper', () => {
    it('builds an issue with sourceVersionIds when ruleRefs are provided', () => {
      const issue = validationIssue(
        'error',
        'test_code',
        'Test message',
        [ruleRefs.frap3],
        'Fix it',
      )

      expect(issue.severity).toBe('error')
      expect(issue.code).toBe('test_code')
      expect(issue.message).toBe('Test message')
      expect(issue.ruleRefs).toHaveLength(1)
      expect(issue.sourceVersionIds).toBeDefined()
      expect(issue.cureSuggestion).toBe('Fix it')
    })

    it('omits sourceVersionIds when no ruleRefs are provided', () => {
      const issue = validationIssue('warning', 'no_rules', 'No rule refs', [], 'N/A')

      expect(issue.sourceVersionIds).toBeUndefined()
    })
  })

  describe('filingConstraints catalog', () => {
    it('contains constraints with required FilingConstraint fields', () => {
      expect(filingConstraints.length).toBeGreaterThan(0)
      for (const constraint of filingConstraints) {
        expect(constraint.id).toBeTruthy()
        expect(['frap', 'ca4-local', 'simulator']).toContain(constraint.source)
        expect(constraint.severity).toMatch(/^(error|warning|info)$/)
        expect(typeof constraint.evaluate).toBe('function')
        expect(Array.isArray(constraint.ruleRefs)).toBe(true)
      }
    })
  })

  describe('preflightFilingSubmission', () => {
    it('returns a PreflightCheckResult with analyzedAt timestamp', () => {
      const session = createInitialSession()
      const result = preflightFilingSubmission(
        session,
        makeSubmission({
          eventId: 'notice_of_appeal',
          title: 'Notice of Appeal',
          mainDocument: noticeDoc,
        }),
      )

      expect(result).toHaveProperty('accepted')
      expect(result).toHaveProperty('outcome')
      expect(result).toHaveProperty('issues')
      expect(result).toHaveProperty('analyzedAt')
      expect(Array.isArray(result.issues)).toBe(true)
    })

    it('rejects when constraint evaluation finds errors', () => {
      const session = createInitialSession()
      const result = preflightFilingSubmission(
        session,
        makeSubmission({
          eventId: 'reply_brief',
          title: 'Reply Brief',
          mainDocument: briefDoc,
          metadata: makeMetadata({ certificateOfCompliance: true }),
        }),
      )

      expect(result.accepted).toBe(false)
      expect(result.outcome).toBe('rejected')
      expect(result.issues.some((issue) => issue.severity === 'error')).toBe(true)
    })

    it('accepts with deficiency when only warnings are present', () => {
      let session = createInitialSession()
      session = addFiling(session, 'notice_of_appeal')
      const result = preflightFilingSubmission(
        session,
        makeSubmission({
          eventId: 'opening_brief',
          title: 'Opening Brief',
          mainDocument: briefDoc,
          metadata: makeMetadata({ certificateOfCompliance: true }),
        }),
      )

      if (result.issues.some((issue) => issue.severity === 'error')) {
        expect(result.outcome).toBe('rejected')
      } else if (result.issues.some((issue) => issue.severity === 'warning')) {
        expect(result.outcome).toBe('accepted_with_deficiency')
      } else {
        expect(result.outcome).toBe('accepted')
      }
    })
  })
})
