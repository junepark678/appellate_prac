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

import { makeFunctionReference } from 'convex/server'
import { convexTest } from 'convex-test'
import type { TestConvex } from 'convex-test'
import { describe, expect, it } from 'vitest'

import type { Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { AppErrorCode } from './errors'
import schema from './schema'
import type { CaseSession, Scenario } from '../src/domain/types'

const modules = {
  './_generated/api.ts': () => import('./_generated/api'),
  './_generated/server.ts': () => import('./_generated/server'),
  './authHelpers.ts': () => import('./authHelpers'),
  './authz.ts': () => import('./authz'),
  './assignments.ts': () => import('./assignments'),
  './caseSessions.ts': () => import('./caseSessions'),
  './caseSessionEventLog.ts': () => import('./caseSessionEventLog'),
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

type ScenarioInput = {
  institutionId?: Id<'institutions'>
  title: string
  source: 'synthetic'
  courtPackId: string
  shortCaption: string
  lowerTribunal: string
  natureOfSuit: string
  proceduralPosture: string
  issuesPresented: string[]
  meritsRecord: string[]
}

const createSessionRef = makeFunctionReference<
  'mutation',
  { scenarioId?: string; institutionId?: Id<'institutions'> },
  CaseSession
>('caseSessions:create')
const getSessionRef = makeFunctionReference<
  'query',
  { caseSessionId?: Id<'caseSessions'>; institutionId?: Id<'institutions'> },
  CaseSession | null
>('caseSessions:getForCurrentUser')
const listSessionsRef = makeFunctionReference<
  'query',
  { institutionId?: Id<'institutions'> },
  { id: string; institutionId: Id<'institutions'> }[]
>('caseSessions:listForCurrentUser')
const advanceExpectedEventRef = makeFunctionReference<
  'mutation',
  { caseSessionId: Id<'caseSessions'> },
  CaseSession
>('caseSessions:advanceExpectedEvent')
const acceptDisclaimerRef = makeFunctionReference<
  'mutation',
  { caseSessionId: Id<'caseSessions'>; version: string },
  CaseSession
>('caseSessions:acceptLegalTrainingDisclaimer')
const generateUploadUrlRef = makeFunctionReference<
  'mutation',
  { caseSessionId: Id<'caseSessions'> },
  string
>('caseSessions:generateDocumentUploadUrl')
const persistDocumentAnalysisRef = makeFunctionReference<
  'mutation',
  {
    caseSessionId: Id<'caseSessions'>
    document: {
      id: string
      fileName: string
      mimeType: string
      sizeBytes: number
      storageId?: string
      extractedSignals: string[]
    }
    analysis: {
      analyzerId: string
      fileSizeBytes: number
      mimeType: string
      searchableText: boolean
      certificateOfServiceDetected: boolean
      certificateOfComplianceDetected: boolean
      sealedOrRedactionWarning: boolean
      warnings: string[]
    }
  },
  unknown
>('caseSessions:persistDocumentAnalysis')
const submitFilingRef = makeFunctionReference<
  'mutation',
  {
    caseSessionId: Id<'caseSessions'>
    draft: {
      eventId: string
      participantRole: 'appellant'
      title: string
      documents: Array<{
        id: string
        fileName: string
        mimeType: string
        sizeBytes: number
        storageId?: string
        extractedSignals: string[]
      }>
      certificateOfService: boolean
      certificateOfCompliance: boolean
      sealed: boolean
      notes: string
    }
  },
  CaseSession
>('caseSessions:submitFiling')
const createPrivateScenarioRef = makeFunctionReference<
  'mutation',
  ScenarioInput,
  Scenario
>('scenarios:createPrivateScenario')
const listAvailableScenariosRef = makeFunctionReference<
  'query',
  { institutionId?: Id<'institutions'> },
  Scenario[]
>('scenarios:listAvailableForCurrentUser')
const updatePrivateScenarioRef = makeFunctionReference<
  'mutation',
  { scenarioId: string; input: ScenarioInput },
  Scenario
>('scenarios:updatePrivateScenario')
const createAssignmentRef = makeFunctionReference<
  'mutation',
  {
    cohortId: Id<'cohorts'>
    scenarioId?: Id<'scenarios'>
    scenarioKey?: string
    title: string
    published: boolean
  },
  Id<'assignments'>
>('assignments:create')
const startAssignmentSessionRef = makeFunctionReference<
  'mutation',
  { assignmentId: Id<'assignments'> },
  Id<'caseSessions'>
>('assignments:startSession')
const attachSessionRef = makeFunctionReference<
  'mutation',
  { assignmentId: Id<'assignments'>; caseSessionId: Id<'caseSessions'> },
  Id<'caseSessions'>
>('assignments:attachSession')
const submitAssignmentSessionRef = makeFunctionReference<
  'mutation',
  { assignmentId: Id<'assignments'>; caseSessionId: Id<'caseSessions'> },
  null
>('assignments:submitSession')
const reopenAssignmentSessionRef = makeFunctionReference<
  'mutation',
  { assignmentSessionId: Id<'assignmentSessions'> },
  null
>('assignments:reopenSession')
const reviewAssignmentSessionRef = makeFunctionReference<
  'mutation',
  { assignmentSessionId: Id<'assignmentSessions'>; instructorNote: string; score?: number },
  null
>('instructor:reviewAssignmentSession')

async function expectAppError(promise: Promise<unknown>, code: AppErrorCode) {
  let caught: unknown
  try {
    await promise
  } catch (error) {
    caught = error
  }
  expect(caught).toBeDefined()
  expect((caught as { data?: { code?: AppErrorCode } }).data?.code).toBe(code)
  return caught
}

async function seedIsolationFixture(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const user = async (subject: string) =>
      ctx.db.insert('users', {
        authSubject: identity(subject).tokenIdentifier,
        displayName: subject,
        monthlyAiBudgetCents: 250,
      })
    const alice = await user('alice')
    const peer = await user('peer')
    const instructor = await user('instructor')
    const outsider = await user('outsider')
    const dual = await user('dual')
    const now = '2026-10-03T00:00:00.000Z'
    const orgA = await ctx.db.insert('institutions', {
      kind: 'shared',
      createdAt: now,
      name: 'Organization A',
      slug: 'organization-a',
      status: 'active',
      monthlyAiBudgetCents: 0,
    })
    const orgB = await ctx.db.insert('institutions', {
      kind: 'shared',
      createdAt: now,
      name: 'Organization B',
      slug: 'organization-b',
      status: 'active',
      monthlyAiBudgetCents: 0,
    })
    const member = (
      institutionId: Id<'institutions'>,
      userId: Id<'users'>,
      role: 'learner' | 'instructor' | 'admin' = 'learner',
    ) =>
      ctx.db.insert('institutionMemberships', {
        institutionId,
        userId,
        role,
        status: 'active',
        createdAt: now,
      })
    const aliceA = await member(orgA, alice)
    await member(orgA, peer)
    const instructorA = await member(orgA, instructor, 'instructor')
    await member(orgB, outsider)
    const dualA = await member(orgA, dual)
    const dualB = await member(orgB, dual)
    return {
      alice,
      peer,
      instructor,
      outsider,
      dual,
      orgA,
      orgB,
      aliceA,
      instructorA,
      dualA,
      dualB,
    }
  })
}

