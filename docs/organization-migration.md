<!--
Appellate Practice Simulator — federal appellate procedure training.
Copyright (C) 2026 Rhajune Park
SPDX-License-Identifier: AGPL-3.0-or-later

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
-->

# Organization ownership inspection runbook

This runbook describes the internal, read-only inspection phase for migration key `org-boundary-v1`. It does not authorize a live inventory run or a migration. This issue implements only `internal.organizationMigration.inspectBatch`; it does not implement `applyBatch`, change records, create migration findings, call storage, or access a live backend.

The fixed authorization rules remain in [the organization contract](organization-contract.md): an active, unexpired organization membership is authoritative. Legacy `users.role` and `cohortMemberships.role` are not authority. Preserve record IDs, bytes, and storage references. Never infer an owner or organization from a global role, a caller, a name, or an incomplete chain.

## Inspection contract

Call the internal query with `{table, cursor, limit}`. `limit` must be an integer from 1 through 100. Continue with the returned cursor until `isDone` is true, using the same table. Cursors are table-bound. The result is `{nextCursor, isDone, scanned, ready, ambiguous, findings}`. Each row receives a stable classification identity based on the migration key, table, and record ID. Storage-reference warnings use a stable identity that also names the reference field; the report never includes a storage ID or bearer URL.

`ready` counts rows whose rule is deterministic, including rows that must be preserved unchanged. `ambiguous` counts rows that must remain unchanged pending review. Findings record the reason. A legacy-storage warning is additional to the row classification and marks historical confidentiality `UNVERIFIED`. Classification is for review only; no write path is provided in this issue.

The primary inventory page is limited to 100 rows. Relationship reads are also capped: most indexed parent probes read at most 101 rows (100 plus one overflow sentinel), and duplicate checks read only enough rows to prove uniqueness is absent. The assignments table has no scenario index, so a scenario inspection probes at most 101 assignments for the whole batch. If more than 100 exist, every private scenario classification in that batch is marked `ambiguous` with `scenario_assignment_scan_truncated`; the partial prefix is never used to infer ownership. Private scenarios similarly report `scenario_session_scan_truncated` when over 100 sessions reference one scenario, and `scenario_assignment_session_scan_truncated` when a session has over 100 assignment-session links. An unlinked analysis whose case has over 100 documents reports `analysis_document_reverse_scan_truncated`; a possible incoming link outside the bounded prefix is not treated as proof of an unlinked row. Related case-session and source-provenance scans use the same conservative overflow rule. These reason codes mean the inspector could not prove the complete relationship set within the fixed bound; they are not evidence of a conflict-free prefix.

Inspect tables serially in this exact order. Finish every table and cursor before moving to the next step.

1. **Organization roots:** `institutions`, `users`. Missing `institutions.kind` defaults to `shared` only when no personal-owner field conflicts; an explicit `shared` kind paired with `personalOwnerUserId`, a missing kind paired with an owner, or a `personal` kind without an owner is ambiguous. IDs and statuses remain unchanged. User identity, profile, budget, and legacy role remain untouched. No membership is created from a global role.
2. **Case sessions:** `caseSessions`. Resolve `assignmentSessions → assignments → cohorts → institutions`. One distinct active organization and matching assignment-session/session owner is unambiguous. Missing parents, owner mismatch, multiple organizations, or a conflicting existing organization are findings. With no assignment link, the stored session owner is the only candidate for the trusted personal-workspace rule. Never move an already org-bound session to a personal workspace because membership expired. Suspended, expired, malformed, or duplicate personal membership is a finding; this inspection does not repair it.
3. **Scenarios:** `scenarios`. Public templates stay in the catalog with no organization scope. For private scenarios, collect the organizations of referencing sessions and assignments. Exactly one organization plus the scenario owner's active membership is required. With no references, only the recorded owner’s personal workspace is eligible. Multiple organizations, missing owner/membership, invalid visibility, unresolved parents, or a scope conflict are findings. Do not clone scenarios or documents.
4. **Imported sources:** `sourceCases`. A historical source row can be linked only when `scenarioId`, `externalId`, recorded CourtListener provenance, source URL, import time, docket number, and the linked session all identify exactly one `trialDocketImports` row. Otherwise leave it unchanged and report ambiguity. Future import code must write `caseSessionId` directly. Ambiguous provenance is not tenant-visible.
5. **Events and audit:** `integrationEvents`, then `auditLog`. An integration event with a session derives scope only from that session. A sessionless event stays identity-private for the same user’s budget/cooldown and is excluded from organization reports. Audit entries keep an existing organization or derive one consistent organization from their case/cohort. Unscoped platform events remain platform-private. Conflicting or missing chains are findings.
6. **Descendant chains:** inspect `participants`, `documents`, `caseSessionEvents`, `ecfReceipts`, `documentAnalyses`, `actorWorkProducts`, `filings`, `docketEntries`, `deadlines`, `aiRuns`, `actorRunAudits`, `simulationTurns`, `actorPackets`, `actorDecisions`, `trialDocketImports`, `counterpartyStrategies`, `amicusCandidates`, `amicusParticipations`, `panelDeliberations`, `panelDispositions`, `panelVotes`, `meritsEvaluations`, `assessments`, `scenarioDocumentAssets`, `scenarioIssues`, `scenarioRecordExcerpts`, `assignmentSessions`, and `simulationPolicies`. Check each required parent and cross-parent link. A session/assignment/course policy must resolve its `scopeId` to the corresponding session, assignment, or cohort. Descendants inherit scope; do not add duplicated organization columns.

