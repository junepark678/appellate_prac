import { describe, expect, it } from 'vitest'

import { courtPacks } from './packs'
import {
  applyToolCall,
  createInitialSession,
  fileDraft,
  nextExpectedToolCall,
  validateFiling,
  validateToolCall,
} from './simulation'
import type { FilingDraft, UploadedDocument } from './types'

const pdf: UploadedDocument = {
  id: 'doc_1',
  fileName: 'opening-brief.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 140_000,
  extractedSignals: ['argument', 'statement of issues', 'standard of review'],
}

const noticePdf: UploadedDocument = {
  ...pdf,
  fileName: 'notice-of-appeal.pdf',
  extractedSignals: ['notice of appeal'],
}

const disclosurePdf: UploadedDocument = {
  ...pdf,
  fileName: 'disclosure.pdf',
  extractedSignals: ['disclosure'],
}

const appendixPdf: UploadedDocument = {
  ...pdf,
  fileName: 'joint-appendix.pdf',
  extractedSignals: ['appendix'],
}

const replyPdf: UploadedDocument = {
  ...pdf,
  fileName: 'reply-brief.pdf',
  extractedSignals: ['reply'],
}

function draft(eventId: string): FilingDraft {
  return {
    eventId,
    participantRole: 'appellant',
    title: eventId,
    documents: [pdf],
    certificateOfService: true,
    certificateOfCompliance: eventId.includes('brief'),
    sealed: false,
    notes: '',
  }
}

describe('simulation engine', () => {
  it('keeps trial-court packs separate from appellate filing events', () => {
    const trialPack = courtPacks.find((pack) => pack.id === 'future-state-trial-template')
    expect(trialPack?.courtLevel).toBe('trial')
    expect(trialPack?.filingEvents).toHaveLength(0)
  })

  it('rejects a reply brief before an appellee brief', () => {
    const session = createInitialSession()
    const issues = validateFiling(session, draft('reply_brief'))
    expect(issues.some((issue) => issue.severity === 'error')).toBe(true)
    expect(issues.map((issue) => issue.message).join(' ')).toContain(
      'reply brief cannot precede',
    )
  })

  it('accepts warnings as docketed deficiencies instead of blocking the filing', () => {
    const session = createInitialSession()
    const next = fileDraft(session, draft('opening_brief'))
    expect(next.filings[0]?.outcome).toBe('accepted_with_deficiency')
    expect(next.docketEntries.at(-1)?.title).toBe('Clerk Deficiency Notice')
  })

  it('validates AI actor tool authority by court pack', () => {
    const session = createInitialSession()
    const result = validateToolCall(session, {
      tool: 'disposeCase',
      actorId: 'appellee_ai',
      disposition: 'Judgment',
      text: 'Improper attempted disposition.',
      ruleRefs: [],
    })
    expect(result.accepted).toBe(false)
  })

  it('rejects unimplemented runtime AI tools instead of closing the case', () => {
    const session = createInitialSession()
    const next = applyToolCall(session, {
      tool: 'requestResponse',
      actorId: 'ca4_clerk',
    })
    expect(next.status).toBe('active')
    expect(next.docketEntries.at(-1)?.title).toBe('AI Tool Call Rejected')
  })

  it('does not let rejected filings advance procedural progression', () => {
    const session = createInitialSession()
    const rejected = fileDraft(session, {
      ...draft('notice_of_appeal'),
      documents: [],
    })
    expect(rejected.filings).toHaveLength(0)
    const expected = nextExpectedToolCall(rejected)
    expect(expected.tool).toBe('issueClerkOrder')
    expect(expected.tool === 'issueClerkOrder' ? expected.title : '').toBe(
      'Notice Regarding Case Opening',
    )
  })

  it('rejects invalid AI counterparty filing events', () => {
    const session = createInitialSession()
    const result = validateToolCall(session, {
      tool: 'fileCounterpartyDocument',
      actorId: 'appellee_ai',
      eventId: 'reply_brief',
      title: 'Reply Brief',
      text: 'Improper reply.',
    })
    expect(result.accepted).toBe(false)
  })

  it('satisfies matching open deadlines when a filing is accepted', () => {
    const session = createInitialSession()
    const next = fileDraft(session, {
      ...draft('notice_of_appeal'),
      documents: [noticePdf],
    })

    expect(
      next.deadlines.find((deadline) => deadline.targetEventId === 'notice_of_appeal')
        ?.status,
    ).toBe('satisfied')
    expect(next.filings[0]?.outcome).toBe('accepted')
  })

  it('dedupes repeated deadline advancement', () => {
    let session = createInitialSession()
    session = fileDraft(session, {
      ...draft('notice_of_appeal'),
      documents: [noticePdf],
    })
    session = fileDraft(session, {
      ...draft('appearance_disclosure'),
      documents: [disclosurePdf],
    })

    session = applyToolCall(session, nextExpectedToolCall(session))
    session = applyToolCall(session, nextExpectedToolCall(session))

    expect(
      session.deadlines.filter(
        (deadline) => deadline.targetEventId === 'opening_brief' && deadline.status === 'open',
      ),
    ).toHaveLength(1)
  })

  it('advances through clerk and panel tool calls', () => {
    let session = createInitialSession()
    session = fileDraft(session, {
      ...draft('notice_of_appeal'),
      documents: [noticePdf],
    })
    session = fileDraft(session, {
      ...draft('appearance_disclosure'),
      documents: [disclosurePdf],
    })
    session = fileDraft(session, draft('opening_brief'))
    session = fileDraft(session, {
      ...draft('joint_appendix'),
      documents: [appendixPdf],
    })

    session = applyToolCall(session, nextExpectedToolCall(session))
    expect(session.filings.some((filing) => filing.eventId === 'appellee_brief')).toBe(
      true,
    )
  })

  it('creates an assessment after the deterministic case closure path', () => {
    let session = createInitialSession()
    session = fileDraft(session, {
      ...draft('notice_of_appeal'),
      documents: [noticePdf],
    })
    session = fileDraft(session, {
      ...draft('appearance_disclosure'),
      documents: [disclosurePdf],
    })
    session = fileDraft(session, draft('opening_brief'))
    session = fileDraft(session, {
      ...draft('joint_appendix'),
      documents: [appendixPdf],
    })
    session = applyToolCall(session, nextExpectedToolCall(session))
    session = fileDraft(session, {
      ...draft('reply_brief'),
      documents: [replyPdf],
    })
    session = applyToolCall(session, nextExpectedToolCall(session))
    session = applyToolCall(session, nextExpectedToolCall(session))

    expect(session.status).toBe('closed')
    expect(session.assessment?.disposition).toBe('Opinion and Judgment')
    expect(session.assessment?.nextPracticeTargets).toContain(
      'Preserve every issue in the opening brief with record citations.',
    )
  })
})
