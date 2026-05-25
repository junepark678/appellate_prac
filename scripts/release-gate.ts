import { assertReleaseGate, type EvalFreshnessSnapshot } from '../src/domain/rules/source-governance'

function parseEvalSnapshot(): EvalFreshnessSnapshot | undefined {
  const raw = process.env.SIMULATION_EVAL_SNAPSHOT_JSON
  if (!raw) return undefined
  const parsed = JSON.parse(raw) as EvalFreshnessSnapshot
  return parsed
}

const mode = process.argv.includes('--production') ? 'production' : 'beta'

try {
  const result = assertReleaseGate({
    mode,
    latestEval: parseEvalSnapshot(),
    env: process.env,
  })
  console.log(
    `Release gate passed for ${mode}: ${result.sourceStatuses.length} source versions checked.`,
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
