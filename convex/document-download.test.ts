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

import { convexTest } from 'convex-test'
import type { TestConvex } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import schema from './schema'

const chunkBytes = 4 * 1024 * 1024
const maxDocumentBytes = 25 * 1024 * 1024
const appOrigin = 'https://app.example.test'

const modules = {
  './_generated/api.ts': () => import('./_generated/api'),
  './_generated/server.ts': () => import('./_generated/server'),
  './assignments.ts': () => import('./assignments'),
  './authHelpers.ts': () => import('./authHelpers'),
  './authz.ts': () => import('./authz'),
  './caseSessionEventLog.ts': () => import('./caseSessionEventLog'),
  './caseSessions.ts': () => import('./caseSessions'),
  './documentDownloads.ts': () => import('./documentDownloads'),
  './documentUploadActions.ts': () => import('./documentUploadActions'),
  './documentUploads.ts': () => import('./documentUploads'),
  './errors.ts': () => import('./errors'),
  './http.ts': () => import('./http'),
  './organizationContracts.ts': () => import('./organizationContracts'),
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

function makePdf(sizeBytes: number) {
  const bytes = new Uint8Array(sizeBytes)
  bytes.set(new TextEncoder().encode('%PDF-').subarray(0, sizeBytes))
  return bytes
}

async function seedFixture(t: TestConvex<typeof schema>, bytes = makePdf(16)) {
  return t.run(async (ctx) => {
    const createdAt = new Date().toISOString()
    const ownerUserId = await ctx.db.insert('users', {
      authSubject: identity('owner').tokenIdentifier,
      displayName: 'Owner',
      monthlyAiBudgetCents: 0,
    })
    const teacherUserId = await ctx.db.insert('users', {
      authSubject: identity('teacher').tokenIdentifier,
      displayName: 'Teacher',
      monthlyAiBudgetCents: 0,
    })
    const learnerUserId = await ctx.db.insert('users', {
      authSubject: identity('learner').tokenIdentifier,
      displayName: 'Learner',
      monthlyAiBudgetCents: 0,
    })
    const unassignedInstructorUserId = await ctx.db.insert('users', {
      authSubject: identity('unassigned').tokenIdentifier,
      displayName: 'Unassigned instructor',
      monthlyAiBudgetCents: 0,
    })
    const institutionId = await ctx.db.insert('institutions', {
      kind: 'shared',
      createdAt,
      name: 'Download fixture organization',
      slug: 'download-fixture',
      status: 'active',
      monthlyAiBudgetCents: 0,
    })
    const ownerMembershipId = await ctx.db.insert('institutionMemberships', {
      institutionId,
      userId: ownerUserId,
      role: 'learner',
      status: 'active',
      createdAt,
    })
    const teacherMembershipId = await ctx.db.insert('institutionMemberships', {
      institutionId,
      userId: teacherUserId,
      role: 'instructor',
      status: 'active',
      createdAt,
    })
    await ctx.db.insert('institutionMemberships', {
      institutionId,
      userId: learnerUserId,
      role: 'learner',
      status: 'active',
      createdAt,
    })
    await ctx.db.insert('institutionMemberships', {
      institutionId,
      userId: unassignedInstructorUserId,
      role: 'instructor',
      status: 'active',
      createdAt,
    })
    const scenarioId = await ctx.db.insert('scenarios', {
      scenarioKey: 'document-download-fixture',
      visibility: 'public_template',
      revisionStatus: 'published',
      title: 'Download fixture',
      source: 'synthetic',
      courtPackId: 'us-federal-ca4-civil-appeal',
      shortCaption: 'Fixture v. Test',
      lowerTribunal: 'Fixture court',
      natureOfSuit: 'civil',
      proceduralPosture: 'appeal',
      issuesPresented: [],
      meritsRecord: [],
      published: true,
    })
    const ownerSessionId = await ctx.db.insert('caseSessions', {
      institutionId,
      scenarioId,
      userId: ownerUserId,
      courtPackId: 'us-federal-ca4-civil-appeal',
      status: 'active',
      simulatedDate: createdAt,
    })
    const cohortId = await ctx.db.insert('cohorts', {
      institutionId,
      title: 'Download cohort',
      term: 'Fall',
      startsAt: createdAt,
      endsAt: '2099-12-31T00:00:00.000Z',
      archived: false,
    })
    await ctx.db.insert('cohortMemberships', {
      cohortId,
      userId: learnerUserId,
    })
    const assignmentId = await ctx.db.insert('assignments', {
      cohortId,
      scenarioId,
      title: 'Explicit review assignment',
      published: true,
      createdByUserId: teacherUserId,
      createdAt,
    })
    const assignmentSessionId = await ctx.db.insert('assignmentSessions', {
      assignmentId,
      caseSessionId: ownerSessionId,
      userId: ownerUserId,
    })
    const storageId = await ctx.storage.store(
      new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }),
    )
    const documentId = await ctx.db.insert('documents', {
      caseSessionId: ownerSessionId,
      storageId,
      fileName: 'private/appeal\r\n-review.pdf',
      mimeType: 'application/pdf',
      sizeBytes: bytes.byteLength,
      extractedSignals: [],
    })
    return {
      ownerUserId,
      teacherUserId,
      learnerUserId,
      unassignedInstructorUserId,
      ownerMembershipId,
      teacherMembershipId,
      institutionId,
      scenarioId,
      ownerSessionId,
      cohortId,
      assignmentId,
      assignmentSessionId,
      storageId,
      documentId,
    }
  })
}

