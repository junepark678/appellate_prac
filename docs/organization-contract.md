# Organization schema and shared contracts

Issue [#31](https://github.com/junepark678/appellate_prac/issues/31) implements only the additive foundation of [#22](https://github.com/junepark678/appellate_prac/issues/22). This is **not a deployable completed isolation boundary**. No public organization/catalog/upload APIs, authorization consumers, live migrations, publication, retention decisions, automatic acquisition, or UI behavior are introduced here.

The authoritative Convex validators and inferred TypeScript types are exported from `convex/organizationContracts.ts`; `convex/schema.ts` uses those same row shapes. Existing `users.role` and `cohortMemberships.role` stay required and existing writes stay unchanged. The authorization-cutover issue must atomically make those fields optional, stop new role writes, and update all return validators and consumers. Do not infer global authority from their continued presence.

## Identity, roles, activity and errors

One user identity can have many organization memberships. Persistence retains `institutions`, `institutionMemberships`, and `institutionId`; the UI says Organization. The sole authoritative roles are `learner | instructor | admin` on an active, unexpired organization membership. No global user role, global-admin bypass, operator organization, selected-organization token claim, or cohort enrollment grants authority. Instructor/admin authority applies only to the owning organization. Every cohort belongs to an organization. Personal organizations are owner-only in v1, with no invitations/sharing; they are created lazily, never by a read.

Every organization helper must require active institution status plus active membership status. Expiry is absent or a valid UTC ISO timestamp whose parsed finite value is strictly greater than the current time. Invalid/non-UTC expiry is inactive. Missing/paused/archived institutions and suspended/expired/missing memberships fail closed, even if another record is active. `isOrganizationMembershipActive` supplies the shared time/status predicate; it does not resolve identity, ownership, membership or authorize an operation.

| Condition                                                                                 | Existing `errors.ts` code |
| ----------------------------------------------------------------------------------------- | ------------------------- |
| No authentication                                                                         | `AUTH_REQUIRED`           |
| Missing/foreign organization or resource; inactive institution/membership                 | `NOT_FOUND`               |
| Authorized member lacks operation role                                                    | `AUTH_UNAUTHORIZED_ROLE`  |
| Malformed fields                                                                          | `VALIDATION_ERROR`        |
| Immutable scope mismatch, conflicting duplicate linkage, duplicate personal organizations | `CONFLICT`                |
| Duplicate shared slug                                                                     | `ALREADY_EXISTS`          |
| Submitted session                                                                         | `SESSION_LOCKED`          |
| Automatic acquisition has no approved enforceable budget                                  | `RATE_LIMITED`            |

Never disclose foreign names, titles, storage IDs, role data, or other metadata in errors. A personal organization's suspended/expired membership must not be silently reactivated: return `NOT_FOUND` and report that repair is required.

Capabilities are `{manageMembers, teach, learn}`: admin has all three; instructor has teach and learn; learner has learn. Personal owners still need their own active membership.

## Organization APIs reserved for the dependent implementation

These signatures are published for integration; this foundation does not register them.

- `organizations.ensurePersonal({}): mutation -> {institutionId: Id<"institutions">}`. Resolve only the trusted current user. Transactionally query `by_personal_owner`; if absent, insert one active personal institution named `Personal workspace`, slug `personal-<userId>`, and one active admin membership. Repeated/concurrent calls return the same identifiers. Duplicate personal institutions return `CONFLICT` without choosing one. Do not repair inactive memberships implicitly.
- `organizations.createShared({name: string, slug: string}): authenticated mutation`. Trim name, require length 1..120; slug is lowercase `[a-z0-9-]`, length 3..80. Duplicate slug is `ALREADY_EXISTS`. Insert one active shared institution and an active admin membership for the caller only. Never accept client `clerkOrganizationId` or change another organization's memberships. Parent #22 does not specify a return DTO for this API; this foundation does not invent one.
- `organizations.listMine({}): query -> OrganizationMemberDTO[]`. Only the caller's active unexpired memberships in active organizations; personal first, then name, then ID. No creation on read.
- `organizations.getContext({institutionId: Id<"institutions">}): query -> OrganizationContextDTO`. Return the same member item plus capabilities, after the same identity/organization/membership checks.

`OrganizationMemberDTO = {institutionId, name, kind: personal|shared, role: learner|instructor|admin}`. `OrganizationContextDTO` adds the three boolean capabilities above.

## Additive persistence

New table fields are required unless optional in the exported validator. All pre-existing required fields remain required. All new timestamps are UTC ISO strings. `v.number()` and `v.string()` are structural validators only: future handlers **must** run the semantic helpers before writes (validate complete rows after merging patches), and must enforce relational constraints in the same transaction. No index is an automatic uniqueness constraint.

Existing-table additions:

- `institutions.kind?: personal|shared`, `personalOwnerUserId?: Id<users>`, `createdAt?: string`; `by_personal_owner=[personalOwnerUserId]`. Missing kind means shared during compatibility.
- `caseSessions.institutionId?: Id<institutions>`; `by_institution=[institutionId]`.
- `scenarios.institutionId?: Id<institutions>` for private scenarios only; `by_institution=[institutionId]`. Use `validateScenarioOrganization` when introducing organization scope.
- `sourceCases.caseSessionId?: Id<caseSessions>` for imports only.
- `integrationEvents.institutionId?: Id<institutions>`.

The optional scope fields support backfill compatibility, not permission to bypass ownership checks in new APIs. Legacy columns are not removed.

| New table                        | Indexes (ordered fields)                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| organizationDatasets             | by_institution(institutionId); by_institution_kind(institutionId,kind)                                                                |
| organizationDatasetVersions      | by_dataset_version(datasetId,version); by_dataset_state(datasetId,state); by_institution(institutionId)                               |
| organizationDatasetAssets        | by_version(versionId); by_version_name(versionId,normalizedFileName); by_storage(storageId)                                           |
| publicCatalogEntries             | by_dataset(datasetId); by_published(publishedAt); search by_search(searchText), filter kind                                           |
| organizationDatasetImports       | by_institution(institutionId); by_institution_version(institutionId,upstreamVersionId)                                                |
| organizationImportedAssets       | by_import(importId); by_import_name(importId,fileName)                                                                                |
| documentUploadIntents            | by_user(userId); by_case(caseSessionId); by_dataset_version(datasetVersionId); by_expiry(expiresAt)                                   |
| documentUploadChunks             | by_intent_index(intentId,index)                                                                                                       |
| organizationMigrationFindings    | by_key_record(migrationKey,tableName,recordId)                                                                                        |
| organizationCatalogSubscriptions | by_org_dataset(institutionId,upstreamDatasetId); by_dataset_mode(upstreamDatasetId,mode)                                              |
| organizationCatalogUpdateEvents  | by_subscription(subscriptionId); by_institution(institutionId); by_attempt_event(subscriptionId,subscriptionRevision,versionId,event) |

`organizationMigrationFindings` contains migrationKey, tableName, recordId, reason, status open|resolved, createdAt; its lookup is unique in the transaction. This PR only defines storage, never runs a migration.

Dataset kinds are `source_data | rule_pack`; review status is `unreviewed | organization_reviewed`, not legal approval. Version numbers are safe integers >=1; draft revisions and update revisions are safe integers >=0. All sizes/counts must be finite safe nonnegative integers; chunk indexes are 0..6, hence chunkCount is 1..7. Hashes are lowercase 64-character SHA256 hexadecimal. These checks run in `validateContract` / `validateOrganizationRecord`, not in Convex's primitive schema validators.

## Upload scope and linkage

```ts
type UploadScope =
  | { kind: "session"; caseSessionId: Id<"caseSessions"> }
  | { kind: "dataset"; versionId: Id<"organizationDatasetVersions"> };
```

The DTO deliberately uses `versionId`; the intent row uses `datasetVersionId`. Reject any wrong-parent or extra field, including both parents. Session intents have exactly caseSessionId and no datasetVersionId/datasetAssetId; dataset intents have exactly datasetVersionId and no caseSessionId/documentId/analysisId. Stored and consumed intents require storageId. Consumed session intents require documentId plus analysisId; consumed dataset intents require datasetAssetId. Allowed MIME types are application/pdf, text/plain and application/json. States are pending, stored, consumed, cancelled.

Use `validateUploadIntent`, `validateUploadScopeMatch` and `validateUploadIntentTransition`. Resolve all referenced rows in the owning transaction and verify organization/parent ownership; syntax and typed IDs alone do not prove ownership. Scope mismatch and replacement of already-linked identifiers are `CONFLICT`. Future chunk handlers must transactionally enforce unique (intentId,index); a hash-different collision rejects and deletes only the losing unreferenced temporary object. No cleanup or deletion runs here.

## Canonical manifests and catalog DTOs

`DatasetManifestDTO` is exactly:

```ts
{
  schemaVersion: 1,
  publisher: { institutionId: Id<'institutions'>, label: string },
  kind: DatasetKind, title: string, description: string, tags: string[],
  assets: {
    fileName: string,
    mediaType: 'application/pdf' | 'text/plain' | 'application/json',
    sizeBytes: number, sha256: string,
    provenance: { sourceUrl?: string, retrievedAt?: string, licenseNote?: string }
  }[],
  review: { status: ReviewStatus, note?: string, reviewedAt?: string }
}
```

Unknown keys are rejected recursively, never ignored. There are no storage IDs, member emails, user IDs or executable configuration. Source URLs must be HTTPS metadata and are never fetched automatically. UTC timestamps accept `Z` or `+00:00`, seconds and optional 1..3 fractional digits; calendar round-trip validation rejects invalid dates, rollover, nonfinite dates and non-UTC offsets.

`canonicalizeManifest` validates, rejects duplicate case-insensitive file names, sorts assets by fileName (deterministic lexical order, no locale), and serializes every object's keys in recursive lexical order. Other array order is preserved. It checks canonical UTF-8 length **<=262144 bytes** before returning JSON. `hashManifest` computes lowercase SHA256 over those exact UTF-8 bytes. `parseManifest` validates untrusted JSON and canonicalizes it. JSON IDs can additionally be checked with a `ContractIdCheck` adapter using `db.normalizeId`; Convex argument/database validators enforce actual table IDs at their boundaries. Callers must resolve IDs to enforce existence/ownership. `validateManifestSnapshot` checks exact canonical bytes and contentHash.

Additional exact DTOs (all have exported Convex validators and inferred types):

- `PublicationPreviewDTO = {versionId, revision, title, publisherInstitutionId, assetNames: string[], assetCount, totalBytes, reviewStatus, contentHash, warnings: string[]}`.
- `CatalogSummaryDTO = {datasetId, versionId, title, description, publisherInstitutionId, publisherLabel, kind, reviewStatus, publishedAt, contentHash}`.
- `CatalogVersionDTO = CatalogSummaryDTO & {manifest: DatasetManifestDTO}`.
- `CatalogSearchDTO = {items: CatalogSummaryDTO[], nextCursor: string|null}`.
- `ImportResultDTO = {importId, upstreamVersionId, upstreamContentHash}`.

Every ID refers to its named table in the validator. Preview revision/count/bytes are finite safe nonnegative integers. `validateContract` supplements the DTO validators with semantic numeric/time/hash checks; manifest callers must also use `canonicalizeManifest` for the byte bound.

## Publication, imports and transactional invariants

Drafts may omit storage manifests and hashes. Published/withdrawn versions require manifestStorageId, contentHash, publishedAt and publisherLabel. Version-local title/description/tags/review metadata preserve old public snapshots. Complete preview fields (storage ID, hash, revision, createdAt, publisher label and JSON) must agree on draftRevision. Preview fields are mutable only during draft; every draft edit, asset attach/remove or review change increments draftRevision and clears all preview fields. `validateDraftEdit` checks this rule; `validateVersionTransition` prevents modifying published/withdrawn snapshots, except published -> withdrawn state/withdrawnAt. `validatePublicationSnapshot` binds canonical manifest metadata/hash to the publication row. The publishing transaction must also bind dataset kind and asset descriptors/ownership to resolved dataset/asset rows.

Future handlers must enforce:

- Asset normalizedFileName equals lowercase fileName; unique name per version is an indexed transaction constraint. Asset institutionId matches the parent version/dataset institutionId.
- At most one publicCatalogEntries row per dataset, enforced by by_dataset read+write. Its dataset/version/publisher/metadata/hash represent the selected immutable published version.
- Unique imports per target organization/upstream version, enforced with by_institution_version read+write. Import bytes and asset copies are private, independent and immutable; no mutable version aliases. `validateImmutableImport` rejects changing the imported snapshot row. The import transaction verifies upstream dataset/version/hash, canonical manifest, copied asset descriptors and target ownership, and stores independent target-owned copies. Race losers clean only their own unreferenced temporary copies.
- Draft preview/publication races use exact draftRevision and immutable snapshot bytes. No later draft edit changes an older public snapshot.
- Personal organizations may explicitly publish selected versions without exposing other personal data. Publishing authority is an active owning-organization admin, not legal approval. No legacy data is published automatically.

The transaction-dependent rules are documented obligations, not claims that this schema-only issue exposes or implements handlers. No unapproved retention behavior, storage rotation/deletion, production court-pack approval, or live data publication is authorized.

## Update-mode contract (schema/DTO addition only)

Behavior/UI belongs to [#49](https://github.com/junepark678/appellate_prac/issues/49). The subscription is organization-owned and uniquely keyed by institutionId + upstreamDatasetId. No row means manual. Only active organization instructor/admin can change it (personal owner included); capture actor identity on the server. Imports and imported assets remain unchanged and immutable.

`CatalogUpdateMode = manual|automatic`.

`CatalogUpdateStatus = idle|pending|succeeded|blocked_budget|blocked_access|source_unavailable|failed`.

`CatalogUpdatePreferenceDTO = {mode, revision: number, status, latestAcquiredImportId?: Id<organizationDatasetImports>, lastAttemptVersionId?: Id<organizationDatasetVersions>}`.

`CatalogUpdateEventDTO = {event: mode_changed|update_queued|update_acquired|update_blocked|update_failed, mode, createdAt: string, actorDisplayName: string, versionId?: Id<organizationDatasetVersions>, importId?: Id<organizationDatasetImports>, reasonCode?: VALIDATION_ERROR|NOT_FOUND|AUTH_UNAUTHORIZED_ROLE|CONFLICT|RATE_LIMITED}`.

`CatalogUpdateEventsDTO = {items: CatalogUpdateEventDTO[], nextCursor: string|null}`.

The two tables and all exact fields are defined in the shared validators, including server actor IDs, attempt revisions, statuses and reason codes. No subscription is inserted or job scheduled here. Reserved API signatures and obligations:

- `catalogUpdates.getPreference({institutionId,datasetId})` query: active target membership; absent row returns `{mode:'manual',revision:0,status:'idle'}` without writes.
- `catalogUpdates.setPreference({institutionId,datasetId,mode,expectedRevision,confirmAutomatic?})` mutation: target instructor/admin and existing target import of upstream dataset. First insertion expects 0 and sets revision 1; later changes compare then increment revision. Automatic requires confirmAutomatic === true. Enforce indexed uniqueness, record mode_changed actor event, and invalidate outstanding scheduled revisions on manual. Do not change import bytes/pointers.
- `catalogUpdates.listEvents({institutionId,datasetId,cursor?,limit})` query: active membership, safe integer limit 1..50 (default 20), resolve target org/dataset subscription and paginate its events. Return actor displayName only, never authSubject/email/private other-org metadata.
- `catalogUpdates.retry({institutionId,datasetId})` mutation: active instructor/admin and current automatic mode; capture caller as changedByUserId, increment revision, record attempt, queue newest currently published numeric version only if newer than max imported version. Manual uses explicit importVersion UI, never retry.
- Internal `enqueueForPublishedVersion({versionId})`: invoked by scheduler from successful publish transaction, page automatic subscriptions at limit 50, queue exact subscriptionId/revision/versionId. Opt-in also queues newest currently published version if newer. No polling cron. Transactional by_attempt_event read+write yields one update_queued event per tuple; pending/succeeded attempts no-op.
- Internal scheduled Node `catalogUpdateActions.acquire({subscriptionId,revision,versionId})`: resolve trusted subscription and stored changedByUserId; revalidate active actor instructor/admin, active org, current automatic mode/revision and source published hash before work and again atomically at finalize. Never depend on scheduled ctx.auth or expose public actor-selecting functions.

After #47 merges, #49 may refactor catalogImportActions into a shared server-side copy helper, preserving the explicit public signature; scheduled acquisition requires trusted subscription/revision. Finalization remains unique(org,version), with loser cleanup limited to its own unreferenced copies. New imports update only latestAcquiredImportId and update_acquired audit event; advance only to higher numeric upstream versions even if jobs complete out of order. Existing sessions/resources/evidence remain pinned. Simulation adoption requires an explicit existing resource-selection action; incompatible data never executes.

No automatic retries or periodic jobs. Transient errors record failed and expose authorized Retry. Withdrawal/revocation records source_unavailable/blocked_access. Manual/revision changes prevent finalize and preserve previous data. Completion writes require current subscription revision and matching attempt version. Stale jobs may append their historical failure/blocked event but cannot overwrite current mode, status, lastAttemptVersionId or latestAcquiredImportId, or install a new import; clean only their own unreferenced temporary objects.

**Budget gate remains mandatory:** before any automatic network/storage copy, reserve an enforceable authorized target-org allowance covering manifest + all asset bytes and pending reservations. Without an existing verified cap/reservation mechanism, record blocked_budget / update_blocked / RATE_LIMITED before copying and show “Automatic updates paused: no approved storage budget.” Never invent a budget, billing plan, increased limit, paid infrastructure or bypass. Manual explicit imports retain their existing import policy. A future authorized budget implementation is required if the existing facility cannot prove atomic/idempotent reservation semantics: unique(subscriptionId,revision,versionId), duplicate jobs cannot double-reserve, settle newly stored target content exactly once, race losers release once, failed/cancelled/stale/revoked/withdrawn/abandoned attempts release unused reservations once, and cleanup never releases another attempt's settled usage.

Future UI shows Manual (default) / Automatic (opt-in) at pinned import detail. Confirmation names the target organization, new immutable acquisition, unchanged old pins, and existing budget limits. Show pinned and newest/last-acquired versions separately; Manual exposes Import update, Automatic status/retry on failure; learners read status/history but cannot change mode/retry. Display audit actor name/time. Old imports are retained pending approved withdrawal contract.

## Verification and merge gates

Run `bun run typecheck`, `bun run test`, `bun run build`, exact-head GitHub Actions and independent acceptance review before merge. Registered fixture mutations use pinned `convex-test@0.0.54` with the actual schema; fixtures never contact a live provider or backend. They cover all new tables/indexes, strict DTOs, upload linkage, snapshot immutability, manifest bytes/hashes and required legacy roles. No real organization creation API is registered here.

`convex-test@0.0.54` serializes top-level transactions in TransactionManager.begin. It does **not** reproduce optimistic transaction conflicts. Therefore no personal-org concurrency proof is claimed. The dependent personal-workspace issue must run its actual 20-call ensurePersonal fixture on an **explicitly authorized isolated backend** and record the prerequisite before claiming concurrency verified. This issue does not authorize that backend or any deployment.

Offline generation used the installed Convex CLI's `codegen --system-udfs --typecheck disable` path (local doCodegen, no backend push). The data model derives automatically from schema and remains byte-identical. Only the changed API declaration is retained; unrelated generated runtime/environment outputs are restored in full from the baseline to preserve existing environment declarations. Generated files are never hand-edited.

New project-authored source files carry the full FSF AGPL-3.0-or-later notice and Copyright (C) 2026 Rhajune Park. The software license does not relicense uploaded organization data or datasets. No new charges, purchased credits, paid runners/services, live provider calls or deployment are authorized. Content assets remain outside public/.