function scenarioInput(title = 'Private training scenario'): ScenarioInput {
  return {
    title,
    source: 'synthetic',
    courtPackId: 'us-federal-ca4-civil-appeal',
    shortCaption: 'Example v. State',
    lowerTribunal: 'District Court',
    natureOfSuit: 'Civil rights',
    proceduralPosture: 'Appeal from summary judgment',
    issuesPresented: ['Whether the record supports judgment.'],
    meritsRecord: ['A synthetic record for isolated testing.'],
  }
}

async function createAssignmentSession(
  t: TestConvex<typeof schema>,
  input: {
    institutionId: Id<'institutions'>
    scenarioId: Id<'scenarios'>
    caseSessionId: Id<'caseSessions'>
    userId: Id<'users'>
    submittedAt: string
  },
) {
  return t.run(async (ctx) => {
    const cohortId = await ctx.db.insert('cohorts', {
      institutionId: input.institutionId,
      title: 'Isolation cohort',
      term: 'Fall 2026',
      startsAt: '2026-09-01T00:00:00.000Z',
      endsAt: '2026-12-20T00:00:00.000Z',
      archived: false,
    })
    const assignmentId = await ctx.db.insert('assignments', {
      cohortId,
      scenarioId: input.scenarioId,
      title: 'Isolation assignment',
      published: true,
      createdByUserId: input.userId,
      createdAt: '2026-10-03T00:00:00.000Z',
    })
    const assignmentSessionId = await ctx.db.insert('assignmentSessions', {
      assignmentId,
      caseSessionId: input.caseSessionId,
      userId: input.userId,
      submittedAt: input.submittedAt,
    })
    return { cohortId, assignmentId, assignmentSessionId }
  })
}

