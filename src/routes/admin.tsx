import { createFileRoute } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import {
  Database,
  FileArchive,
  Package,
  Save,
  Search,
  Upload,
  Users,
} from 'lucide-react'
import { useState } from 'react'

import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { AppFrame, EmptyState } from '../components/AppFrame'

export const Route = createFileRoute('/admin')({ component: AdminHome })

type AdminUser = {
  id: Id<'users'>
  authSubject: string
  displayName: string
  role: 'student' | 'admin' | 'instructor'
  monthlyAiBudgetCents: number
  currentMonthAiSpendCents: number
}

type PackBundle = {
  id: Id<'packBundles'>
  bundleVersion: string
  label: string
  status: 'draft' | 'indexed' | 'published' | 'retired'
  zipFileName?: string
  zipSizeBytes?: number
  zipContentHash?: string
  zipUrl?: string
  manifestJson: string
  updatedAt: string
}

type CourtPackRow = {
  packId: string
  label: string
  procedureDomain: string
  releaseStatus?: string
  published: boolean
  sharedRulePackIds: string[]
  localRulePackIds: string[]
  baseCourtPackIds: string[]
  procedureModuleIds: string[]
  componentModuleIds: string[]
  filingEventCount: number
  aiActorCount: number
  sourceVersionIds: string[]
  latestBundle?: PackBundle
}