Cross-parent checks include both directions of the document/analysis link: when either `documents.analysisId` or `documentAnalyses.documentId` is present, the other row must point back to the same record. A missing reciprocal pointer is ambiguous; rows with neither pointer remain eligible for the unlinked-record rule. Checks also include `ecfReceipts.filingId`, `actorWorkProducts.sourceDocumentAnalysisIds` and `sourceFilingIds`, both filing reference arrays, docket-entry filings, deadline source entries, and actor packet/decision turns. `scenarioRecordExcerpts.citedByIssueIds` must resolve within the same scenario. Assignment-session assignment, case, scenario, and owner links must agree; policy scope links must resolve to the declared scope kind. Malformed, missing, or cross-case/scope references are ambiguous findings. Stored actor/creator user references are checked for existence only; they do not establish ownership or authority.

The inspector does not scan or rewrite shared catalogs: `rulePacks`, `legalSourceVersions`, `legalSourceSnapshots`, `ruleReviewNotes`, `ruleConstraints`, `ecfCatalogEvents`, `deadlineRules`, `sourceBackedConstraints`, `moduleManifests`, `ruleItems`, `courtPacks`, `packBundles`, `procedureTransitions`, `scenarioDrafts`, `sourceDocuments`, `sourceArtifacts`, `sourceReviewDecisions`, `simulationEvalRuns`, and `policyVersions`. `policyAcceptances` and `userDisclaimers` remain identity-level records. Existing `enrollmentInvites` and `supportAccessGrants` retain their organization IDs.

## Before any separately authorized apply phase

1. Obtain explicit owner authorization and an issue that defines the live scope, operator, change window, rollback owner, and retention rules. This inspection child alone authorizes no live call, apply, deployment, provider request, or storage operation.
2. Take a transactionally consistent, access-controlled snapshot/export of all roots, descendants, memberships, source provenance, storage-reference fields, and relevant indexes. Record repository commit, environment, export time, counts, and checksums in the approved protected audit location. Keep exports out of this repository and out of `public/`.
3. Verify the snapshot can be restored into an isolated non-production environment. Reconcile exported table counts and IDs before evaluating any dry-run report. Stop if the snapshot is incomplete or a parent chain is not represented.
4. Run the read-only inspections from step 1 through step 6 against the snapshot first. Retain the complete per-table pages, cursors, stable finding IDs, and a checksum of the report in the protected audit location. Do not turn an ambiguous row into a guessed owner or organization. Review every finding with the data owner; proceed only when every accessible row has an approved deterministic outcome.
5. A future apply implementation must be a separately reviewed internal mutation, use the same pure classifier, re-read each row in its write transaction, write only still-absent fields, preserve IDs/status/bytes/storage references, and make finding writes idempotent. It must report changed and skipped rows, support cursor resume, and prove interruption/concurrency behavior before a live run is considered.
6. After an authorized staged apply, re-inspect all roots and descendants, reconcile row counts and storage references, verify no unresolved accessible row remains, and test scoped APIs before any rollout. Missing `institutionId` after rollout means unavailable; it is never a personal-session fallback.

## Historical storage URLs

For every tenant storage reference in the inspected descendants, the report marks historical confidentiality **UNVERIFIED**. Existing Convex `storage.getUrl` links can be bearer URLs; application authorization cannot revoke a URL that was issued earlier. A new guarded transport does not retroactively secure those URLs. The inspector reads neither object bytes nor storage metadata and does not return storage IDs or URLs. Do not claim historical isolation based on this inspection.

Any historical rotation is a separate owner-authorized operation and issue. Its reviewed plan must read the old bytes, verify SHA256, upload a new private object, transactionally replace every reference, verify authorized access, and only then delete the old object to revoke old links. This issue includes no rotation, deletion, blob upload, or executable destructive command. Historical hosted-data isolation remains blocked until that separate work is authorized and verified.

## Operator boundaries

- `inspectBatch` is an `internalQuery`, not a browser-callable query or mutation.
- The report is sensitive because stable record IDs and scope reasons can identify legacy tenant records. Store it only in the approved restricted audit location.
- No test fixture contacts a live provider or backend. No migration, storage change, deployment, credentials, or additional charges are part of this code change.
