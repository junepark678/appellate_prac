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
import { describe, expect, it, vi } from 'vitest'

import type { Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { AppErrorCode } from './errors'
import schema from './schema'
import type { ActorWorkProduct, CaseSession, Scenario } from '../src/domain/types'
import { createInitialSession, nextExpectedToolCall } from '../src/domain/simulation'
import { generateActorWorkProductWithProvider } from '../src/domain/actors/orchestration'
import type { AiProvider, StructuredAiRequest, StructuredAiResult } from '../src/domain/ports'

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
const copyTemplateRef = makeFunctionReference<
  'mutation',
  { scenarioId: string; institutionId?: Id<'institutions'> },
  Scenario
>('scenarios:copyTemplateForCurrentUser')
const acceptActorWorkProductRef = makeFunctionReference<
  'mutation',
  { caseSessionId: Id<'caseSessions'>; workProductId: Id<'actorWorkProducts'> },
  { session: CaseSession; workProduct: ActorWorkProduct; receipt: unknown }
>('caseSessions:acceptActorWorkProduct')
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
const listAssignmentSessionsRef = makeFunctionReference<
  'query',
  { assignmentId: Id<'assignments'> },
  unknown[]
>('instructor:listAssignmentSessions')
const exportAssignmentCsvRef = makeFunctionReference<
  'query',
  { assignmentId: Id<'assignments'> },
  string
>('instructor:exportAssignmentCsv')
const getSessionReplayRef = makeFunctionReference<
  'query',
  { caseSessionId: Id<'caseSessions'> },
  unknown[]
>('instructor:getSessionReplay')
const getReviewContextRef = makeFunctionReference<
  'query',
  { caseSessionId: Id<'caseSessions'> },
  unknown
>('instructor:getReviewContext')
const getAssignmentRef = makeFunctionReference<
  'query',
  { assignmentId: Id<'assignments'> },
  {
    status: 'not_started' | 'in_progress' | 'submitted' | 'reviewed'
    caseSessionId?: Id<'caseSessions'>
    submittedAt?: string
    reviewedAt?: string
    instructorNote?: string
  } | null
>('assignments:get')
const listMineAssignmentsRef = makeFunctionReference<
  'query',
  Record<string, never>,
  Array<{
    id: Id<'assignments'>
    status: 'not_started' | 'in_progress' | 'submitted' | 'reviewed'
    caseSessionId?: Id<'caseSessions'>
    submittedAt?: string
    reviewedAt?: string
  }>
>('assignments:listMine')

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

  it('uses only personal private scenarios for omitted listing context and leaves reads side-effect free', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedIsolationFixture(t)
    const asAlice = t.withIdentity(identity('alice'))
    await t.mutation(internal.scenarios.seedPublished, {})

    const sharedScenario = await asAlice.mutation(createPrivateScenarioRef, {
      ...scenarioInput('Shared organization private scenario'),
      institutionId: fixture.orgA,
    })
    const personalScenario = await asAlice.mutation(createPrivateScenarioRef, {
      ...scenarioInput('Personal private scenario'),
    })
    const omitted = await asAlice.query(listAvailableScenariosRef, {})
    expect(omitted.some((scenario) => scenario.id === personalScenario.id)).toBe(true)
    expect(omitted.some((scenario) => scenario.id === sharedScenario.id)).toBe(false)
    expect(omitted.some((scenario) => scenario.visibility === 'public_template')).toBe(true)

    const explicitShared = await asAlice.query(listAvailableScenariosRef, {
      institutionId: fixture.orgA,
    })
    expect(explicitShared.some((scenario) => scenario.id === sharedScenario.id)).toBe(true)
    expect(explicitShared.some((scenario) => scenario.id === personalScenario.id)).toBe(false)
    expect(explicitShared.some((scenario) => scenario.visibility === 'public_template')).toBe(true)

    const outsiderBefore = await t.run((ctx) =>
      ctx.db
        .query('institutions')
        .withIndex('by_personal_owner', (index) => index.eq('personalOwnerUserId', fixture.outsider))
        .collect(),
    )
    const outsiderScenarios = await t
      .withIdentity(identity('outsider'))
      .query(listAvailableScenariosRef, {})
    const outsiderAfter = await t.run((ctx) =>
      ctx.db
        .query('institutions')
        .withIndex('by_personal_owner', (index) => index.eq('personalOwnerUserId', fixture.outsider))
        .collect(),
    )
    expect(outsiderScenarios.some((scenario) => scenario.visibility === 'private')).toBe(false)
    expect(outsiderScenarios.some((scenario) => scenario.visibility === 'public_template')).toBe(true)
    expect(outsiderAfter).toEqual(outsiderBefore)
  })

  it('fails closed to public templates when personal workspace ownership is inactive or malformed', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedIsolationFixture(t)
    await t.mutation(internal.scenarios.seedPublished, {})
    await t.run(async (ctx) => {
      const createMalformedPersonal = async (input: {
        userId: Id<'users'>
        kind: 'personal' | 'shared'
        status: 'active' | 'paused'
        slug: string
      }) => {
        const institutionId = await ctx.db.insert('institutions', {
          kind: input.kind,
          personalOwnerUserId: input.userId,
          createdAt: '2026-10-03T00:00:00.000Z',
          name: 'Fixture personal workspace',
          slug: input.slug,
          status: input.status,
          monthlyAiBudgetCents: 0,
        })
        await ctx.db.insert('institutionMemberships', {
          institutionId,
          userId: input.userId,
          role: 'admin',
          status: 'active',
          createdAt: '2026-10-03T00:00:00.000Z',
        })
        await ctx.db.insert('scenarios', {
          scenarioKey: `${input.slug}-private`,
          institutionId,
          visibility: 'private',
          scenarioFamilyKey: `${input.slug}-private`,
          revision: 1,
          revisionStatus: 'draft',
          title: 'Malformed workspace private scenario',
          source: 'synthetic',
          courtPackId: 'us-federal-ca4-civil-appeal',
          shortCaption: 'Fixture v. State',
          lowerTribunal: 'District Court',
          natureOfSuit: 'Civil rights',
          proceduralPosture: 'Appeal from summary judgment',
          issuesPresented: ['Whether the record supports judgment.'],
          meritsRecord: ['A synthetic record for isolated testing.'],
          ownerUserId: input.userId,
          published: false,
        })
      }
      await createMalformedPersonal({
        userId: fixture.peer,
        kind: 'personal',
        status: 'paused',
        slug: 'suspended-personal',
      })
      await createMalformedPersonal({
        userId: fixture.outsider,
        kind: 'shared',
        status: 'active',
        slug: 'misclassified-personal',
      })
    })

    for (const subject of ['peer', 'outsider']) {
      const scenarios = await t
        .withIdentity(identity(subject))
        .query(listAvailableScenariosRef, {})
      expect(scenarios.some((scenario) => scenario.visibility === 'private')).toBe(false)
      expect(scenarios.some((scenario) => scenario.visibility === 'public_template')).toBe(true)
    }
  })

  it('keeps published public templates globally readable across organization contexts', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedIsolationFixture(t)
    await t.mutation(internal.scenarios.seedPublished, {})
    const scenarioKey = 'synthetic-employment-retaliation'
    const publicBefore = await t.run((ctx) =>
      ctx.db
        .query('scenarios')
        .withIndex('by_scenario_key', (index) => index.eq('scenarioKey', scenarioKey))
        .unique(),
    )
    if (!publicBefore) throw new Error('public template fixture missing')
    const asDual = t.withIdentity(identity('dual'))
    for (const institutionId of [undefined, fixture.orgA, fixture.orgB]) {
      const scenarios = await asDual.query(listAvailableScenariosRef, { institutionId })
      expect(scenarios.some((scenario) => scenario.id === scenarioKey)).toBe(true)
    }
    const orgASession = await asDual.mutation(createSessionRef, {
      institutionId: fixture.orgA,
      scenarioId: scenarioKey,
    })
    const orgBSession = await asDual.mutation(createSessionRef, {
      institutionId: fixture.orgB,
      scenarioId: scenarioKey,
    })
    expect(orgASession.scenario.id).toBe(scenarioKey)
    expect(orgBSession.scenario.id).toBe(scenarioKey)
    expect(await asDual.query(getSessionRef, {
      caseSessionId: orgASession.id as Id<'caseSessions'>,
    })).toMatchObject({ id: orgASession.id, institutionId: fixture.orgA })
    expect(await asDual.query(getSessionRef, {
      caseSessionId: orgBSession.id as Id<'caseSessions'>,
    })).toMatchObject({ id: orgBSession.id, institutionId: fixture.orgB })
    expect(await t.run((ctx) => ctx.db.get(publicBefore._id))).toEqual(publicBefore)
  })

  it('keeps catalog discovery global but checks stored scope on malformed public-row writes', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedIsolationFixture(t)
    const scenarioKey = 'scoped-public-template-legacy-fixture'
    const scenarioId = await t.run((ctx) =>
      ctx.db.insert('scenarios', {
        scenarioKey,
        institutionId: fixture.orgA,
        visibility: 'public_template',
        scenarioFamilyKey: scenarioKey,
        revision: 1,
        revisionStatus: 'published',
        title: 'Scoped legacy public template fixture',
        source: 'synthetic',
        courtPackId: 'us-federal-ca4-civil-appeal',
        shortCaption: 'Example v. State',
        lowerTribunal: 'District Court',
        natureOfSuit: 'Civil rights',
        proceduralPosture: 'Appeal from summary judgment',
        issuesPresented: ['Whether the record supports judgment.'],
        meritsRecord: ['A synthetic record for isolated testing.'],
        published: true,
      }),
    )
    const scenarioBefore = await t.run((ctx) => ctx.db.get(scenarioId))
    const asDual = t.withIdentity(identity('dual'))
    for (const institutionId of [undefined, fixture.orgA, fixture.orgB]) {
      const listed = await asDual.query(listAvailableScenariosRef, { institutionId })
      expect(listed.some((scenario) => scenario.id === scenarioKey)).toBe(true)
    }

    await expectAppError(
      asDual.mutation(createSessionRef, {
        institutionId: fixture.orgB,
        scenarioId: scenarioKey,
      }),
      AppErrorCode.NOT_FOUND,
    )
    const orgASession = await asDual.mutation(createSessionRef, {
      institutionId: fixture.orgA,
      scenarioId: scenarioKey,
    })
    expect(orgASession.scenario.id).toBe(scenarioKey)
    await expectAppError(
      asDual.mutation(copyTemplateRef, {
        scenarioId: scenarioKey,
        institutionId: fixture.orgB,
      }),
      AppErrorCode.NOT_FOUND,
    )
    const privateCopy = await asDual.mutation(copyTemplateRef, {
      scenarioId: scenarioKey,
      institutionId: fixture.orgA,
    })
    expect(privateCopy.visibility).toBe('private')
    expect(await t.run((ctx) => ctx.db.get(scenarioId))).toEqual(scenarioBefore)

    const cohorts = await t.run(async (ctx) => {
      await ctx.db.insert('institutionMemberships', {
        institutionId: fixture.orgB,
        userId: fixture.instructor,
        role: 'instructor',
        status: 'active',
        createdAt: '2026-10-03T00:00:00.000Z',
      })
      const createCohort = (institutionId: Id<'institutions'>, slug: string) =>
        ctx.db.insert('cohorts', {
          institutionId,
          title: `${slug} cohort`,
          term: 'Fall 2026',
          startsAt: '2026-09-01T00:00:00.000Z',
          endsAt: '2026-12-20T00:00:00.000Z',
          archived: false,
        })
      const [orgACohort, orgBCohort] = await Promise.all([
        createCohort(fixture.orgA, 'Org A'),
        createCohort(fixture.orgB, 'Org B'),
      ])
      return { orgACohort, orgBCohort }
    })
    await t.withIdentity(identity('instructor')).mutation(createAssignmentRef, {
      cohortId: cohorts.orgACohort,
      scenarioId,
      title: 'Same scope malformed public row',
      published: true,
    })
    await expectAppError(
      t.withIdentity(identity('instructor')).mutation(createAssignmentRef, {
        cohortId: cohorts.orgBCohort,
        scenarioId,
        title: 'Cross scope malformed public row',
        published: true,
      }),
      AppErrorCode.CONFLICT,
    )
    expect(await t.run((ctx) => ctx.db.get(scenarioId))).toEqual(scenarioBefore)
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

  it('preserves valid learner and instructor assignment-session projections', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedIsolationFixture(t)
    await t.mutation(internal.scenarios.seedPublished, {})
    const scenario = await t.run((ctx) =>
      ctx.db
        .query('scenarios')
        .withIndex('by_scenario_key', (index) =>
          index.eq('scenarioKey', 'synthetic-employment-retaliation'),
        )
        .unique(),
    )
    if (!scenario) throw new Error('public template fixture missing')
    const assignment = await seedCohortAssignment(t, {
      institutionId: fixture.orgA,
      scenarioId: scenario._id,
      createdByUserId: fixture.instructor,
      learners: [fixture.dual],
      title: 'Valid session projection',
    })
    const asDual = t.withIdentity(identity('dual'))
    const caseSessionId = await asDual.mutation(startAssignmentSessionRef, {
      assignmentId: assignment.assignmentId,
    })
    await asDual.mutation(submitAssignmentSessionRef, {
      assignmentId: assignment.assignmentId,
      caseSessionId,
    })
    const assignmentSession = await t.run(async (ctx) =>
      ctx.db
        .query('assignmentSessions')
        .withIndex('by_assignment_user', (index) =>
          index.eq('assignmentId', assignment.assignmentId).eq('userId', fixture.dual),
        )
        .unique(),
    )
    if (!assignmentSession) throw new Error('assignment-session fixture missing')
    await t.withIdentity(identity('instructor')).mutation(reviewAssignmentSessionRef, {
      assignmentSessionId: assignmentSession._id,
      instructorNote: 'Validated inside the owning organization.',
      score: 91,
    })

    const learnerAssignment = await asDual.query(getAssignmentRef, {
      assignmentId: assignment.assignmentId,
    })
    expect(learnerAssignment).toMatchObject({
      status: 'reviewed',
      caseSessionId,
      submittedAt: assignmentSession.submittedAt,
      instructorNote: 'Validated inside the owning organization.',
    })
    expect(await asDual.query(listMineAssignmentsRef, {})).toContainEqual(
      expect.objectContaining({
        id: assignment.assignmentId,
        status: 'reviewed',
        caseSessionId,
        submittedAt: assignmentSession.submittedAt,
      }),
    )

    const asInstructor = t.withIdentity(identity('instructor'))
    expect(await asInstructor.query(listAssignmentSessionsRef, {
      assignmentId: assignment.assignmentId,
    })).toContainEqual(
      expect.objectContaining({
        assignmentSessionId: assignmentSession._id,
        caseSessionId,
        userId: fixture.dual,
        status: 'reviewed',
        instructorNote: 'Validated inside the owning organization.',
      }),
    )
    expect(await asInstructor.query(exportAssignmentCsvRef, {
      assignmentId: assignment.assignmentId,
    })).toContain(String(caseSessionId))
    expect(await asInstructor.query(getSessionReplayRef, { caseSessionId })).toContainEqual(
      expect.objectContaining({ eventType: 'instructor_review_submitted' }),
    )
    expect(await asInstructor.query(getReviewContextRef, { caseSessionId })).toMatchObject({
      assignmentSessionId: assignmentSession._id,
      assignmentId: assignment.assignmentId,
      status: 'reviewed',
      instructorNote: 'Validated inside the owning organization.',
    })
  })

  it('validates generated actor sources, remaps accepted work products, and rejects foreign refs', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedIsolationFixture(t)
    const asAlice = t.withIdentity(identity('alice'))
    const sessionA = await asAlice.mutation(createSessionRef, { institutionId: fixture.orgA })
    const sessionB = await asAlice.mutation(createSessionRef, { institutionId: fixture.orgA })
    const sessionAId = sessionA.id as Id<'caseSessions'>
    const sessionBId = sessionB.id as Id<'caseSessions'>
    const originalSources = await t.run(async (ctx) => {
      const analysis = {
        analyzerId: 'fixture-analyzer',
        fileSizeBytes: 1200,
        mimeType: 'application/pdf',
        searchableText: true,
        certificateOfServiceDetected: true,
        certificateOfComplianceDetected: true,
        sealedOrRedactionWarning: false,
        warnings: [],
      }
      const documentId = await ctx.db.insert('documents', {
        caseSessionId: sessionAId,
        fileName: 'opening-brief.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1200,
        extractedSignals: ['opening brief', 'record citation'],
        validationJson: JSON.stringify(analysis),
      })
      const analysisId = await ctx.db.insert('documentAnalyses', {
        caseSessionId: sessionAId,
        documentId,
        analyzerId: 'fixture-analyzer',
        fileSizeBytes: 1200,
        mimeType: 'application/pdf',
        searchableText: true,
        certificateOfServiceDetected: true,
        certificateOfComplianceDetected: true,
        sealedOrRedactionWarning: false,
        warnings: [],
        analysisJson: JSON.stringify(analysis),
        createdAt: '2026-10-03T00:00:00.000Z',
      })
      await ctx.db.patch(documentId, { analysisId })
      const filingId = await ctx.db.insert('filings', {
        caseSessionId: sessionAId,
        eventId: 'opening_brief',
        participantRole: 'appellant',
        title: 'Opening Brief',
        documentIds: [documentId],
        documentAnalysisIds: [analysisId],
        certificateOfService: true,
        certificateOfCompliance: true,
        sealed: false,
        notes: 'Fixture accepted filing.',
        filedAt: '2026-10-03T00:00:00.000Z',
        outcome: 'accepted',
        validationIssues: [],
      })
      return { documentId, analysisId, filingId }
    })

    const sessionForGeneration = await asAlice.query(getSessionRef, { caseSessionId: sessionAId })
    if (!sessionForGeneration) throw new Error('actor session fixture missing')
    const memo = {
      title: 'Appellee strategy',
      summary: 'Review the opening brief before responding.',
      reasoning: [],
      recommendations: [],
      citations: [
        {
          id: 'opening-brief',
          label: 'Opening brief',
          sourceType: 'filing' as const,
          sourceId: originalSources.filingId,
        },
        {
          id: 'brief-analysis',
          label: 'Opening brief analysis',
          sourceType: 'document_analysis' as const,
          sourceId: originalSources.analysisId,
        },
      ],
      ruleRefs: [],
    }
    const provider: AiProvider = {
      id: 'fixture-provider',
      async completeStructured<T>(
        request: StructuredAiRequest<T>,
      ): Promise<StructuredAiResult<T>> {
        if (!request.schemaName) throw new Error('actor schema fixture missing')
        return { value: memo as T, rawText: JSON.stringify(memo), providerId: this.id }
      },
    }
    const generated = await generateActorWorkProductWithProvider({
      session: sessionForGeneration,
      provider,
      kind: 'counterparty_strategy',
      nowIso: new Date().toISOString(),
    })
    expect(generated.sourceDocumentAnalysisIds).toEqual([originalSources.analysisId])
    expect(generated.sourceFilingIds).toEqual([originalSources.filingId])

    const reserve = async (caseSessionId: Id<'caseSessions'>) => {
      const result = await asAlice.mutation(internal.caseSessions.reserveAiRunForCurrentUser, {
        caseSessionId,
        actorId: generated.actorId,
        model: 'fixture-model',
        promptHash: `fixture-${caseSessionId}`,
        nowIso: new Date().toISOString(),
        cooldownMs: 0,
        estimatedCostCents: 1,
      })
      if (!result.aiRunId) throw new Error('AI run fixture missing')
      return result.aiRunId
    }
    const persist = async (
      caseSessionId: Id<'caseSessions'>,
      aiRunId: Id<'aiRuns'>,
      sourceDocumentAnalysisIds: string[],
      sourceFilingIds: string[],
    ) =>
      asAlice.mutation(internal.caseSessions.persistActorWorkProductForCurrentUser, {
        caseSessionId,
        aiRunId,
        actorId: generated.actorId,
        kind: generated.kind,
        workProductJson: JSON.stringify(generated.workProduct),
        sourceDocumentAnalysisIds,
        sourceFilingIds,
        validationIssues: generated.validationIssues ?? [],
        createdAt: new Date().toISOString(),
        costCents: 1,
        latencyMs: 1,
      })

    const product = await persist(
      sessionAId,
      await reserve(sessionAId),
      generated.sourceDocumentAnalysisIds,
      generated.sourceFilingIds,
    )
    expect(product.sourceDocumentAnalysisIds).toEqual([originalSources.analysisId])

    const foreignAnalysisRun = await reserve(sessionBId)
    const foreignFilingRun = await reserve(sessionBId)
    const beforeForeignRefs = await t.run(async (ctx) => {
      const [products, analysisRun, filingRun] = await Promise.all([
        ctx.db.query('actorWorkProducts').collect(),
        ctx.db.get(foreignAnalysisRun),
        ctx.db.get(foreignFilingRun),
      ])
      return { products, analysisRun, filingRun }
    })
    await expectAppError(
      persist(sessionBId, foreignAnalysisRun, [originalSources.analysisId], []),
      AppErrorCode.NOT_FOUND,
    )
    await expectAppError(
      persist(sessionBId, foreignFilingRun, [], [originalSources.filingId]),
      AppErrorCode.NOT_FOUND,
    )
    const afterForeignRefs = await t.run(async (ctx) => {
      const [products, analysisRun, filingRun] = await Promise.all([
        ctx.db.query('actorWorkProducts').collect(),
        ctx.db.get(foreignAnalysisRun),
        ctx.db.get(foreignFilingRun),
      ])
      return { products, analysisRun, filingRun }
    })
    expect(afterForeignRefs).toEqual(beforeForeignRefs)

    const accepted = await asAlice.mutation(acceptActorWorkProductRef, {
      caseSessionId: sessionAId,
      workProductId: product.id as Id<'actorWorkProducts'>,
    })
    expect(accepted.workProduct.status).toBe('accepted')
    const newFilingId = accepted.session.filings[0]?.id
    const newAnalysisId = accepted.session.filings[0]?.documents[0]?.analysisId
    if (!newFilingId || !newAnalysisId) throw new Error('accepted source remap is missing')
    expect(newFilingId).not.toBe(originalSources.filingId)
    expect(newAnalysisId).not.toBe(originalSources.analysisId)
    expect(accepted.workProduct.sourceFilingIds).toEqual([newFilingId])
    expect(accepted.workProduct.sourceDocumentAnalysisIds).toEqual([newAnalysisId])
    expect(accepted.workProduct.citations.map((citation) => citation.sourceId)).toEqual([
      newFilingId,
      newAnalysisId,
    ])

    const remapped = await t.run(async (ctx) => ({
      product: await ctx.db.get(product.id as Id<'actorWorkProducts'>),
      filing: await ctx.db.get(newFilingId as Id<'filings'>),
      analysis: await ctx.db.get(newAnalysisId as Id<'documentAnalyses'>),
      oldFiling: await ctx.db.get(originalSources.filingId),
      oldAnalysis: await ctx.db.get(originalSources.analysisId),
    }))
    expect(remapped.filing?.caseSessionId).toBe(sessionAId)
    expect(remapped.analysis?.caseSessionId).toBe(sessionAId)
    expect(remapped.product?.sourceFilingIds).toEqual([newFilingId])
    expect(remapped.product?.sourceDocumentAnalysisIds).toEqual([newAnalysisId])
    expect(
      JSON.parse(remapped.product?.citationsJson ?? '[]').map(
        (citation: { sourceId?: string }) => citation.sourceId,
      ),
    ).toEqual([newFilingId, newAnalysisId])
    expect(remapped.oldFiling).toBeNull()
    expect(remapped.oldAnalysis).toBeNull()
  })

  it.each([
    'cross_organization',
    'foreign_owner',
    'legacy_unscoped',
    'mismatched_scenario',
    'revoked_session_owner',
  ] as const)('hides assignment projections for %s links', async (linkKind) => {
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
    const otherScenario = await t.run(async (ctx) =>
      (await ctx.db.query('scenarios').collect()).find(
        (scenario) =>
          scenario._id !== publicScenario._id &&
          scenario.visibility === 'public_template' &&
          scenario.published,
      ) ?? null,
    )
    if (!otherScenario) throw new Error('second public template fixture missing')
    const assignment = await seedCohortAssignment(t, {
      institutionId: fixture.orgA,
      scenarioId: publicScenario._id,
      createdByUserId: fixture.instructor,
      learners: [fixture.dual],
      title: `Invalid projection ${linkKind}`,
    })
    const asDual = t.withIdentity(identity('dual'))
    let caseSessionId: Id<'caseSessions'>
    if (linkKind === 'cross_organization') {
      const session = await asDual.mutation(createSessionRef, {
        institutionId: fixture.orgB,
        scenarioId: publicScenario.scenarioKey,
      })
      caseSessionId = session.id as Id<'caseSessions'>
    } else if (linkKind === 'foreign_owner') {
      const session = await t.withIdentity(identity('alice')).mutation(createSessionRef, {
        institutionId: fixture.orgA,
        scenarioId: publicScenario.scenarioKey,
      })
      caseSessionId = session.id as Id<'caseSessions'>
    } else if (linkKind === 'mismatched_scenario') {
      const session = await asDual.mutation(createSessionRef, {
        institutionId: fixture.orgA,
        scenarioId: otherScenario.scenarioKey,
      })
      caseSessionId = session.id as Id<'caseSessions'>
    } else {
      const session = await asDual.mutation(createSessionRef, {
        institutionId: fixture.orgA,
        scenarioId: publicScenario.scenarioKey,
      })
      caseSessionId = session.id as Id<'caseSessions'>
      if (linkKind === 'legacy_unscoped') {
        await t.run((ctx) => ctx.db.patch(caseSessionId, { institutionId: undefined }))
      }
      if (linkKind === 'revoked_session_owner') {
        await t.run((ctx) => ctx.db.patch(fixture.dualA, { status: 'suspended' }))
      }
    }
    await t.run((ctx) =>
      ctx.db.insert('assignmentSessions', {
        assignmentId: assignment.assignmentId,
        caseSessionId,
        userId: fixture.dual,
        submittedAt: '2026-10-03T01:00:00.000Z',
        reviewedAt: '2026-10-03T01:05:00.000Z',
        instructorNote: 'Foreign review note must remain hidden.',
        score: 100,
      }),
    )

    const errorCode = linkKind === 'mismatched_scenario'
      ? AppErrorCode.CONFLICT
      : AppErrorCode.NOT_FOUND
    for (const operation of [
      t.withIdentity(identity('instructor')).query(listAssignmentSessionsRef, {
        assignmentId: assignment.assignmentId,
      }),
      t.withIdentity(identity('instructor')).query(exportAssignmentCsvRef, {
        assignmentId: assignment.assignmentId,
      }),
      t.withIdentity(identity('instructor')).query(getSessionReplayRef, { caseSessionId }),
      t.withIdentity(identity('instructor')).query(getReviewContextRef, { caseSessionId }),
    ]) {
      await expectAppError(operation, errorCode)
    }

    if (linkKind === 'revoked_session_owner') {
      await expectAppError(
        asDual.query(getAssignmentRef, { assignmentId: assignment.assignmentId }),
        AppErrorCode.NOT_FOUND,
      )
      expect(await asDual.query(listMineAssignmentsRef, {})).toEqual([])
    } else {
      await expectAppError(
        asDual.query(getAssignmentRef, { assignmentId: assignment.assignmentId }),
        errorCode,
      )
      await expectAppError(asDual.query(listMineAssignmentsRef, {}), errorCode)
    }
  })

  it.each([
    'second_assignment_same_case',
    'second_session_same_assignment_user',
  ] as const)('rejects ambiguous assignment-session link sets: %s', async (duplicateKind) => {
    const t = convexTest(schema, modules)
    const fixture = await seedIsolationFixture(t)
    await t.mutation(internal.scenarios.seedPublished, {})
    const scenario = await t.run((ctx) =>
      ctx.db
        .query('scenarios')
        .withIndex('by_scenario_key', (index) =>
          index.eq('scenarioKey', 'synthetic-employment-retaliation'),
        )
        .unique(),
    )
    if (!scenario) throw new Error('public template fixture missing')
    const [assignmentA, assignmentB] = await Promise.all([
      seedCohortAssignment(t, {
        institutionId: fixture.orgA,
        scenarioId: scenario._id,
        createdByUserId: fixture.instructor,
        learners: [fixture.dual],
        title: 'First assignment link',
      }),
      seedCohortAssignment(t, {
        institutionId: fixture.orgA,
        scenarioId: scenario._id,
        createdByUserId: fixture.instructor,
        learners: [fixture.dual],
        title: 'Second assignment link',
      }),
    ])
    const asDual = t.withIdentity(identity('dual'))
    const caseSessionId = await asDual.mutation(startAssignmentSessionRef, {
      assignmentId: assignmentA.assignmentId,
    })
    if (duplicateKind === 'second_assignment_same_case') {
      await t.run((ctx) =>
        ctx.db.insert('assignmentSessions', {
          assignmentId: assignmentB.assignmentId,
          caseSessionId,
          userId: fixture.dual,
        }),
      )
    } else {
      const otherSession = await asDual.mutation(createSessionRef, {
        institutionId: fixture.orgA,
        scenarioId: scenario.scenarioKey,
      })
      await t.run((ctx) =>
        ctx.db.insert('assignmentSessions', {
          assignmentId: assignmentA.assignmentId,
          caseSessionId: otherSession.id as Id<'caseSessions'>,
          userId: fixture.dual,
        }),
      )
    }
    const before = await t.run(async (ctx) => ({
      session: await ctx.db.get(caseSessionId),
      links: await ctx.db.query('assignmentSessions').collect(),
      events: await ctx.db
        .query('caseSessionEvents')
        .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
        .collect(),
      audit: await ctx.db.query('auditLog').collect(),
    }))
    const asInstructor = t.withIdentity(identity('instructor'))
    await expectAppError(
      asDual.query(getSessionRef, { caseSessionId }),
      AppErrorCode.CONFLICT,
    )
    await expectAppError(
      asDual.mutation(acceptDisclaimerRef, { caseSessionId, version: 'v1' }),
      AppErrorCode.CONFLICT,
    )
    await expectAppError(
      asDual.query(getAssignmentRef, { assignmentId: assignmentA.assignmentId }),
      AppErrorCode.CONFLICT,
    )
    await expectAppError(
      asDual.query(listMineAssignmentsRef, {}),
      AppErrorCode.CONFLICT,
    )
    await expectAppError(
      asDual.mutation(attachSessionRef, {
        assignmentId: assignmentA.assignmentId,
        caseSessionId,
      }),
      AppErrorCode.CONFLICT,
    )
    await expectAppError(
      asDual.mutation(submitAssignmentSessionRef, {
        assignmentId: assignmentA.assignmentId,
        caseSessionId,
      }),
      AppErrorCode.CONFLICT,
    )
    const targetLink = before.links.find(
      (link) => link.assignmentId === assignmentA.assignmentId,
    )
    if (!targetLink) throw new Error('assignment-session fixture missing')
    await expectAppError(
      asInstructor.mutation(reopenAssignmentSessionRef, {
        assignmentSessionId: targetLink._id,
      }),
      AppErrorCode.CONFLICT,
    )
    await expectAppError(
      asInstructor.mutation(reviewAssignmentSessionRef, {
        assignmentSessionId: targetLink._id,
        instructorNote: 'Should not write against ambiguous links.',
      }),
      AppErrorCode.CONFLICT,
    )
    await expectAppError(
      asInstructor.query(listAssignmentSessionsRef, {
        assignmentId: assignmentA.assignmentId,
      }),
      AppErrorCode.CONFLICT,
    )
    await expectAppError(
      asInstructor.query(exportAssignmentCsvRef, {
        assignmentId: assignmentA.assignmentId,
      }),
      AppErrorCode.CONFLICT,
    )
    await expectAppError(
      asInstructor.query(getSessionReplayRef, { caseSessionId }),
      AppErrorCode.CONFLICT,
    )
    await expectAppError(
      asInstructor.query(getReviewContextRef, { caseSessionId }),
      AppErrorCode.CONFLICT,
    )
    expect(
      await t.run(async (ctx) => ({
        session: await ctx.db.get(caseSessionId),
        links: await ctx.db.query('assignmentSessions').collect(),
        events: await ctx.db
          .query('caseSessionEvents')
          .withIndex('by_case', (index) => index.eq('caseSessionId', caseSessionId))
          .collect(),
        audit: await ctx.db.query('auditLog').collect(),
      })),
    ).toEqual(before)
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

  it('enforces reservation expiry at each completion boundary', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-10-03T01:00:00.000Z'))
      const t = convexTest(schema, modules)
      const fixture = await seedIsolationFixture(t)
      const asDual = t.withIdentity(identity('dual'))
      const sessions = await Promise.all(
        Array.from({ length: 6 }, () =>
          asDual.mutation(createSessionRef, { institutionId: fixture.orgA }),
        ),
      )
      const sessionIds = sessions.map((session) => session.id as Id<'caseSessions'>)
      const reserve = async (sessionId: Id<'caseSessions'>, nowIso: string, actorId: string) => {
        vi.setSystemTime(new Date(nowIso))
        const result = await asDual.mutation(
          internal.caseSessions.reserveAiRunForCurrentUser,
          {
            caseSessionId: sessionId,
            actorId,
            model: 'fixture-model',
            promptHash: `fixture-${actorId}`,
            nowIso,
            cooldownMs: 0,
            estimatedCostCents: 1,
          },
        )
        if (!result.aiRunId) throw new Error(`reservation rejected: ${result.reason}`)
        return result.aiRunId
      }

      const finalizeEarly = await reserve(
        sessionIds[0]!,
        '2026-10-03T01:00:00.000Z',
        'finalize-early',
      )
      vi.setSystemTime(new Date('2026-10-03T01:04:59.999Z'))
      await asDual.mutation(internal.caseSessions.finalizeAiRunForCurrentUser, {
        aiRunId: finalizeEarly,
        actorId: 'fixture-actor',
        toolCallJson: '{}',
        accepted: true,
        issues: [],
        costCents: 1,
        latencyMs: 1,
      })
      expect(await t.run((ctx) => ctx.db.get(finalizeEarly))).toMatchObject({
        accepted: true,
        toolCallJson: '{}',
        costCents: 1,
      })
      expect((await t.run((ctx) => ctx.db.get(finalizeEarly)))?.errorClass).toBeUndefined()

      const finalizeExpired = await reserve(
        sessionIds[1]!,
        '2026-10-03T02:00:00.000Z',
        'finalize-expired',
      )
      const finalizeBefore = await t.run((ctx) => ctx.db.get(finalizeExpired))
      vi.setSystemTime(new Date('2026-10-03T02:05:00.000Z'))
      await expectAppError(
        asDual.mutation(internal.caseSessions.finalizeAiRunForCurrentUser, {
          aiRunId: finalizeExpired,
          actorId: 'fixture-actor',
          toolCallJson: '{}',
          accepted: true,
          issues: [],
          costCents: 1,
          latencyMs: 1,
        }),
        AppErrorCode.CONFLICT,
      )
      expect(await t.run((ctx) => ctx.db.get(finalizeExpired))).toEqual(finalizeBefore)

      const expectedToolCall = nextExpectedToolCall(createInitialSession())
      const applyEarly = await reserve(
        sessionIds[2]!,
        '2026-10-03T03:00:00.000Z',
        'apply-early',
      )
      vi.setSystemTime(new Date('2026-10-03T03:04:59.999Z'))
      const applied = await asDual.mutation(
        internal.caseSessions.applyLiveToolCallForCurrentUser,
        {
          caseSessionId: sessionIds[2]!,
          toolCall: expectedToolCall,
          model: 'fixture-model',
          rawText: JSON.stringify(expectedToolCall),
          latencyMs: 1,
          costCents: 1,
          createdAt: '2026-10-03T03:04:59.999Z',
          aiRunId: applyEarly,
        },
      )
      expect(applied.docketEntries.length).toBeGreaterThan(0)
      expect((await t.run((ctx) => ctx.db.get(applyEarly)))?.errorClass).toBeUndefined()

      const applyExpired = await reserve(
        sessionIds[3]!,
        '2026-10-03T04:00:00.000Z',
        'apply-expired',
      )
      const applyBefore = await t.run(async (ctx) => ({
        run: await ctx.db.get(applyExpired),
        session: await ctx.db.get(sessionIds[3]!),
        events: await ctx.db
          .query('caseSessionEvents')
          .withIndex('by_case', (index) => index.eq('caseSessionId', sessionIds[3]!))
          .collect(),
      }))
      vi.setSystemTime(new Date('2026-10-03T04:05:00.000Z'))
      await expectAppError(
        asDual.mutation(internal.caseSessions.applyLiveToolCallForCurrentUser, {
          caseSessionId: sessionIds[3]!,
          toolCall: expectedToolCall,
          model: 'fixture-model',
          rawText: JSON.stringify(expectedToolCall),
          latencyMs: 1,
          costCents: 1,
          createdAt: '2026-10-03T04:05:00.000Z',
          aiRunId: applyExpired,
        }),
        AppErrorCode.CONFLICT,
      )
      expect(
        await t.run(async (ctx) => ({
          run: await ctx.db.get(applyExpired),
          session: await ctx.db.get(sessionIds[3]!),
          events: await ctx.db
            .query('caseSessionEvents')
            .withIndex('by_case', (index) => index.eq('caseSessionId', sessionIds[3]!))
            .collect(),
        })),
      ).toEqual(applyBefore)

      const memoJson = JSON.stringify({
        title: 'Fixture bench memo',
        summary: 'Prepared before the reservation deadline.',
        reasoning: [],
        recommendations: [],
        citations: [],
        ruleRefs: [],
      })
      const persistEarly = await reserve(
        sessionIds[4]!,
        '2026-10-03T05:00:00.000Z',
        'persist-early',
      )
      vi.setSystemTime(new Date('2026-10-03T05:04:59.999Z'))
      await asDual.mutation(internal.caseSessions.persistActorWorkProductForCurrentUser, {
        caseSessionId: sessionIds[4]!,
        aiRunId: persistEarly,
        actorId: 'fixture-actor',
        kind: 'bench_memo',
        workProductJson: memoJson,
        sourceDocumentAnalysisIds: [],
        sourceFilingIds: [],
        validationIssues: [],
        createdAt: '2026-10-03T05:04:59.999Z',
        costCents: 1,
        latencyMs: 1,
      })
      expect((await t.run((ctx) => ctx.db.query('actorWorkProducts').collect())).length).toBe(1)
      expect((await t.run((ctx) => ctx.db.get(persistEarly)))?.errorClass).toBeUndefined()

      const persistExpired = await reserve(
        sessionIds[5]!,
        '2026-10-03T06:00:00.000Z',
        'persist-expired',
      )
      const persistBefore = await t.run(async (ctx) => ({
        run: await ctx.db.get(persistExpired),
        products: await ctx.db.query('actorWorkProducts').collect(),
      }))
      vi.setSystemTime(new Date('2026-10-03T06:05:00.000Z'))
      await expectAppError(
        asDual.mutation(internal.caseSessions.persistActorWorkProductForCurrentUser, {
          caseSessionId: sessionIds[5]!,
          aiRunId: persistExpired,
          actorId: 'fixture-actor',
          kind: 'bench_memo',
          workProductJson: memoJson,
          sourceDocumentAnalysisIds: [],
          sourceFilingIds: [],
          validationIssues: [],
          createdAt: '2026-10-03T06:05:00.000Z',
          costCents: 1,
          latencyMs: 1,
        }),
        AppErrorCode.CONFLICT,
      )
      expect(
        await t.run(async (ctx) => ({
          run: await ctx.db.get(persistExpired),
          products: await ctx.db.query('actorWorkProducts').collect(),
        })),
      ).toEqual(persistBefore)
    } finally {
      vi.useRealTimers()
    }
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
