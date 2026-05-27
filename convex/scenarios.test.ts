import { describe, expect, it } from 'vitest'

import { scenarioAssetFetchUrl } from './scenarios'

describe('scenarioAssetFetchUrl', () => {
  it('preserves the configured base URL path for bundled trial record assets', () => {
    const url = scenarioAssetFetchUrl(
      new URL('https://example.com/app?preview=true#trial-records'),
      'synthetic-scenario',
      '001-complaint.pdf',
    )

    expect(url.toString()).toBe(
      'https://example.com/app/trial-records/synthetic-scenario/001-complaint.pdf',
    )
  })
})
