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

import { createHash } from 'node:crypto'
import { makeFunctionReference } from 'convex/server'
import { convexTest } from 'convex-test'
import type { TestConvex } from 'convex-test'
import { describe, expect, it } from 'vitest'

import type { Id } from './_generated/dataModel'
import type { DocumentAnalysis, UploadedDocument } from '../src/domain/types'
import { AppErrorCode } from './errors'
import schema from './schema'

const modules = {
  './_generated/api.ts': () => import('./_generated/api'),
  './_generated/server.ts': () => import('./_generated/server'),
  './assignments.ts': () => import('./assignments'),
  './authHelpers.ts': () => import('./authHelpers'),
  './authz.ts': () => import('./authz'),
  './caseSessionEventLog.ts': () => import('./caseSessionEventLog'),
  './caseSessions.ts': () => import('./caseSessions'),
  './cohorts.ts': () => import('./cohorts'),
  './errors.ts': () => import('./errors'),
  './instructor.ts': () => import('./instructor'),
  './organizationContracts.ts': () => import('./organizationContracts'),
  './organizations.ts': () => import('./organizations'),
  './scenarios.ts': () => import('./scenarios'),
  './users.ts': () => import('./users'),
}

type TestIdentity = {
  issuer: string
  subject: string
  tokenIdentifier: string
  name: string
}

const identity = (subject: string): TestIdentity => ({
  issuer: 'https://identity.example.test',
  subject,
  tokenIdentifier: `https://identity.example.test|${subject}`,
  name: subject,
})

const recoveryQueryRef = makeFunctionReference<
  'query',
  { caseSessionId: Id<'caseSessions'> },
  { caseSessionId: Id<'caseSessions'>; documents: UploadedDocument[] }
>('caseSessions:getUnfiledDocumentsForCurrentUser')

