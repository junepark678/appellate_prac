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
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { AppErrorCode } from './errors'
import schema from './schema'
import type { CaseSession, TrialDocket } from '../src/domain/types'
import type { CourtListenerSearchResult } from '../src/integrations/courtlistener'
import { searchCourtListenerDockets } from '../src/integrations/courtlistener'

vi.mock('../src/integrations/courtlistener', () => ({
  searchCourtListenerDockets: vi.fn(),
}))

const modules = {
  './_generated/api.ts': () => import('./_generated/api'),
  './_generated/server.ts': () => import('./_generated/server'),
  './authHelpers.ts': () => import('./authHelpers'),
  './authz.ts': () => import('./authz'),
  './caseSessionEventLog.ts': () => import('./caseSessionEventLog'),
  './caseSessions.ts': () => import('./caseSessions'),
  './errors.ts': () => import('./errors'),
  './integrations.ts': () => import('./integrations'),
  './organizationContracts.ts': () => import('./organizationContracts'),
  './organizations.ts': () => import('./organizations'),
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

const searchRef = makeFunctionReference<
  'action',
  { institutionId: Id<'institutions'>; query: string },
  CourtListenerSearchResult[]
>('integrations:searchLiveCourtListenerDockets')
const createSessionRef = makeFunctionReference<
  'mutation',
  { institutionId: Id<'institutions'> },
  CaseSession
>('caseSessions:create')
const importCourtListenerSourceRef = makeFunctionReference<
  'mutation',
  { caseSessionId: Id<'caseSessions'>; result: CourtListenerSearchResult },
  { session: CaseSession; trialDocket: TrialDocket }
>('caseSessions:importCourtListenerSource')
const getTrialDocketRef = makeFunctionReference<
  'query',
  { caseSessionId: Id<'caseSessions'> },
  TrialDocket | null
>('caseSessions:getTrialDocketForCurrentUser')

const metadataNotice = 'Caller-reported metadata; not verified court evidence.'
const testNow = '2026-10-04T12:00:00.000Z'

type Fixture = {
  alice: Id<'users'>
  bob: Id<'users'>
  organizationA: Id<'institutions'>
  organizationB: Id<'institutions'>
  foreignOrganization: Id<'institutions'>
  aliceMembershipA: Id<'institutionMemberships'>
}

async function seedFixture(t: TestConvex<typeof schema>): Promise<Fixture> {
  return t.run(async (ctx) => {
    const alice = await ctx.db.insert('users', {
      authSubject: identity('alice').tokenIdentifier,
      displayName: 'Alice',
      monthlyAiBudgetCents: 0,
    })
    const bob = await ctx.db.insert('users', {
      authSubject: identity('bob').tokenIdentifier,
      displayName: 'Bob',
      monthlyAiBudgetCents: 0,
    })
    const organizationA = await ctx.db.insert('institutions', {
      kind: 'shared',
      createdAt: testNow,
      name: 'Organization A',
      slug: 'organization-a',
      status: 'active',
      monthlyAiBudgetCents: 0,
    })
    const organizationB = await ctx.db.insert('institutions', {
      kind: 'shared',
      createdAt: testNow,
      name: 'Organization B',
      slug: 'organization-b',
      status: 'active',
      monthlyAiBudgetCents: 0,
    })
    const foreignOrganization = await ctx.db.insert('institutions', {
      kind: 'shared',
      createdAt: testNow,
      name: 'Foreign Organization',
      slug: 'foreign-organization',
      status: 'active',
      monthlyAiBudgetCents: 0,
    })
    const aliceMembershipA = await ctx.db.insert('institutionMemberships', {
      institutionId: organizationA,
      userId: alice,
      role: 'learner',
      status: 'active',
      createdAt: testNow,
    })
    await ctx.db.insert('institutionMemberships', {
      institutionId: organizationB,
      userId: alice,
      role: 'learner',
      status: 'active',
      createdAt: testNow,
    })
    await ctx.db.insert('institutionMemberships', {
      institutionId: organizationB,
      userId: bob,
      role: 'learner',
      status: 'active',
      createdAt: testNow,
    })
    return {
      alice,
      bob,
      organizationA,
      organizationB,
      foreignOrganization,
      aliceMembershipA,
    }
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
  return caught
}

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe('organization isolation for integrations', () => {
  it('rejects a foreign organization before the provider request and keeps legacy events private', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const asAlice = t.withIdentity(identity('alice'))

    await t.run(async (ctx) => {
      await ctx.db.insert('integrationEvents', {
        institutionId: fixture.organizationB,
        userId: fixture.bob,
        provider: 'courtlistener',
        action: 'other-users-org-event',
        accepted: true,
        createdAt: testNow,
      })
      await ctx.db.insert('integrationEvents', {
        userId: fixture.bob,
        provider: 'courtlistener',
        action: 'legacy-unscoped-event',
        accepted: true,
        createdAt: testNow,
      })
    })

    const cooldown = await asAlice.query(
      internal.integrations.getIntegrationCooldownForCurrentUser,
      {
        institutionId: fixture.organizationA,
        provider: 'courtlistener',
        cooldownMs: 5_000,
        nowIso: testNow,
      },
    )
    expect(cooldown).toEqual({ allowed: true })
    expect(Object.keys(cooldown)).toEqual(['allowed'])

    await expectAppError(
      asAlice.action(searchRef, {
        institutionId: fixture.foreignOrganization,
        query: 'example docket',
      }),
      AppErrorCode.NOT_FOUND,
    )
    expect(searchCourtListenerDockets).not.toHaveBeenCalled()
    expect(
      await t.run((ctx) => ctx.db.query('integrationEvents').collect()),
    ).toHaveLength(2)
  })

  it('records trusted organization scope, labels result JSON, and preserves the per-user cooldown and result cap', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    vi.stubEnv('COURTLISTENER_TOKEN', 'mock-provider-token')
    vi.mocked(searchCourtListenerDockets).mockResolvedValueOnce(
      Array.from({ length: 25 }, (_, index) => ({
        id: index + 1,
        caseName: `Fixture docket ${index + 1}`,
        snippet: 'Provider result text.',
      })),
    )

    const asAlice = t.withIdentity(identity('alice'))
    const results = await asAlice.action(searchRef, {
      institutionId: fixture.organizationA,
      query: 'fixture docket',
    })

    expect(searchCourtListenerDockets).toHaveBeenCalledTimes(1)
    expect(results).toHaveLength(20)
    expect(results[0]?.snippet).toContain(metadataNotice)
    expect(results[0]?.snippet).toContain('Provider result text.')

    const events = await t.run((ctx) =>
      ctx.db.query('integrationEvents').collect(),
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      institutionId: fixture.organizationA,
      userId: fixture.alice,
      provider: 'courtlistener',
      action: 'searchLiveCourtListenerDockets',
      scopeProvenance: 'active_membership_v1',
      accepted: true,
    })

    const aliceSession = await asAlice.mutation(createSessionRef, {
      institutionId: fixture.organizationA,
    })
    const importedSearchResult = await asAlice.mutation(
      importCourtListenerSourceRef,
      {
        caseSessionId: aliceSession.id as Id<'caseSessions'>,
        result: results[0]!,
      },
    )
    const importedSearchText =
      importedSearchResult.trialDocket.entries[0]?.text ?? ''
    expect(importedSearchText.split(metadataNotice)).toHaveLength(2)
    expect(
      importedSearchResult.session.docketEntries
        .at(-1)
        ?.text?.split(metadataNotice),
    ).toHaveLength(2)
    const persistedSearchDocket = await asAlice.query(getTrialDocketRef, {
      caseSessionId: aliceSession.id as Id<'caseSessions'>,
    })
    expect(
      persistedSearchDocket?.entries[0]?.text.split(metadataNotice),
    ).toHaveLength(2)

    await expect(
      asAlice.action(searchRef, {
        institutionId: fixture.organizationB,
        query: 'same-user another org',
      }),
    ).rejects.toThrow('CourtListener cooldown is still active.')
    expect(searchCourtListenerDockets).toHaveBeenCalledTimes(1)
  })

  it('rejects a result if organization membership is revoked during provider I/O', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    vi.stubEnv('COURTLISTENER_TOKEN', 'mock-provider-token')

    let finishProvider!: (results: CourtListenerSearchResult[]) => void
    let signalProviderStarted!: () => void
    const providerStarted = new Promise<void>((resolve) => {
      signalProviderStarted = resolve
    })
    const providerResults = new Promise<CourtListenerSearchResult[]>(
      (resolve) => {
        finishProvider = resolve
      },
    )
    vi.mocked(searchCourtListenerDockets).mockImplementationOnce(async () => {
      signalProviderStarted()
      return providerResults
    })

    const actionPromise = t.withIdentity(identity('alice')).action(searchRef, {
      institutionId: fixture.organizationA,
      query: 'revocation race',
    })
    await providerStarted
    await t.run((ctx) =>
      ctx.db.patch(fixture.aliceMembershipA, { status: 'suspended' }),
    )
    finishProvider([{ id: 41, caseName: 'Must not be returned' }])

    await expectAppError(actionPromise, AppErrorCode.NOT_FOUND)
    const events = await t.run((ctx) =>
      ctx.db.query('integrationEvents').collect(),
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      institutionId: fixture.organizationA,
      userId: fixture.alice,
      accepted: false,
      errorClass: 'in_flight',
    })
  })

  it('does not let a caller choose the sessionless search scope provenance marker', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    vi.stubEnv('COURTLISTENER_TOKEN', 'mock-provider-token')
    const argsWithCallerMarker = {
      institutionId: fixture.organizationA,
      query: 'caller marker test',
      scopeProvenance: 'forged_marker',
    } as { institutionId: Id<'institutions'>; query: string }
    await expect(
      t.withIdentity(identity('alice')).action(searchRef, argsWithCallerMarker),
    ).rejects.toThrow('Unexpected field `scopeProvenance` in object')
    await expect(
      t
        .withIdentity(identity('alice'))
        .mutation(internal.integrations.reserveIntegrationEventForCurrentUser, {
          institutionId: fixture.organizationA,
          provider: 'courtlistener',
          action: 'searchLiveCourtListenerDockets',
          cooldownMs: 5_000,
          nowIso: testNow,
          scopeProvenance: 'forged_marker',
        } as never),
    ).rejects.toThrow('Unexpected field `scopeProvenance` in object')

    const events = await t.run((ctx) =>
      ctx.db.query('integrationEvents').collect(),
    )
    expect(events).toHaveLength(0)
    expect(searchCourtListenerDockets).not.toHaveBeenCalled()
  })

  it('imports only into an owned session and keeps source provenance off the shared scenario', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const asAlice = t.withIdentity(identity('alice'))
    const asBob = t.withIdentity(identity('bob'))
    const aliceSession = await asAlice.mutation(createSessionRef, {
      institutionId: fixture.organizationA,
    })
    const bobSession = await asBob.mutation(createSessionRef, {
      institutionId: fixture.organizationB,
    })
    const aliceSessionId = aliceSession.id as Id<'caseSessions'>
    const bobSessionId = bobSession.id as Id<'caseSessions'>
    const scenarioBefore = await t.run(async (ctx) => {
      const session = await ctx.db.get(aliceSessionId)
      return session ? ctx.db.get(session.scenarioId) : null
    })
    const result: CourtListenerSearchResult = {
      id: 51,
      docket_id: 51,
      caseName: 'Fixture v. Fixture',
      snippet: 'Imported caller text.',
    }

    const importedDirectResult = await asAlice.mutation(
      importCourtListenerSourceRef,
      {
        caseSessionId: aliceSessionId,
        result,
      },
    )
    expect(importedDirectResult.trialDocket.entries[0]?.text).toContain(
      metadataNotice,
    )
    expect(
      importedDirectResult.trialDocket.entries[0]?.text.split(metadataNotice),
    ).toHaveLength(2)
    expect(importedDirectResult.session.docketEntries.at(-1)?.text).toContain(
      metadataNotice,
    )
    const persistedDocket = await asAlice.query(getTrialDocketRef, {
      caseSessionId: aliceSessionId,
    })
    expect(persistedDocket?.entries[0]?.text).toContain(metadataNotice)

    await expectAppError(
      asAlice.mutation(importCourtListenerSourceRef, {
        caseSessionId: bobSessionId,
        result,
      }),
      AppErrorCode.NOT_FOUND,
    )

    const after = await t.run(async (ctx) => {
      const sourceCases = await ctx.db.query('sourceCases').collect()
      const trialDocketImports = await ctx.db
        .query('trialDocketImports')
        .collect()
      const scenario = scenarioBefore
        ? await ctx.db.get(scenarioBefore._id)
        : null
      return { sourceCases, trialDocketImports, scenario }
    })
    expect(after.sourceCases).toHaveLength(1)
    expect(after.trialDocketImports).toHaveLength(1)
    expect(after.sourceCases[0]).toMatchObject({
      caseSessionId: aliceSessionId,
      scenarioId: scenarioBefore?._id,
    })
    expect(
      JSON.parse(after.sourceCases[0]?.provenanceJson ?? '{}'),
    ).toMatchObject({
      id: 51,
      docket_id: 51,
      caseName: 'Fixture v. Fixture',
      snippet: 'Imported caller text.',
      evidenceStatus: 'caller_reported_metadata',
      evidenceNotice: metadataNotice,
    })
    const persistedEntries = JSON.parse(
      after.trialDocketImports[0]?.entriesJson ?? '[]',
    ) as Array<{
      text: string
    }>
    expect(persistedEntries[0]?.text).toContain(metadataNotice)
    expect(persistedEntries[0]?.text.split(metadataNotice)).toHaveLength(2)
    expect(after.scenario).toEqual(scenarioBefore)
  })
})
