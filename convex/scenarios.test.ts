import { describe, expect, it } from 'vitest'

import scenarioSeed from '../src/domain/scenarios.seed.json'

describe('seed scenario assets', () => {
  it('does not expose bundled synthetic trial-record PDFs as public static URLs', () => {
    for (const scenario of scenarioSeed) {
      for (const asset of scenario.documentAssets ?? []) {
        const assetWithLegacyUrls = asset as { fileUrl?: string; publicUrl?: string }
        expect(assetWithLegacyUrls.fileUrl).toBeUndefined()
        expect(assetWithLegacyUrls.publicUrl).toBeUndefined()
      }
    }
  })
})