describe('unfiled receipt-backed document recovery', () => {
  it('restores only unfiled canonical documents with stable IDs and analysis', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const unfiled = await seedReceiptBackedDocument(t, fixture, 'unfiled.pdf')
    const filed = await seedReceiptBackedDocument(t, fixture, 'filed.pdf')
    const rejected = await seedReceiptBackedDocument(
      t,
      fixture,
      'rejected-attempt.pdf',
    )
    await t.run((ctx) =>
      Promise.all([
        ctx.db.insert('filings', {
          caseSessionId: fixture.caseSessionId,
          eventId: 'notice_of_appeal',
          participantRole: 'appellant',
          title: 'Filed notice',
          documentIds: [filed.documentId],
          certificateOfService: true,
          certificateOfCompliance: false,
          sealed: false,
          notes: '',
          filedAt: '2026-10-04T12:00:00.000Z',
          outcome: 'accepted',
          validationIssues: [],
        }),
        ctx.db.insert('filings', {
          caseSessionId: fixture.caseSessionId,
          eventId: 'notice_of_appeal',
          participantRole: 'appellant',
          title: 'Rejected notice attempt',
          documentIds: [rejected.documentId],
          certificateOfService: true,
          certificateOfCompliance: false,
          sealed: false,
          notes: '',
          filedAt: '2026-10-04T12:01:00.000Z',
          outcome: 'rejected',
          validationIssues: [],
        }),
      ]),
    )

    const owner = t.withIdentity(identity('owner'))
    const first = await owner.query(recoveryQueryRef, {
      caseSessionId: fixture.caseSessionId,
    })
    const repeated = await owner.query(recoveryQueryRef, {
      caseSessionId: fixture.caseSessionId,
    })

    expect(first.caseSessionId).toBe(fixture.caseSessionId)
    expect(first.documents).toHaveLength(2)
    const restoredUnfiled = first.documents.find(
      (document) => document.id === unfiled.documentId,
    )
    expect(restoredUnfiled).toMatchObject({
      id: unfiled.documentId,
      fileName: 'unfiled.pdf',
      mimeType: 'application/pdf',
      sizeBytes: unfiled.sizeBytes,
      sha256: unfiled.sha256,
      analysisId: unfiled.analysisId,
      analysis: {
        analyzerId: 'recovery-fixture-analyzer',
        normalizedText: 'persisted analysis for unfiled.pdf',
      },
    })
    expect(restoredUnfiled).not.toHaveProperty('storageId')
    expect(restoredUnfiled).not.toHaveProperty('fileUrl')
    expect(first.documents.map((document) => document.id)).not.toContain(
      filed.documentId,
    )
    expect(first.documents.map((document) => document.id)).toContain(
      rejected.documentId,
    )
    expect(repeated).toEqual(first)
  })

  it('denies foreign and revoked owners while allowing read-only recovery for a submitted assignment', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const foreign = t.withIdentity(identity(fixture.peerSubject))
    const owner = t.withIdentity(identity('owner'))

    await expectAppError(
      foreign.query(recoveryQueryRef, {
        caseSessionId: fixture.caseSessionId,
      }),
      AppErrorCode.NOT_FOUND,
    )

    await t.run((ctx) =>
      ctx.db.patch(fixture.ownerMembershipId, { status: 'suspended' }),
    )
    await expect(
      owner.query(recoveryQueryRef, {
        caseSessionId: fixture.caseSessionId,
      }),
    ).rejects.toBeDefined()

    const activeFixture = await seedFixture(t, 'other-owner')
    await addSubmittedAssignmentLock(t, activeFixture)
    await expect(
      t.withIdentity(identity('other-owner')).query(recoveryQueryRef, {
        caseSessionId: activeFixture.caseSessionId,
      }),
    ).resolves.toEqual({
      caseSessionId: activeFixture.caseSessionId,
      documents: [],
    })
  })

  it('rejects a consumed receipt whose document or analysis link crosses sessions', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const otherSessionId = await t.run((ctx) =>
      ctx.db.insert('caseSessions', {
        institutionId: fixture.institutionId,
        scenarioId: fixture.scenarioId,
        userId: fixture.ownerUserId,
        courtPackId: 'us-federal-ca4-civil-appeal',
        status: 'active',
        simulatedDate: '2026-10-04T12:00:00.000Z',
      }),
    )
    const foreignDocument = await seedReceiptBackedDocument(
      t,
      { ...fixture, caseSessionId: otherSessionId },
      'foreign-session.pdf',
    )
    await t.run((ctx) =>
      ctx.db.insert('documentUploadIntents', {
        institutionId: fixture.institutionId,
        scopeKind: 'session',
        caseSessionId: fixture.caseSessionId,
        userId: fixture.ownerUserId,
        fileName: 'cross-linked.pdf',
        sizeBytes: foreignDocument.sizeBytes,
        sha256: foreignDocument.sha256,
        mimeType: 'application/pdf',
        chunkCount: 1,
        state: 'consumed',
        expiresAt: '2026-10-05T00:00:00.000Z',
        createdAt: '2026-10-04T12:00:00.000Z',
        storageId: foreignDocument.storageId,
        documentId: foreignDocument.documentId,
        analysisId: foreignDocument.analysisId,
      }),
    )

    await expectAppError(
      t.withIdentity(identity('owner')).query(recoveryQueryRef, {
        caseSessionId: fixture.caseSessionId,
      }),
      AppErrorCode.CONFLICT,
    )
  })

  it('reads only consumed receipts when a session has large cancelled upload history', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const unfiled = await seedReceiptBackedDocument(t, fixture, 'history.pdf')
    const largeFileName = 'cancelled-history-'.padEnd(190_000, 'x')

    for (let start = 0; start < 70; start += 7) {
      await t.run(async (ctx) => {
        await Promise.all(
          Array.from({ length: 7 }, () =>
            ctx.db.insert('documentUploadIntents', {
              institutionId: fixture.institutionId,
              scopeKind: 'session',
              caseSessionId: fixture.caseSessionId,
              userId: fixture.ownerUserId,
              fileName: largeFileName,
              sizeBytes: 1,
              sha256: '0'.repeat(64),
              mimeType: 'application/pdf',
              chunkCount: 1,
              state: 'cancelled',
              expiresAt: '2026-10-03T00:00:00.000Z',
              createdAt: '2026-10-03T00:00:00.000Z',
            }),
          ),
        )
      })
    }

    const restored = await t
      .withIdentity(identity('owner'))
      .query(recoveryQueryRef, { caseSessionId: fixture.caseSessionId })
    expect(restored.documents.map((document) => document.id)).toEqual([
      unfiled.documentId,
    ])
  }, 30_000)
})

async function seedFixture(
  t: TestConvex<typeof schema>,
  ownerSubject = 'owner',
) {
  const now = '2026-10-04T12:00:00.000Z'
  const fixture = await t.run(async (ctx) => {
    const peerSubject = `${ownerSubject}-peer`
    const ownerUserId = await ctx.db.insert('users', {
      authSubject: identity(ownerSubject).tokenIdentifier,
      displayName: ownerSubject,
      monthlyAiBudgetCents: 0,
    })
    const peerUserId = await ctx.db.insert('users', {
      authSubject: identity(peerSubject).tokenIdentifier,
      displayName: 'Peer',
      monthlyAiBudgetCents: 0,
    })
    const institutionId = await ctx.db.insert('institutions', {
      kind: 'shared',
      createdAt: now,
      name: 'Recovery test organization',
      slug: `recovery-${ownerSubject}`,
      status: 'active',
      monthlyAiBudgetCents: 0,
    })
    const ownerMembershipId = await ctx.db.insert('institutionMemberships', {
      institutionId,
      userId: ownerUserId,
      role: 'learner',
      status: 'active',
      createdAt: now,
    })
    await ctx.db.insert('institutionMemberships', {
      institutionId,
      userId: peerUserId,
      role: 'learner',
      status: 'active',
      createdAt: now,
    })
    const scenarioId = await ctx.db.insert('scenarios', {
      scenarioKey: `recovery-${ownerSubject}`,
      visibility: 'public_template',
      revisionStatus: 'published',
      title: 'Recovery fixture',
      source: 'synthetic',
      courtPackId: 'us-federal-ca4-civil-appeal',
      shortCaption: 'Recovery v. Test',
      lowerTribunal: 'Fixture court',
      natureOfSuit: 'civil',
      proceduralPosture: 'appeal',
      issuesPresented: [],
      meritsRecord: [],
      published: true,
    })
    const caseSessionId = await ctx.db.insert('caseSessions', {
      institutionId,
      scenarioId,
      userId: ownerUserId,
      courtPackId: 'us-federal-ca4-civil-appeal',
      status: 'active',
      simulatedDate: now,
    })
    return {
      ownerUserId,
      peerSubject,
      institutionId,
      ownerMembershipId,
      scenarioId,
      caseSessionId,
    }
  })
  return fixture
}