async function seedCohortAssignment(
  t: TestConvex<typeof schema>,
  input: {
    institutionId: Id<'institutions'>
    scenarioId: Id<'scenarios'>
    createdByUserId: Id<'users'>
    learners: Id<'users'>[]
    title: string
    simulationPolicyId?: Id<'simulationPolicies'>
  },
) {
  return t.run(async (ctx) => {
    const cohortId = await ctx.db.insert('cohorts', {
      institutionId: input.institutionId,
      title: `${input.title} cohort`,
      term: 'Fall 2026',
      startsAt: '2026-09-01T00:00:00.000Z',
      endsAt: '2026-12-20T00:00:00.000Z',
      archived: false,
    })
    for (const learnerId of input.learners) {
      await ctx.db.insert('cohortMemberships', {
        cohortId,
        userId: learnerId,
        role: 'learner',
      })
    }
    const assignmentId = await ctx.db.insert('assignments', {
      cohortId,
      scenarioId: input.scenarioId,
      title: input.title,
      published: true,
      createdByUserId: input.createdByUserId,
      createdAt: '2026-10-03T00:00:00.000Z',
      ...(input.simulationPolicyId
        ? { simulationPolicyId: input.simulationPolicyId }
        : {}),
    })
    return { cohortId, assignmentId }
  })
}