function getClient(t: TestConvex<typeof schema>, subject: string) {
  return t.withIdentity(identity(subject))
}

function getChunk(
  client: Pick<TestConvex<typeof schema>, 'fetch'>,
  documentId: string,
  chunk: number | string,
  options: { origin?: string; includeAuth?: boolean } = {},
) {
  const headers = new Headers()
  if (options.includeAuth !== false) {
    headers.set('Authorization', 'Bearer ephemeral-test-token')
  }
  if (options.origin) headers.set('Origin', options.origin)
  return client.fetch(
    `/documents/content?documentId=${encodeURIComponent(documentId)}&chunk=${chunk}`,
    { method: 'GET', headers },
  )
}

describe('registered private document download route', () => {
  beforeEach(() => {
    vi.stubEnv('DOCUMENT_ALLOWED_ORIGINS', appOrigin)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('serves bounded slices with safe headers and rechecks membership between chunks', async () => {
    const bytes = makePdf(chunkBytes + 1)
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t, bytes)
    const owner = getClient(t, 'owner')

    const first = await getChunk(owner, fixture.documentId, 0, {
      origin: appOrigin,
    })
    expect(first.status).toBe(200)
    expect(first.headers.get('Cache-Control')).toBe('no-store')
    expect(first.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(first.headers.get('Access-Control-Allow-Origin')).toBe(appOrigin)
    expect(first.headers.get('Access-Control-Allow-Methods')).toBe(
      'GET, OPTIONS',
    )
    expect(first.headers.get('Access-Control-Expose-Headers')).toContain(
      'X-Document-Size',
    )
    expect(first.headers.get('X-Document-Size')).toBe(String(bytes.byteLength))
    expect(first.headers.get('Content-Length')).toBe(String(chunkBytes))
    expect(first.headers.get('Content-Type')).toBe('application/pdf')
    expect(first.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename=".*"; filename\*=UTF-8''/,
    )
    expect(first.headers.get('Content-Disposition')).not.toContain('/')
    expect(first.headers.get('Content-Disposition')).not.toContain('\r')
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(
      bytes.subarray(0, chunkBytes),
    )

    await t.run((ctx) =>
      ctx.db.patch(fixture.ownerMembershipId, { status: 'suspended' }),
    )
    const second = await getChunk(owner, fixture.documentId, 1, {
      origin: appOrigin,
    })
    expect(second.status).toBe(404)
    expect(second.headers.get('Cache-Control')).toBe('no-store')
    expect(second.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(second.headers.get('Access-Control-Allow-Origin')).toBe(appOrigin)
    expect(await second.text()).not.toContain(String(fixture.storageId))
  }, 30_000)

  it('allows an active explicit instructor assignment and denies archived or unlinked assignments', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const teacher = getClient(t, 'teacher')
    const assigned = await getChunk(teacher, fixture.documentId, 0, {
      origin: appOrigin,
    })
    expect(assigned.status).toBe(200)
    expect(assigned.headers.get('Cache-Control')).toBe('no-store')

    await t.run((ctx) =>
      ctx.db.patch(fixture.assignmentId, {
        archivedAt: new Date().toISOString(),
      }),
    )
    const archived = await getChunk(teacher, fixture.documentId, 0, {
      origin: appOrigin,
    })
    expect(archived.status).toBe(404)
    expect(archived.headers.get('Cache-Control')).toBe('no-store')
    expect(archived.headers.get('X-Content-Type-Options')).toBe('nosniff')
    const ownerStillAllowed = await getChunk(
      getClient(t, 'owner'),
      fixture.documentId,
      0,
      { origin: appOrigin },
    )
    expect(ownerStillAllowed.status).toBe(200)

    await t.run((ctx) =>
      ctx.db.patch(fixture.assignmentId, { archivedAt: undefined }),
    )

    const standaloneDocument = await t.run(async (ctx) => {
      const standaloneSessionId = await ctx.db.insert('caseSessions', {
        institutionId: fixture.institutionId,
        scenarioId: fixture.scenarioId,
        userId: fixture.learnerUserId,
        courtPackId: 'us-federal-ca4-civil-appeal',
        status: 'active',
        simulatedDate: new Date().toISOString(),
      })
      return ctx.db.insert('documents', {
        caseSessionId: standaloneSessionId,
        storageId: fixture.storageId,
        fileName: 'standalone.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 16,
        extractedSignals: [],
      })
    })
    const unassigned = getClient(t, 'unassigned')
    const denied = await getChunk(unassigned, standaloneDocument, 0, {
      origin: appOrigin,
    })
    expect(denied.status).toBe(404)
    expect(denied.headers.get('Cache-Control')).toBe('no-store')
    expect(denied.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(await denied.text()).not.toContain(String(fixture.documentId))

    const learner = getClient(t, 'learner')
    const wrongRole = await getChunk(learner, fixture.documentId, 0, {
      origin: appOrigin,
    })
    expect(wrongRole.status).toBe(403)
    expect(wrongRole.headers.get('Cache-Control')).toBe('no-store')
    expect(wrongRole.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('keeps personal workspace sessions owner-only despite an instructor membership and assignment row', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    await t.run((ctx) =>
      ctx.db.patch(fixture.institutionId, {
        kind: 'personal',
        personalOwnerUserId: fixture.ownerUserId,
      }),
    )

    const owner = await getChunk(getClient(t, 'owner'), fixture.documentId, 0)
    expect(owner.status).toBe(200)

    const instructor = await getChunk(
      getClient(t, 'teacher'),
      fixture.documentId,
      0,
    )
    expect(instructor.status).toBe(404)
    expect(instructor.headers.get('Cache-Control')).toBe('no-store')
    expect(instructor.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('rechecks owner membership when it is revoked during the storage read', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const originalArrayBuffer = Blob.prototype.arrayBuffer
    let revokedDuringRead = false
    const storageRead = vi
      .spyOn(Blob.prototype, 'arrayBuffer')
      .mockImplementation(async function (this: Blob) {
        if (!revokedDuringRead) {
          revokedDuringRead = true
          await t.run((ctx) =>
            ctx.db.patch(fixture.ownerMembershipId, { status: 'suspended' }),
          )
        }
        return originalArrayBuffer.call(this)
      })

    let response: Response
    try {
      response = await getChunk(getClient(t, 'owner'), fixture.documentId, 0, {
        origin: appOrigin,
      })
    } finally {
      storageRead.mockRestore()
    }

    expect(revokedDuringRead).toBe(true)
    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(appOrigin)
    expect(await response.text()).not.toContain(String(fixture.storageId))
  }, 30_000)

  it('denies foreign documents, inactive organizations, and expired owner or instructor membership', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const foreign = await t.run(async (ctx) => {
      const createdAt = new Date().toISOString()
      const userId = await ctx.db.insert('users', {
        authSubject: identity('foreign').tokenIdentifier,
        displayName: 'Foreign owner',
        monthlyAiBudgetCents: 0,
      })
      const foreignInstitutionId = await ctx.db.insert('institutions', {
        kind: 'shared',
        createdAt,
        name: 'Foreign organization',
        slug: 'foreign-download-fixture',
        status: 'active',
        monthlyAiBudgetCents: 0,
      })
      await ctx.db.insert('institutionMemberships', {
        institutionId: foreignInstitutionId,
        userId,
        role: 'learner',
        status: 'active',
        createdAt,
      })
      const sessionId = await ctx.db.insert('caseSessions', {
        institutionId: foreignInstitutionId,
        scenarioId: fixture.scenarioId,
        userId,
        courtPackId: 'us-federal-ca4-civil-appeal',
        status: 'active',
        simulatedDate: createdAt,
      })
      const documentId = await ctx.db.insert('documents', {
        caseSessionId: sessionId,
        storageId: fixture.storageId,
        fileName: 'foreign.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 16,
        extractedSignals: [],
      })
      return documentId
    })
    const owner = getClient(t, 'owner')
    const foreignResponse = await getChunk(owner, foreign, 0, {
      origin: appOrigin,
    })
    expect(foreignResponse.status).toBe(404)
    expect(foreignResponse.headers.get('Cache-Control')).toBe('no-store')

    await t.run((ctx) =>
      ctx.db.patch(fixture.institutionId, { status: 'paused' }),
    )
    const inactiveOrganization = await getChunk(owner, fixture.documentId, 0, {
      origin: appOrigin,
    })
    expect(inactiveOrganization.status).toBe(404)
    expect(inactiveOrganization.headers.get('Cache-Control')).toBe('no-store')

    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.institutionId, { status: 'active' })
      await ctx.db.patch(fixture.ownerMembershipId, {
        status: 'active',
        expiresAt: '2000-01-01T00:00:00.000Z',
      })
    })
    const expiredOwner = await getChunk(owner, fixture.documentId, 0, {
      origin: appOrigin,
    })
    expect(expiredOwner.status).toBe(404)
    expect(expiredOwner.headers.get('Cache-Control')).toBe('no-store')

    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.ownerMembershipId, {
        status: 'active',
        expiresAt: undefined,
      })
      await ctx.db.patch(fixture.teacherMembershipId, {
        status: 'active',
        expiresAt: '2000-01-01T00:00:00.000Z',
      })
    })
    const teacher = getClient(t, 'teacher')
    const expiredInstructor = await getChunk(teacher, fixture.documentId, 0, {
      origin: appOrigin,
    })
    expect(expiredInstructor.status).toBe(404)
    expect(expiredInstructor.headers.get('Cache-Control')).toBe('no-store')
  })

  it('returns auth, invalid-chunk, and oversize statuses with no-store and no identifiers', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const unauthenticated = await getChunk(t, fixture.documentId, 0, {
      origin: appOrigin,
      includeAuth: false,
    })
    expect(unauthenticated.status).toBe(401)
    expect(unauthenticated.headers.get('Cache-Control')).toBe('no-store')
    expect(unauthenticated.headers.get('Access-Control-Allow-Origin')).toBe(
      appOrigin,
    )

    const owner = getClient(t, 'owner')
    const invalid = await getChunk(owner, fixture.documentId, 1, {
      origin: appOrigin,
    })
    expect(invalid.status).toBe(422)
    expect(invalid.headers.get('Cache-Control')).toBe('no-store')
    expect(await invalid.text()).not.toContain(String(fixture.storageId))

    const oversize = await t.run(async (ctx) =>
      ctx.db.insert('documents', {
        caseSessionId: fixture.ownerSessionId,
        storageId: fixture.storageId,
        fileName: 'too-large.pdf',
        mimeType: 'application/pdf',
        sizeBytes: maxDocumentBytes + 1,
        extractedSignals: [],
      }),
    )
    const tooLarge = await getChunk(owner, oversize, 0, {
      origin: appOrigin,
    })
    expect(tooLarge.status).toBe(413)
    expect(tooLarge.headers.get('Cache-Control')).toBe('no-store')
    expect(await tooLarge.text()).not.toContain(String(fixture.storageId))
  })

  it('serves the exact 25 MiB maximum in 4 MiB chunks and rejects one byte over', async () => {
    const bytes = makePdf(maxDocumentBytes)
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t, bytes)
    const owner = getClient(t, 'owner')

    const first = await getChunk(owner, fixture.documentId, 0)
    expect(first.status).toBe(200)
    expect(first.headers.get('Content-Length')).toBe(String(chunkBytes))
    expect(first.headers.get('X-Document-Size')).toBe(String(maxDocumentBytes))
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(
      bytes.subarray(0, chunkBytes),
    )
    const last = await getChunk(owner, fixture.documentId, 6)
    expect(last.status).toBe(200)
    expect(last.headers.get('Content-Length')).toBe(String(1024 * 1024))
    expect(new Uint8Array(await last.arrayBuffer())).toEqual(
      bytes.subarray(24 * 1024 * 1024),
    )

    const oneByteOver = await t.run(async (ctx) =>
      ctx.db.insert('documents', {
        caseSessionId: fixture.ownerSessionId,
        storageId: fixture.storageId,
        fileName: 'one-byte-over.pdf',
        mimeType: 'application/pdf',
        sizeBytes: maxDocumentBytes + 1,
        extractedSignals: [],
      }),
    )
    const tooLarge = await getChunk(owner, oneByteOver, 0)
    expect(tooLarge.status).toBe(413)
    expect(tooLarge.headers.get('Cache-Control')).toBe('no-store')
  }, 30_000)

  it('enforces exact-origin CORS independently of authentication', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const owner = getClient(t, 'owner')

    const preflight = await owner.fetch('/documents/content', {
      method: 'OPTIONS',
      headers: {
        Origin: appOrigin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(appOrigin)
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toBe(
      'GET, OPTIONS',
    )
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toBe(
      'Authorization',
    )
    expect(preflight.headers.get('Access-Control-Allow-Credentials')).toBeNull()
    expect(preflight.headers.get('Cache-Control')).toBe('no-store')

    const disallowed = await getChunk(owner, fixture.documentId, 0, {
      origin: 'https://attacker.example.test',
    })
    expect(disallowed.status).toBe(403)
    expect(disallowed.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(disallowed.headers.get('Cache-Control')).toBe('no-store')
  })

  it('rejects inconsistent duplicate assignment links before serving instructor content', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    await t.run((ctx) =>
      ctx.db.insert('assignmentSessions', {
        assignmentId: fixture.assignmentId,
        caseSessionId: fixture.ownerSessionId,
        userId: fixture.ownerUserId,
      }),
    )
    const teacher = getClient(t, 'teacher')
    const response = await getChunk(teacher, fixture.documentId, 0, {
      origin: appOrigin,
    })
    expect(response.status).toBe(409)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('keeps storage handles and URLs out of successful HTTP responses', async () => {
    const t = convexTest(schema, modules)
    const fixture = await seedFixture(t)
    const owner = getClient(t, 'owner')
    const response = await getChunk(owner, fixture.documentId, 0, {
      origin: appOrigin,
    })
    expect(response.status).toBe(200)
    expect([...response.headers.keys()]).not.toContain('location')
    expect(
      [...response.headers.keys()].some((key) => /storage.?id/i.test(key)),
    ).toBe(false)
    const bytes = new TextDecoder().decode(await response.arrayBuffer())
    expect(bytes).not.toContain(String(fixture.storageId))
    expect(bytes).not.toContain('storage.getUrl')
  })
})