async function seedReceiptBackedDocument(
  t: TestConvex<typeof schema>,
  fixture: Awaited<ReturnType<typeof seedFixture>> & {
    caseSessionId: Id<'caseSessions'>
  },
  fileName: string,
) {
  const bytes = new TextEncoder().encode(`%PDF-1.7\n${fileName}`)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const normalizedText = `persisted analysis for ${fileName}`
  const analysis: DocumentAnalysis = {
    analyzerId: 'recovery-fixture-analyzer',
    fileSizeBytes: bytes.byteLength,
    mimeType: 'application/pdf',
    searchableText: true,
    certificateOfServiceDetected: false,
    certificateOfComplianceDetected: false,
    sealedOrRedactionWarning: false,
    warnings: ['persisted fixture analysis'],
    normalizedText,
  }
  return t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob([bytes], { type: 'application/pdf' }),
    )
    const documentId = await ctx.db.insert('documents', {
      caseSessionId: fixture.caseSessionId,
      storageId,
      sha256,
      fileName,
      mimeType: 'application/pdf',
      sizeBytes: bytes.byteLength,
      extractedText: normalizedText,
      textExtractionStatus: 'extracted',
      wordCount: normalizedText.length,
      extractedSignals: ['fixture document'],
    })
    const analysisId = await ctx.db.insert('documentAnalyses', {
      caseSessionId: fixture.caseSessionId,
      documentId,
      analyzerId: analysis.analyzerId,
      fileSizeBytes: analysis.fileSizeBytes,
      mimeType: analysis.mimeType,
      searchableText: analysis.searchableText,
      certificateOfServiceDetected: analysis.certificateOfServiceDetected,
      certificateOfComplianceDetected: analysis.certificateOfComplianceDetected,
      sealedOrRedactionWarning: analysis.sealedOrRedactionWarning,
      warnings: [],
      analysisJson: JSON.stringify(analysis),
      createdAt: '2026-10-04T12:00:00.000Z',
    })
    await ctx.db.patch(documentId, { analysisId })
    await ctx.db.insert('documentUploadIntents', {
      institutionId: fixture.institutionId,
      scopeKind: 'session',
      caseSessionId: fixture.caseSessionId,
      userId: fixture.ownerUserId,
      fileName,
      sizeBytes: bytes.byteLength,
      sha256,
      mimeType: 'application/pdf',
      chunkCount: 1,
      state: 'consumed',
      expiresAt: '2026-10-05T12:00:00.000Z',
      createdAt: '2026-10-04T12:00:00.000Z',
      storageId,
      documentId,
      analysisId,
    })
    return {
      storageId,
      documentId,
      analysisId,
      sha256,
      sizeBytes: bytes.byteLength,
    }
  })
}

async function addSubmittedAssignmentLock(
  t: TestConvex<typeof schema>,
  fixture: Awaited<ReturnType<typeof seedFixture>>,
) {
  await t.run(async (ctx) => {
    const createdAt = '2026-10-04T12:00:00.000Z'
    const cohortId = await ctx.db.insert('cohorts', {
      institutionId: fixture.institutionId,
      title: 'Recovery cohort',
      term: '2026',
      startsAt: createdAt,
      endsAt: '2026-12-31T00:00:00.000Z',
      archived: false,
    })
    const assignmentId = await ctx.db.insert('assignments', {
      cohortId,
      scenarioId: fixture.scenarioId,
      title: 'Submitted recovery assignment',
      published: true,
      createdByUserId: fixture.ownerUserId,
      createdAt,
    })
    await ctx.db.insert('assignmentSessions', {
      assignmentId,
      caseSessionId: fixture.caseSessionId,
      userId: fixture.ownerUserId,
      submittedAt: createdAt,
    })
  })
}

async function expectAppError(promise: Promise<unknown>, code: AppErrorCode) {
  let caught: unknown
  try {
    await promise
  } catch (error) {
    caught = error
  }
  expect(caught).toBeDefined()
  expect((caught as { data?: { code?: AppErrorCode } }).data?.code).toBe(code)
}
