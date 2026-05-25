import { describe, expect, it } from 'vitest'

import { courtPacks } from '../packs'
import { ca4CourtSourceVersions } from './ca4-source-profile'
import { evaluateReleaseGate, sourceFreshnessStatuses } from './source-governance'

describe('source governance release gate', () => {
  it('accepts the bundled CA4 beta sources when hashes are fetched and published', () => {
    const result = evaluateReleaseGate({ mode: 'beta' })

    expect(result.pass).toBe(true)
    expect(result.issues).toEqual([])
    expect(result.sourceStatuses.every((status) => status.published)).toBe(true)
    expect(result.sourceStatuses.every((status) => !status.stale)).toBe(true)
  })

  it('reports source freshness with current vs bundled hashes', () => {
    const [source] = ca4CourtSourceVersions
    const statuses = sourceFreshnessStatuses(ca4CourtSourceVersions, [
      {
        sourceVersionId: source.sourceVersionId,
        contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        fetchedAt: '2026-05-25T00:00:00.000Z',
        reviewStatus: 'published',
      },
    ])

    expect(statuses[0]?.fetchedHash).toBe('sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(statuses[0]?.bundledHash).toBe(source.contentHash)
    expect(statuses[0]?.stale).toBe(true)
    expect(statuses[0]?.staleReason).toContain('differs')
  })

  it('rejects active court packs that reference stale manual source hashes', () => {
    const [source, ...rest] = ca4CourtSourceVersions
    const result = evaluateReleaseGate({
      mode: 'beta',
      sourceVersions: [
        {
          ...source,
          contentHash: 'manual-frap-2025-12-01',
        },
        ...rest,
      ],
    })

    expect(result.pass).toBe(false)
    expect(result.issues.join('\n')).toContain('not a fetched sha256 hash')
  })

  it('blocks production release until court pack status, eval, and env evidence are present', () => {
    const result = evaluateReleaseGate({
      mode: 'production',
      env: {},
    })

    expect(result.pass).toBe(false)
    expect(result.issues.join('\n')).toContain('production_approved')
    expect(result.issues.join('\n')).toContain('latest simulation eval run')
    expect(result.issues.join('\n')).toContain('CLERK_PUBLISHABLE_KEY')
  })

  it('passes production when approval, eval thresholds, env, and sources are satisfied', () => {
    const result = evaluateReleaseGate({
      mode: 'production',
      courtPacks: courtPacks.map((pack) =>
        pack.id === 'us-federal-ca4-civil-appeal'
          ? { ...pack, releaseStatus: 'production_approved' as const }
          : pack,
      ),
      latestEval: {
        createdAt: '2026-05-25T00:00:00.000Z',
        criticalFailureCount: 0,
        validTurnRate: 0.99,
        hallucinatedSourceRate: 0,
        roleAuthorityFailureRate: 0,
        pass: true,
      },
      env: {
        CLERK_PUBLISHABLE_KEY: 'pk_live_test',
        CLERK_SECRET_KEY: 'sk_live_test',
        CLERK_AUTHORIZED_PARTIES: 'https://example.edu',
        VITE_CONVEX_URL: 'https://example.convex.cloud',
        CONVEX_DEPLOY_KEY: 'deploy-key',
        OPENROUTER_API_KEY: 'openrouter-key',
        OPENROUTER_MODEL: 'model',
      },
    })

    expect(result.pass).toBe(true)
  })
})