describe('organization isolation for sessions and scenarios', () => {
  it('binds a new session to a trusted personal organization and checks explicit organization membership first', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedIsolationFixture(t)
    const asAlice = t.withIdentity(identity('alice'))

    const first = await asAlice.mutation(createSessionRef, {})
    const second = await asAlice.mutation(createSessionRef, {})
    expect(first.institutionId).toBeDefined()
    expect(second.institutionId).toBe(first.institutionId)
    const personal = await t.run(async (ctx) => {
      const institutions = await ctx.db
        .query('institutions')
        .withIndex('by_personal_owner', (index) => index.eq('personalOwnerUserId', fixture.alice))
        .collect()
      const session = await ctx.db.get(first.id as Id<'caseSessions'>)
      return { institutions, session }
    })
    expect(personal.institutions).toHaveLength(1)
    expect(personal.institutions[0]?._id).toBe(first.institutionId)
    expect(personal.session?.institutionId).toBe(first.institutionId)

    const before = await t.run(async (ctx) => ({
      sessions: (await ctx.db.query('caseSessions').collect()).length,
      scenarios: (await ctx.db.query('scenarios').collect()).length,
    }))
    await expectAppError(
      asAlice.mutation(createSessionRef, { institutionId: fixture.orgB }),
      AppErrorCode.NOT_FOUND,
    )
    const after = await t.run(async (ctx) => ({
      sessions: (await ctx.db.query('caseSessions').collect()).length,
      scenarios: (await ctx.db.query('scenarios').collect()).length,
    }))
    expect(after).toEqual(before)
  })

  it('requires ownership and an active organization membership, and hides legacy unscoped sessions', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedIsolationFixture(t)
    const asAlice = t.withIdentity(identity('alice'))
    const session = await asAlice.mutation(createSessionRef, { institutionId: fixture.orgA })
    const sessionId = session.id as Id<'caseSessions'>

    await expectAppError(
      t.withIdentity(identity('peer')).query(getSessionRef, { caseSessionId: sessionId }),
      AppErrorCode.NOT_FOUND,
    )
    await expectAppError(
      t.withIdentity(identity('instructor')).query(getSessionRef, { caseSessionId: sessionId }),
      AppErrorCode.NOT_FOUND,
    )
    await expectAppError(
      asAlice.query(getSessionRef, {
        caseSessionId: sessionId,
        institutionId: fixture.orgB,
      }),
      AppErrorCode.NOT_FOUND,
    )

    await t.run((ctx) => ctx.db.patch(fixture.aliceA, { status: 'suspended' }))
    await expectAppError(
      asAlice.query(getSessionRef, { caseSessionId: sessionId }),
      AppErrorCode.NOT_FOUND,
    )
    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.aliceA, { status: 'active' })
      await ctx.db.patch(sessionId, { institutionId: undefined })
    })
    await expectAppError(
      asAlice.query(getSessionRef, { caseSessionId: sessionId }),
      AppErrorCode.NOT_FOUND,
    )
    expect(await asAlice.query(listSessionsRef, {})).toEqual([])
  })

  it('keeps private scenarios owner-only within an active organization and immutable across scope', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedIsolationFixture(t)
    const asAlice = t.withIdentity(identity('alice'))
    const privateScenario = await asAlice.mutation(createPrivateScenarioRef, {
      ...scenarioInput(),
      institutionId: fixture.orgA,
    })
    const privateScenarioDoc = await t.run((ctx) =>
      ctx.db
        .query('scenarios')
        .withIndex('by_scenario_key', (index) => index.eq('scenarioKey', privateScenario.id))
        .unique(),
    )
    expect(privateScenarioDoc?.institutionId).toBe(fixture.orgA)
    const ownerSession = await asAlice.mutation(createSessionRef, {
      institutionId: fixture.orgA,
      scenarioId: privateScenario.id,
    })
    expect(ownerSession.scenario.id).toBe(privateScenario.id)
    const aliceScenarios = await asAlice.query(listAvailableScenariosRef, {
      institutionId: fixture.orgA,
    })
    expect(aliceScenarios.some((scenario) => scenario.id === privateScenario.id)).toBe(true)
    const peerScenarios = await t
      .withIdentity(identity('peer'))
      .query(listAvailableScenariosRef, { institutionId: fixture.orgA })
    expect(peerScenarios.some((scenario) => scenario.id === privateScenario.id)).toBe(false)
    await expectAppError(
      t.withIdentity(identity('peer')).mutation(createSessionRef, {
        institutionId: fixture.orgA,
        scenarioId: privateScenario.id,
      }),
      AppErrorCode.NOT_FOUND,
    )
    await expectAppError(
      asAlice.mutation(createPrivateScenarioRef, {
        ...scenarioInput('Wrong organization'),
        institutionId: fixture.orgB,
      }),
      AppErrorCode.NOT_FOUND,
    )
    await expectAppError(
      t.withIdentity(identity('peer')).mutation(updatePrivateScenarioRef, {
        scenarioId: privateScenario.id,
        input: scenarioInput('Unauthorized update'),
      }),
      AppErrorCode.NOT_FOUND,
    )

    const publicSeed = await t.mutation(internal.scenarios.seedPublished, {})
    expect(publicSeed.inserted + publicSeed.updated).toBeGreaterThan(0)
    const publicKey = 'synthetic-employment-retaliation'
    const publicBefore = await t.run((ctx) =>
      ctx.db
        .query('scenarios')
        .withIndex('by_scenario_key', (index) => index.eq('scenarioKey', publicKey))
        .unique(),
    )
    if (!publicBefore) throw new Error('public template fixture missing')
    await expectAppError(
      asAlice.mutation(updatePrivateScenarioRef, {
        scenarioId: publicKey,
        input: scenarioInput('Attempted template update'),
      }),
      AppErrorCode.CONFLICT,
    )
    const publicAfter = await t.run((ctx) => ctx.db.get(publicBefore._id))
    expect(publicAfter?.title).toBe(publicBefore.title)
    const assignmentCohortId = await t.run((ctx) =>
      ctx.db.insert('cohorts', {
        institutionId: fixture.orgA,
        title: 'Public template assignment cohort',
        term: 'Fall 2026',
        startsAt: '2026-09-01T00:00:00.000Z',
        endsAt: '2026-12-20T00:00:00.000Z',
        archived: false,
      }),
    )
    await t.withIdentity(identity('instructor')).mutation(createAssignmentRef, {
      cohortId: assignmentCohortId,
      scenarioKey: publicKey,
      title: 'Published template assignment',
      published: true,
    })
    const publicAfterAssignment = await t.run((ctx) => ctx.db.get(publicBefore._id))
    expect(publicAfterAssignment).toEqual(publicBefore)

    await t.run((ctx) => ctx.db.patch(fixture.aliceA, { status: 'suspended' }))
    await expectAppError(
      asAlice.mutation(updatePrivateScenarioRef, {
        scenarioId: privateScenario.id,
        input: scenarioInput('Suspended update'),
      }),
      AppErrorCode.NOT_FOUND,
    )
  })

  it('binds assignment-started sessions and rejects a revoked private-scenario owner before writes', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedIsolationFixture(t)
    const scenarioIds = await t.run(async (ctx) => {
      const scenario = async (scenarioKey: string, title: string) =>
        ctx.db.insert('scenarios', {
          scenarioKey,
          institutionId: fixture.orgA,
          visibility: 'private',
          scenarioFamilyKey: scenarioKey,
          revision: 1,
          revisionStatus: 'draft',
          title,
          source: 'synthetic',
          courtPackId: 'us-federal-ca4-civil-appeal',
          shortCaption: 'Example v. State',
          lowerTribunal: 'District Court',
          natureOfSuit: 'Civil rights',
          proceduralPosture: 'Appeal from summary judgment',
          issuesPresented: ['Whether the record supports judgment.'],
          meritsRecord: ['A synthetic record for isolated testing.'],
          ownerUserId: fixture.instructor,
          published: false,
        })
      const [activeOwnerScenarioId, revokedOwnerScenarioId] = await Promise.all([
        scenario('private-assignment-active-owner', 'Active owner scenario'),
        scenario('private-assignment-revoked-owner', 'Revoked owner scenario'),
      ])
      const cohortId = await ctx.db.insert('cohorts', {
        institutionId: fixture.orgA,
        title: 'Assignment ownership cohort',
        term: 'Fall 2026',
        startsAt: '2026-09-01T00:00:00.000Z',
        endsAt: '2026-12-20T00:00:00.000Z',
        archived: false,
      })
      await ctx.db.insert('cohortMemberships', {
        cohortId,
        userId: fixture.alice,
        role: 'learner',
      })
      const assignment = (scenarioId: Id<'scenarios'>, title: string) =>
        ctx.db.insert('assignments', {
          cohortId,
          scenarioId,
          title,
          published: true,
          createdByUserId: fixture.instructor,
          createdAt: '2026-10-03T00:00:00.000Z',
        })
      const [activeOwnerAssignmentId, revokedOwnerAssignmentId] = await Promise.all([
        assignment(activeOwnerScenarioId, 'Active owner assignment'),
        assignment(revokedOwnerScenarioId, 'Revoked owner assignment'),
      ])
      return {
        activeOwnerScenarioId,
        revokedOwnerScenarioId,
        activeOwnerAssignmentId,
        revokedOwnerAssignmentId,
      }
    })

    const asAlice = t.withIdentity(identity('alice'))
    const sessionId = await asAlice.mutation(startAssignmentSessionRef, {
      assignmentId: scenarioIds.activeOwnerAssignmentId,
    })
    expect(
      await t.run((ctx) => ctx.db.get(sessionId)),
    ).toMatchObject({
      userId: fixture.alice,
      institutionId: fixture.orgA,
      scenarioId: scenarioIds.activeOwnerScenarioId,
    })

    await t.run((ctx) => ctx.db.patch(fixture.instructorA, { status: 'suspended' }))
    const before = await t.run(async (ctx) => ({
      sessions: await ctx.db.query('caseSessions').collect(),
      assignmentSessions: await ctx.db.query('assignmentSessions').collect(),
    }))
    await expectAppError(
      asAlice.mutation(startAssignmentSessionRef, {
        assignmentId: scenarioIds.revokedOwnerAssignmentId,
      }),
      AppErrorCode.NOT_FOUND,
    )
    const after = await t.run(async (ctx) => ({
      sessions: await ctx.db.query('caseSessions').collect(),
      assignmentSessions: await ctx.db.query('assignmentSessions').collect(),
    }))
    expect(after).toEqual(before)
  })

  it('rejects cross-organization or foreign-owner attachments and preserves submitted locks', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedIsolationFixture(t)
    await t.mutation(internal.scenarios.seedPublished, {})
    const publicKey = 'synthetic-employment-retaliation'
    const publicScenario = await t.run((ctx) =>
      ctx.db
        .query('scenarios')
        .withIndex('by_scenario_key', (index) => index.eq('scenarioKey', publicKey))
        .unique(),
    )
    if (!publicScenario) throw new Error('public template fixture missing')
    const [assignmentA, assignmentB] = await Promise.all([
      seedCohortAssignment(t, {
        institutionId: fixture.orgA,
        scenarioId: publicScenario._id,
        createdByUserId: fixture.instructor,
        learners: [fixture.dual],
        title: 'Organization A attachment',
      }),
      seedCohortAssignment(t, {
        institutionId: fixture.orgB,
        scenarioId: publicScenario._id,
        createdByUserId: fixture.instructor,
        learners: [fixture.dual],
        title: 'Organization B attachment',
      }),
    ])
    const asDual = t.withIdentity(identity('dual'))
    const orgASession = await asDual.mutation(createSessionRef, {
      institutionId: fixture.orgA,
      scenarioId: publicKey,
    })
    const beforeCrossOrgAttach = await t.run((ctx) =>
      ctx.db.query('assignmentSessions').collect(),
    )
    await expectAppError(
      asDual.mutation(attachSessionRef, {
        assignmentId: assignmentB.assignmentId,
        caseSessionId: orgASession.id as Id<'caseSessions'>,
      }),
      AppErrorCode.NOT_FOUND,
    )
    expect(await t.run((ctx) => ctx.db.query('assignmentSessions').collect())).toEqual(
      beforeCrossOrgAttach,
    )

    const aliceSession = await t.withIdentity(identity('alice')).mutation(createSessionRef, {
      institutionId: fixture.orgA,
      scenarioId: publicKey,
    })
    await expectAppError(
      asDual.mutation(attachSessionRef, {
        assignmentId: assignmentA.assignmentId,
        caseSessionId: aliceSession.id as Id<'caseSessions'>,
      }),
      AppErrorCode.NOT_FOUND,
    )
    expect(await t.run((ctx) => ctx.db.query('assignmentSessions').collect())).toEqual(
      beforeCrossOrgAttach,
    )

    const linkedSessionId = await asDual.mutation(startAssignmentSessionRef, {
      assignmentId: assignmentA.assignmentId,
    })
    expect(
      await asDual.mutation(attachSessionRef, {
        assignmentId: assignmentA.assignmentId,
        caseSessionId: linkedSessionId,
      }),
    ).toBe(linkedSessionId)
    await asDual.mutation(submitAssignmentSessionRef, {
      assignmentId: assignmentA.assignmentId,
      caseSessionId: linkedSessionId,
    })
    const beforeLockedAttach = await t.run(async (ctx) => ({
      session: await ctx.db.get(linkedSessionId),
      assignmentSessions: await ctx.db
        .query('assignmentSessions')
        .withIndex('by_case', (index) => index.eq('caseSessionId', linkedSessionId))
        .collect(),
    }))
    await expectAppError(
      asDual.mutation(attachSessionRef, {
        assignmentId: assignmentA.assignmentId,
        caseSessionId: linkedSessionId,
      }),
      AppErrorCode.SESSION_LOCKED,
    )
    const afterLockedAttach = await t.run(async (ctx) => ({
      session: await ctx.db.get(linkedSessionId),
      assignmentSessions: await ctx.db
        .query('assignmentSessions')
        .withIndex('by_case', (index) => index.eq('caseSessionId', linkedSessionId))
        .collect(),
    }))
    expect(afterLockedAttach).toEqual(beforeLockedAttach)

    const assignmentSession = beforeLockedAttach.assignmentSessions[0]
    if (!assignmentSession) throw new Error('assignment-session fixture missing')
    await t.withIdentity(identity('instructor')).mutation(reviewAssignmentSessionRef, {
      assignmentSessionId: assignmentSession._id,
      instructorNote: 'Reviewed in the owning organization.',
      score: 92,
    })
    const reviewEvent = await t.run(async (ctx) => ({
      assignmentSession: await ctx.db.get(assignmentSession._id),
      events: await ctx.db
        .query('caseSessionEvents')
        .withIndex('by_case', (index) => index.eq('caseSessionId', linkedSessionId))
        .collect(),
    }))
    expect(reviewEvent.assignmentSession?.reviewerUserId).toBe(fixture.instructor)
    expect(
      reviewEvent.events.some((event) => event.eventType === 'instructor_review_submitted'),
    ).toBe(true)
  })

  it('rejects foreign linked sessions before submit or reopen writes', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedIsolationFixture(t)
    await t.mutation(internal.scenarios.seedPublished, {})
    const publicScenario = await t.run((ctx) =>
      ctx.db
        .query('scenarios')
        .withIndex('by_scenario_key', (index) =>
          index.eq('scenarioKey', 'synthetic-employment-retaliation'),
        )
        .unique(),
    )
    if (!publicScenario) throw new Error('public template fixture missing')
    const assignment = await seedCohortAssignment(t, {
      institutionId: fixture.orgA,
      scenarioId: publicScenario._id,
      createdByUserId: fixture.instructor,
      learners: [fixture.dual],
      title: 'Foreign link assignment',
    })
    const foreignSession = await t.withIdentity(identity('dual')).mutation(createSessionRef, {
      institutionId: fixture.orgB,
      scenarioId: publicScenario.scenarioKey,
    })
    const assignmentSessionId = await t.run((ctx) =>
      ctx.db.insert('assignmentSessions', {
        assignmentId: assignment.assignmentId,
        caseSessionId: foreignSession.id as Id<'caseSessions'>,
        userId: fixture.dual,
        submittedAt: '2026-10-03T01:00:00.000Z',
      }),
    )
    const before = await t.run(async (ctx) => ({
      assignmentSession: await ctx.db.get(assignmentSessionId),
      caseSession: await ctx.db.get(foreignSession.id as Id<'caseSessions'>),
      auditLogs: await ctx.db.query('auditLog').collect(),
    }))

    await expectAppError(
      t.withIdentity(identity('dual')).mutation(submitAssignmentSessionRef, {
        assignmentId: assignment.assignmentId,
        caseSessionId: foreignSession.id as Id<'caseSessions'>,
      }),
      AppErrorCode.NOT_FOUND,
    )
    await expectAppError(
      t.withIdentity(identity('instructor')).mutation(reopenAssignmentSessionRef, {
        assignmentSessionId,
      }),
      AppErrorCode.NOT_FOUND,
    )

    const after = await t.run(async (ctx) => ({
      assignmentSession: await ctx.db.get(assignmentSessionId),
      caseSession: await ctx.db.get(foreignSession.id as Id<'caseSessions'>),
      auditLogs: await ctx.db.query('auditLog').collect(),
    }))
    expect(after).toEqual(before)
  })

  it('rechecks organization and session binding when finalizing AI reservations', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedIsolationFixture(t)
    const asDual = t.withIdentity(identity('dual'))
    const sessionA = await asDual.mutation(createSessionRef, { institutionId: fixture.orgA })
    const sessionB = await asDual.mutation(createSessionRef, { institutionId: fixture.orgB })
    const reservation = await asDual.mutation(internal.caseSessions.reserveAiRunForCurrentUser, {
      caseSessionId: sessionA.id as Id<'caseSessions'>,
      actorId: 'fixture-actor',
      model: 'fixture-model',
      promptHash: 'fixture-hash',
      nowIso: '2026-10-03T01:00:00.000Z',
      cooldownMs: 0,
      estimatedCostCents: 1,
    })
    if (!reservation.aiRunId) throw new Error('AI run fixture missing')

    const productsBefore = await t.run((ctx) => ctx.db.query('actorWorkProducts').collect())
    await expectAppError(
      asDual.mutation(internal.caseSessions.persistActorWorkProductForCurrentUser, {
        caseSessionId: sessionB.id as Id<'caseSessions'>,
        aiRunId: reservation.aiRunId,
        actorId: 'fixture-actor',
        kind: 'bench_memo',
        workProductJson: '{}',
        sourceDocumentAnalysisIds: [],
        sourceFilingIds: [],
        validationIssues: [],
        createdAt: '2026-10-03T01:00:01.000Z',
        costCents: 1,
        latencyMs: 1,
      }),
      AppErrorCode.NOT_FOUND,
    )
    expect(await t.run((ctx) => ctx.db.query('actorWorkProducts').collect())).toEqual(productsBefore)

    await t.run((ctx) => ctx.db.patch(fixture.dualA, { status: 'suspended' }))
    await expectAppError(
      asDual.mutation(internal.caseSessions.finalizeAiRunForCurrentUser, {
        aiRunId: reservation.aiRunId,
        actorId: 'fixture-actor',
        toolCallJson: '{}',
        accepted: true,
        issues: [],
        costCents: 1,
        latencyMs: 1,
      }),
      AppErrorCode.NOT_FOUND,
    )
    const run = await t.run((ctx) => ctx.db.get(reservation.aiRunId!))
    expect(run?.errorClass).toBe('in_flight')
    expect(run?.toolCallJson).toBe('')
  })

  it('enforces submitted locks and rejects assignment links to another owner or organization', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedIsolationFixture(t)
    const asAlice = t.withIdentity(identity('alice'))
    const session = await asAlice.mutation(createSessionRef, { institutionId: fixture.orgA })
    const sessionId = session.id as Id<'caseSessions'>
    const sessionDoc = await t.run((ctx) => ctx.db.get(sessionId))
    if (!sessionDoc) throw new Error('session fixture missing')
    const assignment = await createAssignmentSession(t, {
      institutionId: fixture.orgA,
      scenarioId: sessionDoc.scenarioId,
      caseSessionId: sessionId,
      userId: fixture.alice,
      submittedAt: '2026-10-03T01:00:00.000Z',
    })

    const before = await t.run(async (ctx) => ({
      session: await ctx.db.get(sessionId),
      events: await ctx.db
        .query('caseSessionEvents')
        .withIndex('by_case_sequence', (index) => index.eq('caseSessionId', sessionId))
        .collect(),
    }))
    await expectAppError(
      asAlice.mutation(acceptDisclaimerRef, { caseSessionId: sessionId, version: 'v1' }),
      AppErrorCode.SESSION_LOCKED,
    )
    const afterLock = await t.run(async (ctx) => ({
      session: await ctx.db.get(sessionId),
      events: await ctx.db
        .query('caseSessionEvents')
        .withIndex('by_case_sequence', (index) => index.eq('caseSessionId', sessionId))
        .collect(),
    }))
    expect(afterLock).toEqual(before)

    await t.run((ctx) => ctx.db.patch(assignment.assignmentSessionId, {
      reopenedAt: '2026-10-03T02:00:00.000Z',
      userId: fixture.peer,
    }))
    await expectAppError(
      asAlice.mutation(advanceExpectedEventRef, { caseSessionId: sessionId }),
      AppErrorCode.CONFLICT,
    )
    await t.run((ctx) => ctx.db.patch(assignment.assignmentSessionId, { userId: fixture.alice }))
    await t.run((ctx) => ctx.db.patch(assignment.cohortId, { institutionId: fixture.orgB }))
    await expectAppError(
      asAlice.mutation(advanceExpectedEventRef, { caseSessionId: sessionId }),
      AppErrorCode.CONFLICT,
    )
    expect(await t.run((ctx) => ctx.db.get(sessionId))).toEqual(before.session)
  })

  it('rejects a receipt whose filing belongs to another session before disclosure', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedIsolationFixture(t)
    const asDual = t.withIdentity(identity('dual'))
    const sessionA = await asDual.mutation(createSessionRef, { institutionId: fixture.orgA })
    const sessionB = await asDual.mutation(createSessionRef, { institutionId: fixture.orgB })
    const filingB = await t.run((ctx) =>
      ctx.db.insert('filings', {
        caseSessionId: sessionB.id as Id<'caseSessions'>,
        eventId: 'notice_of_appeal',
        participantRole: 'appellant',
        title: 'Organization B filing',
        documentIds: [],
        certificateOfService: true,
        certificateOfCompliance: false,
        sealed: false,
        notes: '',
        filedAt: '2026-10-03T01:00:00.000Z',
        outcome: 'accepted',
        validationIssues: [],
      }),
    )
    await t.run((ctx) =>
      ctx.db.insert('ecfReceipts', {
        caseSessionId: sessionA.id as Id<'caseSessions'>,
        filingId: filingB,
        receiptNumber: 'foreign-receipt-number',
        noticeOfDocketActivityText: 'Foreign filing receipt',
        serviceListJson: JSON.stringify(['foreign@example.test']),
        createdAt: '2026-10-03T01:00:00.000Z',
      }),
    )

    await expectAppError(
      asDual.query(getSessionRef, { caseSessionId: sessionA.id as Id<'caseSessions'> }),
      AppErrorCode.NOT_FOUND,
    )
  })

  it('rejects raw client storage claims before document, filing, or storage effects', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedIsolationFixture(t)
    const asAlice = t.withIdentity(identity('alice'))
    const session = await asAlice.mutation(createSessionRef, { institutionId: fixture.orgA })
    const sessionId = session.id as Id<'caseSessions'>
    const document = {
      id: 'client-document',
      fileName: 'claimed.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 12,
      storageId: 'client-claimed-storage-id',
      extractedSignals: [],
    }
    const analysis = {
      analyzerId: 'fixture-analyzer',
      fileSizeBytes: 12,
      mimeType: 'application/pdf',
      searchableText: false,
      certificateOfServiceDetected: false,
      certificateOfComplianceDetected: false,
      sealedOrRedactionWarning: false,
      warnings: [],
    }
    const before = await t.run(async (ctx) => ({
      documents: await ctx.db.query('documents').collect(),
      analyses: await ctx.db.query('documentAnalyses').collect(),
      session: await ctx.db.get(sessionId),
    }))

    await expectAppError(
      asAlice.mutation(generateUploadUrlRef, { caseSessionId: sessionId }),
      AppErrorCode.VALIDATION_ERROR,
    )
    await expectAppError(
      asAlice.mutation(persistDocumentAnalysisRef, {
        caseSessionId: sessionId,
        document,
        analysis,
      }),
      AppErrorCode.VALIDATION_ERROR,
    )
    await expectAppError(
      asAlice.mutation(submitFilingRef, {
        caseSessionId: sessionId,
        draft: {
          eventId: 'notice_of_appeal',
          participantRole: 'appellant',
          title: 'Client claimed document',
          documents: [document],
          certificateOfService: true,
          certificateOfCompliance: false,
          sealed: false,
          notes: '',
        },
      }),
      AppErrorCode.VALIDATION_ERROR,
    )
    const after = await t.run(async (ctx) => ({
      documents: await ctx.db.query('documents').collect(),
      analyses: await ctx.db.query('documentAnalyses').collect(),
      session: await ctx.db.get(sessionId),
    }))
    expect(after).toEqual(before)
  })
})
