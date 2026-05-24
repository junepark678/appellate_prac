# CA4 Instructor Beta Release Checklist

## Scope Gate

- Court coverage is limited to Fourth Circuit counseled federal civil appeals.
- Training-only disclaimer is accepted before learner simulation work.
- Autonomous mode is disabled, supervised, or bounded by assignment policy.

## Source Governance Gate

- Published rule constraints are source-backed, simulator-only, or expert-authored.
- Source artifacts are reviewed or published before court-pack publication.
- CA4 ECF catalog, deadline rules, and source-backed constraints publish only after reviewed sources.

## Safety Gate

- Autonomous runs stop on learner-required filings, deficiency posture, validator rejection, budget caps, human-approval tools, and pause mode.
- LLM or actor output cannot mutate docket state directly; effects pass through deterministic validation and tool application.
- Simulation turns include input and output snapshot hashes, validator version, retry count, and stop reason when halted.

## Verification Gate

- `bun run typecheck`
- `bun run test`
- `bun run build`

## Launch Gate

- Instructor workflow covers cohort, assignment, scenario selection, policy controls, session replay, feedback, and exportable assessment state.
- Learner workflow covers case dashboard, ECF filing, receipts, docket, deadlines, source view, AI actor actions, and assessment.
- Production deploy is blocked if source artifacts, migrations, or eval thresholds are stale.
