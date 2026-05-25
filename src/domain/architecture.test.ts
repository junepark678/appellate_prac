import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry) ? [path] : []
  })
}

describe('domain architecture boundaries', () => {
  it('keeps production domain code independent from module implementations', () => {
    const offenders = sourceFiles(join(process.cwd(), 'src/domain')).flatMap((file) => {
      const text = readFileSync(file, 'utf8')
      const importsModules = /from ['"][^'"]*\/modules(?:\/[^'"]*)?['"]/.test(text)
      return importsModules ? [relative(process.cwd(), file)] : []
    })

    expect(offenders).toEqual([])
  })
})