function AdminHome() {
  const [userSearch, setUserSearch] = useState('')
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [bundleVersion, setBundleVersion] = useState(() =>
    new Date().toISOString().slice(0, 10),
  )
  const [assetMigration, setAssetMigration] = useState({
    pending: false,
    message: '',
  })
  const [formStorage, setFormStorage] = useState({
    pending: false,
    message: '',
  })
  const [bundleMessage, setBundleMessage] = useState('')

  const dashboard = useQuery(api.admin.dashboard, {})
  const institutions = useQuery(api.cohorts.listInstitutions, {})
  const users = useQuery(api.users.list, {
    ...(userSearch.trim() ? { search: userSearch.trim() } : {}),
  }) as AdminUser[] | undefined
  const packManagement = useQuery(api.admin.packManagement, {})
  const sourceArtifacts = useQuery(api.adminSources.listSourceArtifacts, {})
  const createInstitution = useMutation(api.cohorts.createInstitution)
  const seedPolicies = useMutation(api.policies.seedDefaults)
  const seedSources = useMutation(api.adminSources.seedSourceManifest)
  const createPackBundleManifest = useMutation(api.admin.createPackBundleManifest)
  const generatePackBundleUploadUrl = useMutation(api.admin.generatePackBundleUploadUrl)
  const attachPackBundleZip = useMutation(api.admin.attachPackBundleZip)
  const generatePackBundleZip = useAction(api.adminPackBundles.generatePackBundleZip)
  const storeCa4Forms = useAction(api.adminSources.storeCa4FormPdfArtifacts)
  const migrateScenarioPdfAssets = useAction(api.scenarios.migrateBundledScenarioPdfAssets)

  const storedSourceArtifactCount = (sourceArtifacts ?? []).filter(
    (artifact) => artifact.rawStorageId,
  ).length
  const storedPdfArtifactCount = (sourceArtifacts ?? []).filter(
    (artifact) => artifact.mediaType === 'application/pdf' && artifact.rawStorageId,
  ).length

  async function uploadBundleZip(bundle: PackBundle, file: File) {
    setBundleMessage(`Uploading ${file.name}`)
    const uploadUrl = await generatePackBundleUploadUrl({})
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/zip' },
      body: file,
    })
    if (!uploadResponse.ok) {
      throw new Error(`Zip upload failed with HTTP ${uploadResponse.status}`)
    }
    const { storageId } = (await uploadResponse.json()) as { storageId: Id<'_storage'> }
    await attachPackBundleZip({
      bundleId: bundle.id,
      storageId,
      zipFileName: file.name,
      zipSizeBytes: file.size,
    })
    setBundleMessage(`Attached ${file.name} to ${bundle.label}.`)
  }

  return (
    <AppFrame title="Admin Operations">
      <section className="mb-5 grid gap-3 md:grid-cols-4">
        <Metric label="Institutions" value={dashboard?.institutions} />
        <Metric label="Users" value={dashboard?.users} />
        <Metric label="Support grants" value={dashboard?.activeSupportGrants} />
        <Metric label="Packs pending" value={dashboard?.courtPacksPendingProduction} />
      </section>

      <section className="mb-5 rounded border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5" aria-hidden="true" />
          <h2 className="font-semibold">System Operations</h2>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
          <input
            className="rounded border border-slate-300 px-3 py-2"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Institution name"
          />
          <input
            className="rounded border border-slate-300 px-3 py-2"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            placeholder="slug"
          />
          <button
            className="rounded bg-slate-950 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!name || !slug}
            onClick={() =>
              void createInstitution({ name, slug }).then(() => {
                setName('')
                setSlug('')
              })
            }
            type="button"
          >
            Create
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            onClick={() => void seedPolicies({})}
            type="button"
          >
            Seed policies
          </button>
          <button
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            onClick={() => void seedSources({})}
            type="button"
          >
            Seed source manifest
          </button>
          <button
            className="rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
            disabled={formStorage.pending}
            onClick={() => {
              setFormStorage({ pending: true, message: '' })
              void storeCa4Forms({})
                .then((result) => {
                  setFormStorage({
                    pending: false,
                    message: `Stored ${result.stored} bundled form PDFs; ${result.failed.length} failed.`,
                  })
                })
                .catch((error) => {
                  setFormStorage({
                    pending: false,
                    message: error instanceof Error ? error.message : 'Form PDF storage failed.',
                  })
                })
            }}
            type="button"
          >
            Store bundled form PDFs
          </button>
          <button
            className="rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
            disabled={assetMigration.pending}
            onClick={() => {
              setAssetMigration({ pending: true, message: '' })
              void migrateScenarioPdfAssets({})
                .then((result) => {
                  setAssetMigration({
                    pending: false,
                    message: `Uploaded ${result.uploaded}; skipped ${result.skipped}.`,
                  })
                })
                .catch((error) => {
                  setAssetMigration({
                    pending: false,
                    message: error instanceof Error ? error.message : 'Asset migration failed.',
                  })
                })
            }}
            type="button"
          >
            Upload scenario PDFs
          </button>
        </div>
        {[assetMigration.message, formStorage.message].filter(Boolean).map((message) => (
          <p key={message} className="mt-2 text-sm text-slate-600">
            {message}
          </p>
        ))}
      </section>

      <section className="mb-5 rounded border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5" aria-hidden="true" />
            <h2 className="font-semibold">User Management</h2>
          </div>
          <label className="flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-sm">
            <Search className="h-4 w-4" aria-hidden="true" />
            <input
              className="w-56 border-0 p-0 outline-none"
              value={userSearch}
              onChange={(event) => setUserSearch(event.target.value)}
              placeholder="Search users"
            />
          </label>
        </div>
        <div className="mt-4 overflow-auto rounded border border-slate-200">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="border-b border-slate-200 px-3 py-2">User</th>
                <th className="border-b border-slate-200 px-3 py-2">Role</th>
                <th className="border-b border-slate-200 px-3 py-2">AI budget</th>
                <th className="border-b border-slate-200 px-3 py-2">Spend</th>
                <th className="border-b border-slate-200 px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {users?.map((user) => <UserRow key={user.id} user={user} />)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-5 rounded border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5" aria-hidden="true" />
            <h2 className="font-semibold">Pack Management</h2>
          </div>
          <label className="text-sm text-slate-600">
            Bundle version
            <input
              className="ml-2 rounded border border-slate-300 px-3 py-2 text-slate-950"
              value={bundleVersion}
              onChange={(event) => setBundleVersion(event.target.value)}
            />
          </label>
        </div>
        <div className="mt-4 grid gap-3">
          {(packManagement?.courtPacks as CourtPackRow[] | undefined)?.map((pack) => (
            <CourtPackCard
              key={pack.packId}
              pack={pack}
              bundleVersion={bundleVersion}
              onIndex={async () => {
                const bundleId = await createPackBundleManifest({
                  courtPackId: pack.packId,
                  bundleVersion,
                })
                setBundleMessage(`Indexed manifest ${bundleId} for ${pack.label}.`)
              }}
              onUpload={uploadBundleZip}
              onGenerateZip={async (bundle) => {
                const result = await generatePackBundleZip({ bundleId: bundle.id })
                setBundleMessage(
                  `Generated ${result.zipFileName} (${formatBytes(result.zipSizeBytes)}).`,
                )
              }}
            />
          ))}
        </div>
        {bundleMessage ? (
          <p className="mt-3 text-sm text-slate-600">{bundleMessage}</p>
        ) : null}
      </section>

      <section className="mb-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Rule Packs</h2>
          <div className="mt-3 max-h-96 overflow-auto rounded border border-slate-200">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="border-b border-slate-200 px-3 py-2">Pack</th>
                  <th className="border-b border-slate-200 px-3 py-2">Version</th>
                  <th className="border-b border-slate-200 px-3 py-2">Rules</th>
                </tr>
              </thead>
              <tbody>
                {packManagement?.rulePacks.map((pack) => (
                  <tr key={pack.packId} className="border-b border-slate-100">
                    <td className="px-3 py-2">
                      <p className="font-medium">{pack.label}</p>
                      <p className="text-xs text-slate-500">{pack.packId}</p>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{pack.version}</td>
                    <td className="px-3 py-2 text-slate-600">{pack.itemCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="rounded border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Institutions</h2>
          {institutions?.length === 0 ? <EmptyState>No institutions.</EmptyState> : null}
          <ul className="mt-3 grid gap-2 text-sm">
            {institutions?.map((institution) => (
              <li key={institution.id} className="flex justify-between">
                <span>{institution.name}</span>
                <span className="text-slate-500">{institution.status}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Source Artifacts</h2>
            <p className="mt-1 text-sm text-slate-600">
              {storedSourceArtifactCount} stored artifacts, including {storedPdfArtifactCount}{' '}
              stored PDFs.
            </p>
          </div>
        </div>
        <div className="mt-4 max-h-96 overflow-auto rounded border border-slate-200">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="border-b border-slate-200 px-3 py-2">Artifact</th>
                <th className="border-b border-slate-200 px-3 py-2">Source version</th>
                <th className="border-b border-slate-200 px-3 py-2">Review</th>
                <th className="border-b border-slate-200 px-3 py-2">Storage</th>
                <th className="border-b border-slate-200 px-3 py-2">Links</th>
              </tr>
            </thead>
            <tbody>
              {sourceArtifacts?.map((artifact) => (
                <tr key={artifact.id} className="border-b border-slate-100">
                  <td className="px-3 py-2">
                    <p className="font-medium">{artifact.label}</p>
                    <p className="text-xs text-slate-500">
                      {artifact.mediaType ?? 'text/source'} · {artifact.parserVersion}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{artifact.sourceVersionId}</td>
                  <td className="px-3 py-2 text-slate-600">{artifact.reviewStatus}</td>
                  <td className="px-3 py-2">
                    <span className={artifact.rawStorageId ? 'text-emerald-700' : 'text-slate-500'}>
                      {artifact.rawStorageId ? 'Stored' : 'Indexed only'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <a
                        className="text-slate-950 underline decoration-slate-300 underline-offset-2"
                        href={artifact.url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Source
                      </a>
                      {artifact.fileUrl ? (
                        <a
                          className="text-slate-950 underline decoration-slate-300 underline-offset-2"
                          href={artifact.fileUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Storage
                        </a>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppFrame>
  )
}

function Metric({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value ?? '-'}</p>
    </div>
  )
}

function UserRow({ user }: { user: AdminUser }) {
  const [role, setRole] = useState(user.role)
  const [budgetDollars, setBudgetDollars] = useState(
    String(Math.round(user.monthlyAiBudgetCents / 100)),
  )
  const [message, setMessage] = useState('')
  const setUserRole = useMutation(api.users.setRole)
  const setMonthlyAiBudget = useMutation(api.users.setMonthlyAiBudget)

  return (
    <tr className="border-b border-slate-100">
      <td className="px-3 py-2">
        <p className="font-medium">{user.displayName}</p>
        <p className="max-w-xs truncate text-xs text-slate-500">{user.authSubject}</p>
      </td>
      <td className="px-3 py-2">
        <select
          className="rounded border border-slate-300 px-2 py-1"
          value={role}
          onChange={(event) => setRole(event.target.value as AdminUser['role'])}
        >
          <option value="student">student</option>
          <option value="instructor">instructor</option>
          <option value="admin">admin</option>
        </select>
      </td>
      <td className="px-3 py-2">
        <input
          className="w-24 rounded border border-slate-300 px-2 py-1"
          inputMode="numeric"
          value={budgetDollars}
          onChange={(event) => setBudgetDollars(event.target.value)}
        />
      </td>
      <td className="px-3 py-2 text-slate-600">
        {formatMoney(user.currentMonthAiSpendCents)}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-sm"
            onClick={() => {
              setMessage('')
              void Promise.all([
                role !== user.role ? setUserRole({ userId: user.id, role }) : Promise.resolve(),
                setMonthlyAiBudget({
                  userId: user.id,
                  monthlyAiBudgetCents: Number(budgetDollars || 0) * 100,
                }),
              ])
                .then(() => setMessage('Saved'))
                .catch((error) =>
                  setMessage(error instanceof Error ? error.message : 'Save failed'),
                )
            }}
            type="button"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            Save
          </button>
          {message ? <span className="text-xs text-slate-500">{message}</span> : null}
        </div>
      </td>
    </tr>
  )
}

function CourtPackCard({
  pack,
  bundleVersion,
  onIndex,
  onUpload,
  onGenerateZip,
}: {
  pack: CourtPackRow
  bundleVersion: string
  onIndex: () => Promise<void>
  onUpload: (bundle: PackBundle, file: File) => Promise<void>
  onGenerateZip: (bundle: PackBundle) => Promise<void>
}) {
  const [pending, setPending] = useState(false)
  const manifest = pack.latestBundle
    ? (JSON.parse(pack.latestBundle.manifestJson) as {
        inventory?: Record<string, number>
      })
    : undefined

  return (
    <article className="rounded border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{pack.label}</h3>
          <p className="mt-1 text-sm text-slate-600">
            {pack.packId} · {formatLabel(pack.procedureDomain)} ·{' '}
            {formatLabel(pack.releaseStatus ?? 'draft')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
            disabled={pending || !bundleVersion}
            onClick={() => {
              setPending(true)
              void onIndex().finally(() => setPending(false))
            }}
            type="button"
          >
            <FileArchive className="h-4 w-4" aria-hidden="true" />
            Index manifest
          </button>
          <button
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
            disabled={pending || !pack.latestBundle}
            onClick={() => {
              if (!pack.latestBundle) return
              setPending(true)
              void onGenerateZip(pack.latestBundle).finally(() => setPending(false))
            }}
            type="button"
          >
            <FileArchive className="h-4 w-4" aria-hidden="true" />
            Generate zip
          </button>
          <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-slate-300 px-3 py-2 text-sm">
            <Upload className="h-4 w-4" aria-hidden="true" />
            Upload zip
            <input
              className="sr-only"
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              disabled={!pack.latestBundle}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (!file || !pack.latestBundle) return
                setPending(true)
                void onUpload(pack.latestBundle, file).finally(() => {
                  setPending(false)
                  event.target.value = ''
                })
              }}
            />
          </label>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <PackFact label="Shared dependencies" value={pack.sharedRulePackIds.join(', ') || '-'} />
        <PackFact label="Local overlays" value={pack.localRulePackIds.join(', ') || '-'} />
        <PackFact label="Modules" value={String(pack.componentModuleIds.length)} />
        <PackFact label="Sources" value={String(pack.sourceVersionIds.length)} />
      </div>
      <div className="mt-3 grid gap-3 text-sm md:grid-cols-4">
        <span className="text-slate-600">Events: {pack.filingEventCount}</span>
        <span className="text-slate-600">Actors: {pack.aiActorCount}</span>
        <span className="text-slate-600">
          Rules: {manifest?.inventory?.rules ?? '-'}
        </span>
        <span className="text-slate-600">
          Forms: {manifest?.inventory?.forms ?? '-'}
        </span>
      </div>
      {pack.latestBundle ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-600">
          <span>
            Bundle {pack.latestBundle.bundleVersion} · {pack.latestBundle.status}
          </span>
          {pack.latestBundle.zipFileName ? <span>{pack.latestBundle.zipFileName}</span> : null}
          {pack.latestBundle.zipSizeBytes ? (
            <span>{formatBytes(pack.latestBundle.zipSizeBytes)}</span>
          ) : null}
          {pack.latestBundle.zipUrl ? (
            <a
              className="text-slate-950 underline decoration-slate-300 underline-offset-2"
              href={pack.latestBundle.zipUrl}
              rel="noreferrer"
              target="_blank"
            >
              Download zip
            </a>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-500">No bundle indexed.</p>
      )}
    </article>
  )
}

function PackFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-medium">{value}</p>
    </div>
  )
}

function formatLabel(value: string) {
  return value.replace(/_/g, ' ')
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
