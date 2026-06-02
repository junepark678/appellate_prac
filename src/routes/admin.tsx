import { createFileRoute } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import { useState } from 'react'

import { api } from '../../convex/_generated/api'
import { AppFrame, EmptyState } from '../components/AppFrame'

export const Route = createFileRoute('/admin')({ component: AdminHome })

function AdminHome() {
  const dashboard = useQuery(api.admin.dashboard, {})
  const institutions = useQuery(api.cohorts.listInstitutions, {})
  const users = useQuery(api.users.list, {})
  const createInstitution = useMutation(api.cohorts.createInstitution)
  const seedPolicies = useMutation(api.policies.seedDefaults)
  const seedSources = useMutation(api.adminSources.seedSourceManifest)
  const migrateScenarioPdfAssets = useAction(api.scenarios.migrateBundledScenarioPdfAssets)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [assetMigration, setAssetMigration] = useState<{
    pending: boolean
    message: string
  }>({ pending: false, message: '' })

  return (
    <AppFrame title="Admin Operations">
      <section className="mb-5 grid gap-3 md:grid-cols-4">
        <Metric label="Institutions" value={dashboard?.institutions} />
        <Metric label="Users" value={dashboard?.users} />
        <Metric label="Support grants" value={dashboard?.activeSupportGrants} />
        <Metric label="Packs pending" value={dashboard?.courtPacksPendingProduction} />
      </section>
      <section className="mb-5 rounded border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Institution</h2>
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
          >
            Create
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            onClick={() => void seedPolicies({})}
          >
            Seed policies
          </button>
          <button
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            onClick={() => void seedSources({})}
          >
            Seed source manifest
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
          >
            {assetMigration.pending ? 'Uploading PDFs' : 'Upload scenario PDFs'}
          </button>
        </div>
        {assetMigration.message ? (
          <p className="mt-3 text-sm text-slate-600">{assetMigration.message}</p>
        ) : null}
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
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
        <div className="rounded border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Users</h2>
          <ul className="mt-3 grid gap-2 text-sm">
            {users?.map((user) => (
              <li key={user.id} className="flex justify-between gap-4">
                <span>{user.displayName}</span>
                <span className="text-slate-500">{user.role}</span>
              </li>
            ))}
          </ul>
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
