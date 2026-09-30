import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('continuous integration configuration', () => {
  it('verifies pushes to the repository default branch', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    const pushConfiguration = workflow.match(/\n  push:\n([\s\S]*?)(?=\n\S)/)?.[1]

    expect(pushConfiguration).toMatch(/\n\s+- master(?:\n|$)/)
  })
})
