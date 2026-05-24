import { createFileRoute } from '@tanstack/react-router'
import { useAction, useConvexAuth, useMutation, useQuery } from 'convex/react'
import {
  ClerkLoaded,
  ClerkLoading,
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
  useUser,
} from '@clerk/tanstack-react-start'
import {
  AlertTriangle,
  Archive,
  BadgeCheck,
  Bot,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  FileArchive,
  FileCheck2,
  FileText,
  Gavel,
  ListTree,
  Library,
  LogIn,
  PanelTop,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  Upload,
  UserPlus,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import {
  getCourtPack,
  getRuleItemsForCourt,
  scenarios,
} from '../modules/registry'
import {
  createInitialSession,
  inferDocumentSignals,
  nextExpectedToolCall,
  validateFiling,
} from '../domain/simulation'
import type {
  CaseSession,
  FilingDraft,
  FilingEvent,
  ParticipantRole,
  Scenario,
  ToolCall,
  UploadedDocument,
  ValidationIssue,
} from '../domain/types'
import type { CourtListenerSearchResult } from '../integrations/courtlistener'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'

export const Route = createFileRoute('/')({ component: Home })

type ViewKey = 'docket' | 'file' | 'trialDocket' | 'rules' | 'scenarios' | 'assessment'

const learnerRole: ParticipantRole = 'appellant'

type CourtListenerSearchAction = (args: {
  query: string
}) => Promise<CourtListenerSearchResult[]>

type AdvanceLiveEventAction = (args: {
  caseSessionId: Id<'caseSessions'>
}) => Promise<{
  session: CaseSession
  toolCall: ToolCall | null
  rawText: string
}>

type TrialDocketEntry = {
  entryNumber: number
  filedAt: string
  title: string
  text: string
}

type TrialDocket = {
  caption: string
  court: string
  docketNumber: string
  sourceUrl?: string
  entries: TrialDocketEntry[]
}

type SessionSummary = {
  id: string
  scenarioTitle: string
  shortCaption: string
  status: CaseSession['status']
  simulatedDate: string
  createdAt: number
}

const enableLiveAi = import.meta.env.VITE_ENABLE_OPENROUTER === 'true'
const enableCourtListener = import.meta.env.VITE_ENABLE_COURTLISTENER === 'true'

function Home() {
  const { isSignedIn } = useUser()
  const convexAuth = useConvexAuth()
  const canUseConvex = isSignedIn === true && convexAuth.isAuthenticated
  const [activeCaseSessionId, setActiveCaseSessionId] =
    useState<Id<'caseSessions'> | null>(null)
  const [trialDocket, setTrialDocket] = useState<TrialDocket>(() =>
    createTrialDocket(createInitialSession()),
  )
  const [activeView, setActiveView] = useState<ViewKey>('docket')
  const [recapQuery, setRecapQuery] = useState('employment retaliation summary judgment')
  const [recapResults, setRecapResults] = useState<CourtListenerSearchResult[]>([])
  const [recapPending, setRecapPending] = useState(false)
  const [recapError, setRecapError] = useState('')
  const [aiPending, setAiPending] = useState(false)
  const [aiError, setAiError] = useState('')
  const [sessionPending, setSessionPending] = useState(false)
  const [sessionError, setSessionError] = useState('')
  const [draft, setDraft] = useState<FilingDraft>(() =>
    createEmptyDraft(createInitialSession(), 'notice_of_appeal'),
  )
  const upsertCurrentUser = useMutation(api.users.upsertCurrentUser)
  const createCaseSession = useMutation(api.caseSessions.create)
  const submitFiling = useMutation(api.caseSessions.submitFiling)
  const advanceExpected = useMutation(api.caseSessions.advanceExpectedEvent)
  const importCourtListenerSource = useMutation(
    api.caseSessions.importCourtListenerSource,
  )
  const advanceLive = useAction(api.caseSessions.advanceLiveEvent) as AdvanceLiveEventAction
  const searchCourtListener = useAction(
    api.integrations.searchLiveCourtListenerDockets,
  ) as CourtListenerSearchAction
  const session = useQuery(
    api.caseSessions.getForCurrentUser,
    canUseConvex
      ? activeCaseSessionId
        ? { caseSessionId: activeCaseSessionId }
        : {}
      : 'skip',
  )
  const sessionList = useQuery(
    api.caseSessions.listForCurrentUser,
    canUseConvex ? {} : 'skip',
  )
  const publishedScenarios = useQuery(
    api.scenarios.listPublished,
    canUseConvex ? {} : 'skip',
  )
  const integrationStatus = useQuery(
    api.integrations.getIntegrationStatus,
    canUseConvex ? {} : 'skip',
  )
  const importedTrialDocket = useQuery(
    api.caseSessions.getTrialDocketForCurrentUser,
    canUseConvex && session
      ? { caseSessionId: session.id as Id<'caseSessions'> }
      : 'skip',
  )
  const activeSession = session ?? null
  const scenarioOptions = publishedScenarios ?? scenarios
  const courtPack = activeSession ? getCourtPack(activeSession.courtPackId) : null
  const ruleItems = activeSession ? getRuleItemsForCourt(activeSession.courtPackId) : []
  const availableEvents = (courtPack?.filingEvents ?? []).filter((event) =>
    event.allowedParticipantRoles.includes(learnerRole),
  )
  const activeToolCall = activeSession ? nextExpectedToolCall(activeSession) : null
  const validationIssues = useMemo(
    () => (activeSession ? validateFiling(activeSession, draft) : []),
    [activeSession, draft],
  )
  const liveAiReady =
    enableLiveAi && integrationStatus?.openRouterConfigured === true
  const courtListenerReady =
    enableCourtListener && integrationStatus?.courtListenerConfigured === true
  const liveAiUnavailableReason = !enableLiveAi
    ? 'Live AI events are disabled for this beta.'
    : integrationStatus?.openRouterConfigured === false
      ? 'Live AI events are not configured.'
      : 'Live AI event status is loading.'
  const courtListenerUnavailableReason = !enableCourtListener
    ? 'CourtListener is disabled for this beta.'
    : integrationStatus?.courtListenerConfigured === false
      ? 'CourtListener is not configured in Convex.'
      : 'CourtListener status is loading.'

  useEffect(() => {
    if (!canUseConvex) return
    void upsertCurrentUser({}).catch((error) => {
      setSessionError(
        error instanceof Error ? error.message : 'Unable to initialize user profile',
      )
    })
  }, [canUseConvex, upsertCurrentUser])

  useEffect(() => {
    if (!activeSession) return
    setDraft(createEmptyDraft(activeSession, 'notice_of_appeal'))
    setTrialDocket(importedTrialDocket ?? createTrialDocket(activeSession))
  }, [activeSession?.id, importedTrialDocket])

  function resetDraft(eventId = draft.eventId) {
    if (!activeSession) return
    setDraft(createEmptyDraft(activeSession, eventId))
  }

  async function startScenario(scenarioId: string) {
    setSessionPending(true)
    setSessionError('')
    try {
      const nextSession = await createCaseSession({ scenarioId })
      setActiveCaseSessionId(nextSession.id as Id<'caseSessions'>)
      setTrialDocket(createTrialDocket(nextSession))
      setDraft(createEmptyDraft(nextSession, 'notice_of_appeal'))
      setActiveView('docket')
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Unable to create session')
    } finally {
      setSessionPending(false)
    }
  }

  function resumeSession(caseSessionId: string) {
    setActiveCaseSessionId(caseSessionId as Id<'caseSessions'>)
    setActiveView('docket')
    setSessionError('')
  }

  async function submitDraft() {
    if (!activeSession) return
    setSessionPending(true)
    setSessionError('')
    try {
      const nextSession = await submitFiling({
        caseSessionId: activeSession.id as Id<'caseSessions'>,
        draft,
      })
      setDraft(createEmptyDraft(nextSession, draft.eventId))
      setActiveView('docket')
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Unable to submit filing')
    } finally {
      setSessionPending(false)
    }
  }

  async function advanceExpectedEvent() {
    if (!activeSession) return
    setSessionPending(true)
    setSessionError('')
    try {
      const nextSession = await advanceExpected({
        caseSessionId: activeSession.id as Id<'caseSessions'>,
      })
      if (nextSession.status === 'closed') {
        setActiveView('assessment')
      }
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Unable to advance event')
    } finally {
      setSessionPending(false)
    }
  }

  async function advanceLiveEvent() {
    if (!activeSession) return
    if (!liveAiReady) {
      setAiError(liveAiUnavailableReason)
      return
    }
    setAiPending(true)
    setAiError('')
    try {
      const result = await advanceLive({
        caseSessionId: activeSession.id as Id<'caseSessions'>,
      })
      if (!result.toolCall) {
        setAiError('The AI service returned text, but no valid procedural event.')
        return
      }
      if (result.session.status === 'closed') {
        setActiveView('assessment')
      }
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Live AI request failed')
    } finally {
      setAiPending(false)
    }
  }

  async function searchRecap() {
    if (!courtListenerReady) {
      setRecapError(courtListenerUnavailableReason)
      return
    }
    setRecapPending(true)
    setRecapError('')
    try {
      setRecapResults(await searchCourtListener({ query: recapQuery }))
    } catch (error) {
      setRecapError(error instanceof Error ? error.message : 'CourtListener search failed')
      setRecapResults([])
    } finally {
      setRecapPending(false)
    }
  }

  async function importRecapResult(result: CourtListenerSearchResult) {
    if (!activeSession) return
    if (!courtListenerReady) {
      setRecapError(courtListenerUnavailableReason)
      return
    }
    setRecapPending(true)
    setRecapError('')
    try {
      const imported = await importCourtListenerSource({
        caseSessionId: activeSession.id as Id<'caseSessions'>,
        result,
      })
      setTrialDocket(imported.trialDocket)
      setActiveView('docket')
    } catch (error) {
      setRecapError(error instanceof Error ? error.message : 'CourtListener import failed')
    } finally {
      setRecapPending(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#f6f4ef] text-[#18201d]">
      <div className="border-b border-[#d8d1c4] bg-[#fbfaf7]">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#1d4d4f] text-white">
              <Scale className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
                Appellate Practice Simulator
              </div>
              <h1 className="truncate text-xl font-semibold">
                {activeSession?.scenario.shortCaption ?? 'Authenticated Beta'}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Show when="signed-in">
              <AuthenticatedAccount />
            </Show>
            <Show when="signed-out">
              <div className="flex items-center gap-2">
                <SignInButton mode="modal">
                  <button
                    className="inline-flex items-center gap-2 rounded-md border border-[#d8d1c4] bg-white px-3 py-2 font-semibold text-[#1d4d4f] hover:bg-[#eef6f3]"
                    type="button"
                  >
                    <LogIn className="h-4 w-4" aria-hidden="true" />
                    Sign in
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button
                    className="inline-flex items-center gap-2 rounded-md bg-[#1d4d4f] px-3 py-2 font-semibold text-white hover:bg-[#173f41]"
                    type="button"
                  >
                    <UserPlus className="h-4 w-4" aria-hidden="true" />
                    Sign up
                  </button>
                </SignUpButton>
              </div>
            </Show>
            {activeSession ? (
              <Show when="signed-in">
                <span className={statusClass(activeSession.status)}>
                  {activeSession.status}
                </span>
              </Show>
            ) : null}
          </div>
        </div>
      </div>

      <ClerkLoading>
        <AuthLoadingPanel />
      </ClerkLoading>
      <ClerkLoaded>
        <Show when="signed-in">
          {convexAuth.isLoading ? (
            <SessionLoadingPanel />
          ) : !convexAuth.isAuthenticated ? (
            <ConvexAuthSetupPanel />
          ) : session === undefined || sessionList === undefined ? (
            <SessionLoadingPanel />
          ) : activeSession ? (
            <div className="mx-auto max-w-[1500px] px-5 py-5">
              <SessionToolbar
                activeSession={activeSession}
                busy={sessionPending}
                error={sessionError}
                sessions={sessionList}
                onNewSession={() => startScenario(activeSession.scenario.id)}
                onResumeSession={resumeSession}
              />
              <BetaNotice />
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
                <aside className="space-y-4">
                  <CasePanel session={activeSession} />
                  <DeadlinePanel session={activeSession} />
                  <JurisdictionPanel courtPackId={activeSession.courtPackId} />
                </aside>

                <section className="min-w-0">
                  <ViewTabs activeView={activeView} onSelect={setActiveView} />

                  {activeView === 'docket' && activeToolCall ? (
                    <DocketView
                      session={activeSession}
                      activeToolCall={activeToolCall}
                      aiError={aiError}
                      aiPending={aiPending}
                      liveAiEnabled={liveAiReady}
                      liveAiUnavailableReason={liveAiUnavailableReason}
                      onAdvanceExpected={advanceExpectedEvent}
                      onAdvanceLive={advanceLiveEvent}
                    />
                  ) : null}

                  {activeView === 'file' ? (
                    <FilingView
                      draft={draft}
                      events={availableEvents}
                      validationIssues={validationIssues}
                      onDraftChange={setDraft}
                      onReset={resetDraft}
                      onSubmit={submitDraft}
                    />
                  ) : null}

                  {activeView === 'rules' ? (
                    <RulesView
                      ruleItems={ruleItems}
                      courtPackId={activeSession.courtPackId}
                    />
                  ) : null}

                  {activeView === 'trialDocket' ? (
                    <TrialDocketView
                      courtListenerEnabled={courtListenerReady}
                      courtListenerUnavailableReason={courtListenerUnavailableReason}
                      trialDocket={trialDocket}
                      recapQuery={recapQuery}
                      recapError={recapError}
                      recapPending={recapPending}
                      recapResults={recapResults}
                      onQueryChange={setRecapQuery}
                      onImportResult={importRecapResult}
                      onSearchRecap={searchRecap}
                    />
                  ) : null}

                  {activeView === 'scenarios' ? (
                    <ScenariosView
                      scenarios={scenarioOptions}
                      selectedScenarioId={activeSession.scenario.id}
                      onStartScenario={startScenario}
                    />
                  ) : null}

                  {activeView === 'assessment' ? (
                    <AssessmentView session={activeSession} />
                  ) : null}
                </section>
              </div>
            </div>
          ) : (
            <SessionChooser
              busy={sessionPending}
              error={sessionError}
              scenarios={scenarioOptions}
              sessions={sessionList}
              onResumeSession={resumeSession}
              onStartScenario={startScenario}
            />
          )}
        </Show>
        <Show when="signed-out">
          <AuthPanel />
        </Show>
      </ClerkLoaded>
    </main>
  )
}

function AuthenticatedAccount() {
  const { user } = useUser()
  const label =
    user?.fullName ??
    user?.primaryEmailAddress?.emailAddress ??
    'Student account'

  return (
    <div className="flex items-center gap-2 rounded-md border border-[#d8d1c4] bg-white px-3 py-2">
      <span className="max-w-[200px] truncate font-medium">{label}</span>
      <UserButton />
    </div>
  )
}

function AuthPanel() {
  return (
    <section className="mx-auto grid max-w-[1500px] px-5 py-16">
      <div className="max-w-xl rounded-lg border border-[#d8d1c4] bg-[#fbfaf7] p-6 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Authentication required
        </div>
        <h2 className="text-2xl font-semibold text-[#18201d]">
          Sign in to use the simulator
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#4f5a55]">
          Your session is now protected by Clerk. Sign in or create an account to
          practice filings, docket events, and assessments.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <SignInButton mode="modal">
            <button
              className="inline-flex items-center gap-2 rounded-md bg-[#1d4d4f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#173f41]"
              type="button"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              Sign in
            </button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button
              className="inline-flex items-center gap-2 rounded-md border border-[#d8d1c4] bg-white px-4 py-2 text-sm font-semibold text-[#1d4d4f] hover:bg-[#eef6f3]"
              type="button"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Create account
            </button>
          </SignUpButton>
        </div>
      </div>
    </section>
  )
}

function AuthLoadingPanel() {
  return (
    <section className="mx-auto grid max-w-[1500px] px-5 py-16">
      <div className="max-w-xl rounded-lg border border-[#d8d1c4] bg-[#fbfaf7] p-6 text-sm font-medium text-[#4f5a55]">
        Loading authentication...
      </div>
    </section>
  )
}

function SessionLoadingPanel() {
  return (
    <section className="mx-auto grid max-w-[1500px] px-5 py-16">
      <div className="max-w-xl rounded-lg border border-[#d8d1c4] bg-[#fbfaf7] p-6 text-sm font-medium text-[#4f5a55]">
        Loading simulator sessions...
      </div>
    </section>
  )
}

function ConvexAuthSetupPanel() {
  return (
    <section className="mx-auto grid max-w-[1500px] px-5 py-16">
      <div className="max-w-xl rounded-lg border border-[#edc6bc] bg-[#fff1ee] p-6 text-sm leading-6 text-[#8a321f]">
        <div className="mb-2 flex items-center gap-2 font-semibold uppercase tracking-[0.08em]">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          Convex authentication unavailable
        </div>
        Clerk sign-in succeeded, but Convex has not received a valid Clerk JWT. Check
        the Clerk JWT template named convex and the Convex CLERK_JWT_ISSUER_DOMAIN
        value.
      </div>
    </section>
  )
}

function BetaNotice() {
  return (
    <section className="mb-4 rounded-lg border border-[#d8d1c4] bg-[#fbfaf7] px-4 py-3 text-sm leading-6 text-[#4f5a55]">
      This beta is an educational practice simulator. It is not legal advice and does
      not create an attorney-client relationship.
    </section>
  )
}

function SessionToolbar({
  activeSession,
  busy,
  error,
  sessions,
  onNewSession,
  onResumeSession,
}: {
  activeSession: CaseSession
  busy: boolean
  error: string
  sessions: SessionSummary[]
  onNewSession: () => void
  onResumeSession: (caseSessionId: string) => void
}) {
  return (
    <section className="mb-4 grid gap-3 rounded-lg border border-[#d8d1c4] bg-[#fbfaf7] p-4 lg:grid-cols-[1fr_auto_auto] lg:items-center">
      <div>
        <div className="text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
          Current Session
        </div>
        <div className="mt-1 font-semibold">{activeSession.scenario.title}</div>
        {error ? <p className="mt-1 text-sm font-medium text-[#8a321f]">{error}</p> : null}
      </div>
      <select
        className="h-10 rounded-md border border-[#c9c1b3] bg-white px-3 text-sm"
        onChange={(event) => onResumeSession(event.target.value)}
        value={activeSession.id}
      >
        {sessions.map((session) => (
          <option key={session.id} value={session.id}>
            {session.shortCaption} - {new Date(session.simulatedDate).toLocaleDateString()}
          </option>
        ))}
      </select>
      <button
        className="flex h-10 items-center justify-center gap-2 rounded-md bg-[#1d4d4f] px-3 text-sm font-semibold text-white hover:bg-[#173f41] disabled:cursor-not-allowed disabled:bg-[#9aa6a2]"
        disabled={busy}
        onClick={onNewSession}
        type="button"
      >
        <FileText className="h-4 w-4" aria-hidden="true" />
        New Session
      </button>
    </section>
  )
}

function SessionChooser({
  busy,
  error,
  scenarios,
  sessions,
  onResumeSession,
  onStartScenario,
}: {
  busy: boolean
  error: string
  scenarios: Scenario[]
  sessions: SessionSummary[]
  onResumeSession: (caseSessionId: string) => void
  onStartScenario: (scenarioId: string) => void
}) {
  return (
    <section className="mx-auto grid max-w-[1500px] gap-4 px-5 py-8 lg:grid-cols-[360px_1fr]">
      <div className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7] p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
          <PanelTop className="h-4 w-4" aria-hidden="true" />
          Resume Session
        </div>
        {sessions.length ? (
          <div className="space-y-2">
            {sessions.map((session) => (
              <button
                className="grid w-full gap-1 rounded-md border border-[#d8d1c4] bg-white p-3 text-left text-sm hover:bg-[#eef6f3]"
                key={session.id}
                onClick={() => onResumeSession(session.id)}
                type="button"
              >
                <span className="font-semibold">{session.shortCaption}</span>
                <span className="text-xs capitalize text-[#68716c]">
                  {session.status} - {new Date(session.simulatedDate).toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm leading-6 text-[#59625d]">
            No saved simulator sessions yet.
          </p>
        )}
        {error ? <p className="mt-3 text-sm font-medium text-[#8a321f]">{error}</p> : null}
      </div>

      <div className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7]">
        <div className="border-b border-[#d8d1c4] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
            <Gavel className="h-4 w-4" aria-hidden="true" />
            New Session
          </div>
        </div>
        <div className="divide-y divide-[#e2dbcf]">
          {scenarios.map((scenario) => (
            <article className="grid gap-3 p-4 lg:grid-cols-[1fr_auto]" key={scenario.id}>
              <div>
                <h2 className="font-semibold">{scenario.title}</h2>
                <p className="mt-2 text-sm leading-6 text-[#59625d]">
                  {scenario.proceduralPosture}
                </p>
              </div>
              <button
                className="flex h-10 items-center justify-center gap-2 rounded-md bg-[#1d4d4f] px-3 text-sm font-semibold text-white hover:bg-[#173f41] disabled:cursor-not-allowed disabled:bg-[#9aa6a2]"
                disabled={busy}
                onClick={() => onStartScenario(scenario.id)}
                type="button"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Start
              </button>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

function createEmptyDraft(session: CaseSession, eventId: string): FilingDraft {
  return {
    eventId,
    participantRole: learnerRole,
    title:
      getCourtPack(session.courtPackId).filingEvents.find((event) => event.id === eventId)
        ?.label ?? 'Filing',
    documents: [],
    certificateOfService: true,
    certificateOfCompliance: eventId.includes('brief'),
    sealed: false,
    notes: '',
  }
}

function createTrialDocket(session: CaseSession): TrialDocket {
  const { scenario } = session
  return {
    caption: scenario.shortCaption,
    court: scenario.lowerTribunal,
    docketNumber: '1:25-cv-01482',
    entries: [
      {
        entryNumber: 1,
        filedAt: '2025-08-18T14:32:00.000Z',
        title: 'Complaint',
        text: `Opening pleading filed in ${scenario.shortCaption}. Nature of suit: ${scenario.natureOfSuit}.`,
      },
      {
        entryNumber: 18,
        filedAt: '2025-11-03T16:20:00.000Z',
        title: 'Dispositive Motion',
        text: `A dispositive motion was filed in the lower tribunal. Posture: ${scenario.proceduralPosture}`,
      },
      {
        entryNumber: 31,
        filedAt: '2026-02-06T19:45:00.000Z',
        title: 'Memorandum Opinion and Order',
        text: `The lower tribunal issued an order creating the appellate posture for ${scenario.shortCaption}.`,
      },
      {
        entryNumber: 32,
        filedAt: '2026-02-06T19:48:00.000Z',
        title: 'Civil Judgment',
        text: `Final judgment entered in the ${scenario.natureOfSuit.toLowerCase()} matter.`,
      },
    ],
  }
}

function statusClass(status: CaseSession['status']) {
  const base = 'rounded-md px-3 py-2 text-sm font-semibold capitalize'
  if (status === 'closed') return `${base} bg-[#dceadf] text-[#285b38]`
  if (status === 'submitted') return `${base} bg-[#e5e2f4] text-[#443a7a]`
  if (status === 'dismissed') return `${base} bg-[#f1dad2] text-[#8a321f]`
  return `${base} bg-[#e6eee9] text-[#1d4d4f]`
}

function CasePanel({ session }: { session: CaseSession }) {
  return (
    <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
        <Building2 className="h-4 w-4" aria-hidden="true" />
        Case
      </div>
      <div className="space-y-3 text-sm">
        <InfoRow label="Court" value={getCourtPack(session.courtPackId).label} />
        <InfoRow label="Lower tribunal" value={session.scenario.lowerTribunal} />
        <InfoRow label="Nature" value={session.scenario.natureOfSuit} />
        <InfoRow label="Posture" value={session.scenario.proceduralPosture} />
      </div>
    </section>
  )
}

function DeadlinePanel({ session }: { session: CaseSession }) {
  return (
    <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
        <CalendarClock className="h-4 w-4" aria-hidden="true" />
        Deadlines
      </div>
      <div className="space-y-2">
        {session.deadlines.slice(-5).map((deadline) => (
          <div
            className="grid grid-cols-[1fr_auto] gap-2 rounded-md border border-[#e2dbcf] bg-white p-3 text-sm"
            key={deadline.id}
          >
            <div>
              <div className="font-medium">{deadline.label}</div>
              <div className="text-xs text-[#68716c]">
                {new Date(deadline.dueDate).toLocaleDateString()}
              </div>
            </div>
            <span className="h-fit rounded bg-[#eef1ed] px-2 py-1 text-xs font-semibold capitalize text-[#4f5f57]">
              {deadline.status}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function JurisdictionPanel({ courtPackId }: { courtPackId: string }) {
  const courtPack = getCourtPack(courtPackId)
  return (
    <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
        <Archive className="h-4 w-4" aria-hidden="true" />
        Pack
      </div>
      <div className="space-y-2 text-sm">
        <InfoRow label="System" value={courtPack.courtSystem} />
        <InfoRow label="Level" value={courtPack.courtLevel.replaceAll('_', ' ')} />
        <InfoRow label="Domain" value={courtPack.procedureDomain.replaceAll('_', ' ')} />
        <InfoRow label="Format" value={courtPack.docketNumberFormat} />
      </div>
    </section>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#7c827d]">
        {label}
      </div>
      <div className="mt-1 leading-snug">{value}</div>
    </div>
  )
}

function ViewTabs({
  activeView,
  onSelect,
}: {
  activeView: ViewKey
  onSelect: (view: ViewKey) => void
}) {
  const tabs: Array<{ key: ViewKey; label: string; icon: typeof PanelTop }> = [
    { key: 'docket', label: 'Docket', icon: PanelTop },
    { key: 'file', label: 'File', icon: Upload },
    { key: 'trialDocket', label: 'Trial Docket', icon: ListTree },
    { key: 'rules', label: 'Rules', icon: Library },
    { key: 'scenarios', label: 'Scenarios', icon: Search },
    { key: 'assessment', label: 'Assessment', icon: BadgeCheck },
  ]

  return (
    <nav className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {tabs.map((tab) => {
        const Icon = tab.icon
        return (
          <button
            className={`flex h-11 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold ${
              activeView === tab.key
                ? 'border-[#1d4d4f] bg-[#1d4d4f] text-white'
                : 'border-[#d8d1c4] bg-[#fbfaf7] text-[#3e4843] hover:bg-white'
            }`}
            key={tab.key}
            onClick={() => onSelect(tab.key)}
            type="button"
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}

function DocketView({
  session,
  activeToolCall,
  aiError,
  aiPending,
  liveAiEnabled,
  liveAiUnavailableReason,
  onAdvanceExpected,
  onAdvanceLive,
}: {
  session: CaseSession
  activeToolCall: ToolCall
  aiError: string
  aiPending: boolean
  liveAiEnabled: boolean
  liveAiUnavailableReason: string
  onAdvanceExpected: () => void
  onAdvanceLive: () => void
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7] p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
              <Bot className="h-4 w-4" aria-hidden="true" />
              Next Event
            </div>
            <div className="mt-1 text-lg font-semibold">{toolCallTitle(activeToolCall)}</div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-[#59625d]">
              {toolCallText(activeToolCall)}
            </p>
            {aiError ? (
              <p className="mt-2 text-sm font-medium text-[#8a321f]">{aiError}</p>
            ) : null}
            {!liveAiEnabled ? (
              <p className="mt-2 text-sm font-medium text-[#68716c]">
                {liveAiUnavailableReason}
              </p>
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:w-[430px]">
            <button
              className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-[#1d4d4f] px-4 text-sm font-semibold text-white hover:bg-[#173f41] disabled:cursor-not-allowed disabled:bg-[#9aa6a2]"
              disabled={session.status === 'closed' || aiPending || !liveAiEnabled}
              onClick={onAdvanceLive}
              type="button"
            >
              <Bot className="h-4 w-4" aria-hidden="true" />
              {aiPending ? 'Calling AI' : 'Live AI Event'}
            </button>
            <button
              className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-[#8b3f2f] px-4 text-sm font-semibold text-white hover:bg-[#773326] disabled:cursor-not-allowed disabled:bg-[#b9988f]"
              disabled={session.status === 'closed' || aiPending}
              onClick={onAdvanceExpected}
              type="button"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
              Expected Event
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7]">
        <div className="grid grid-cols-[80px_160px_1fr] border-b border-[#d8d1c4] px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-[#68716c]">
          <div>No.</div>
          <div>Date</div>
          <div>Entry</div>
        </div>
        <div className="divide-y divide-[#e2dbcf]">
          {session.docketEntries.map((entry) => (
            <article
              className="grid grid-cols-1 gap-2 px-4 py-4 text-sm md:grid-cols-[80px_160px_1fr]"
              key={entry.id}
            >
              <div className="font-mono text-[#68716c]">{entry.entryNumber}</div>
              <div className="text-[#59625d]">
                {new Date(entry.filedAt).toLocaleDateString()}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{entry.title}</span>
                  <span className="rounded bg-[#eef1ed] px-2 py-1 text-xs font-semibold capitalize text-[#4f5f57]">
                    {entry.actorRole.replaceAll('_', ' ')}
                  </span>
                </div>
                <p className="mt-2 leading-6 text-[#3e4843]">{entry.text}</p>
                {entry.ruleRefs.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {entry.ruleRefs.map((rule) => (
                      <a
                        className="rounded border border-[#d8d1c4] bg-white px-2 py-1 text-xs font-medium text-[#1d4d4f]"
                        href={rule.sourceUrl}
                        key={`${entry.id}-${rule.ruleId}`}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {rule.label}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function FilingView({
  draft,
  events,
  validationIssues,
  onDraftChange,
  onReset,
  onSubmit,
}: {
  draft: FilingDraft
  events: FilingEvent[]
  validationIssues: ValidationIssue[]
  onDraftChange: (draft: FilingDraft) => void
  onReset: (eventId?: string) => void
  onSubmit: () => void
}) {
  const errors = validationIssues.filter((issue) => issue.severity === 'error')

  function setDocuments(files: FileList | null) {
    const documents: UploadedDocument[] = Array.from(files ?? []).map(inferDocumentSignals)
    onDraftChange({ ...draft, documents })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7] p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
            <FileText className="h-4 w-4" aria-hidden="true" />
            Filing
          </div>
          <button
            className="flex h-9 items-center gap-2 rounded-md border border-[#d8d1c4] bg-white px-3 text-sm font-semibold"
            onClick={() => onReset()}
            type="button"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Reset
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm font-medium">
            Filing event
            <select
              className="h-11 w-full rounded-md border border-[#c9c1b3] bg-white px-3"
              onChange={(event) => onReset(event.target.value)}
              value={draft.eventId}
            >
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm font-medium">
            Title
            <input
              className="h-11 w-full rounded-md border border-[#c9c1b3] bg-white px-3"
              onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
              value={draft.title}
            />
          </label>
        </div>

        <label className="mt-4 block space-y-2 text-sm font-medium">
          PDF documents
          <div className="grid min-h-36 place-items-center rounded-lg border border-dashed border-[#b7aa98] bg-white px-4 py-6 text-center">
            <div>
              <FileArchive className="mx-auto h-8 w-8 text-[#1d4d4f]" aria-hidden="true" />
              <input
                accept="application/pdf"
                className="mt-4 w-full max-w-sm text-sm"
                multiple
                onChange={(event) => setDocuments(event.target.files)}
                type="file"
              />
            </div>
          </div>
        </label>

        {draft.documents.length ? (
          <div className="mt-4 divide-y divide-[#e2dbcf] rounded-lg border border-[#e2dbcf] bg-white">
            {draft.documents.map((document) => (
              <div className="grid gap-2 px-3 py-3 text-sm md:grid-cols-[1fr_auto]" key={document.id}>
                <div>
                  <div className="font-semibold">{document.fileName}</div>
                  <div className="text-xs text-[#68716c]">
                    {(document.sizeBytes / 1024).toFixed(1)} KB ·{' '}
                    {document.extractedSignals.join(', ') || 'metadata only'}
                  </div>
                </div>
                <span className="h-fit rounded bg-[#eef1ed] px-2 py-1 text-xs font-semibold text-[#4f5f57]">
                  {document.mimeType}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Toggle
            checked={draft.certificateOfService}
            label="Service"
            onChange={(checked) =>
              onDraftChange({ ...draft, certificateOfService: checked })
            }
          />
          <Toggle
            checked={draft.certificateOfCompliance}
            label="Compliance"
            onChange={(checked) =>
              onDraftChange({ ...draft, certificateOfCompliance: checked })
            }
          />
          <Toggle
            checked={draft.sealed}
            label="Sealed"
            onChange={(checked) => onDraftChange({ ...draft, sealed: checked })}
          />
        </div>

        <label className="mt-4 block space-y-2 text-sm font-medium">
          Filing notes
          <textarea
            className="min-h-28 w-full rounded-md border border-[#c9c1b3] bg-white p-3"
            onChange={(event) => onDraftChange({ ...draft, notes: event.target.value })}
            value={draft.notes}
          />
        </label>

        <div className="mt-4 flex justify-end">
          <button
            className="flex h-11 items-center gap-2 rounded-md bg-[#1d4d4f] px-4 text-sm font-semibold text-white hover:bg-[#173e40] disabled:cursor-not-allowed disabled:bg-[#9aa6a2]"
            disabled={errors.length > 0}
            onClick={onSubmit}
            type="button"
          >
            <FileCheck2 className="h-4 w-4" aria-hidden="true" />
            Submit Filing
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7] p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Validation
        </div>
        <div className="space-y-3">
          {validationIssues.length ? (
            validationIssues.map((issue, index) => (
              <ValidationItem issue={issue} key={`${issue.message}-${index}`} />
            ))
          ) : (
            <div className="rounded-md border border-[#c8dfcb] bg-[#eff8f0] p-3 text-sm text-[#285b38]">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Ready for filing
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex h-11 items-center justify-between rounded-md border border-[#c9c1b3] bg-white px-3 text-sm font-semibold">
      {label}
      <input
        checked={checked}
        className="h-4 w-4 accent-[#1d4d4f]"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  )
}

function ValidationItem({ issue }: { issue: ValidationIssue }) {
  const Icon =
    issue.severity === 'error'
      ? XCircle
      : issue.severity === 'warning'
        ? AlertTriangle
        : CircleDashed
  const tone =
    issue.severity === 'error'
      ? 'border-[#edc6bc] bg-[#fff1ee] text-[#8a321f]'
      : issue.severity === 'warning'
        ? 'border-[#ead7a7] bg-[#fff8e5] text-[#785b16]'
        : 'border-[#cdd8e8] bg-[#f0f5ff] text-[#334f7c]'

  return (
    <div className={`rounded-md border p-3 text-sm ${tone}`}>
      <div className="flex gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div>
          <div className="font-semibold capitalize">{issue.severity}</div>
          <p className="mt-1 leading-5">{issue.message}</p>
          {issue.ruleRefs.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {issue.ruleRefs.map((rule) => (
                <span
                  className="rounded border border-current px-2 py-0.5 text-xs"
                  key={rule.ruleId}
                >
                  {rule.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function RulesView({
  ruleItems,
  courtPackId,
}: {
  ruleItems: ReturnType<typeof getRuleItemsForCourt>
  courtPackId: string
}) {
  return (
    <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7]">
      <div className="border-b border-[#d8d1c4] p-4">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
          <Library className="h-4 w-4" aria-hidden="true" />
          {courtPackId}
        </div>
      </div>
      <div className="grid divide-y divide-[#e2dbcf]">
        {ruleItems.map((rule) => (
          <article className="grid gap-4 p-4 lg:grid-cols-[220px_1fr]" key={rule.ruleId}>
            <div>
              <a
                className="font-semibold text-[#1d4d4f]"
                href={rule.sourceUrl}
                rel="noreferrer"
                target="_blank"
              >
                {rule.ruleId}
              </a>
              <div className="mt-1 text-xs uppercase tracking-[0.08em] text-[#68716c]">
                {rule.topic}
              </div>
              <div className="mt-2 text-xs text-[#68716c]">
                Effective {rule.effectiveFrom}
              </div>
            </div>
            <div>
              <p className="leading-6">{rule.plainText}</p>
              <p className="mt-2 text-sm leading-6 text-[#59625d]">
                {rule.simulatorNotes}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {rule.structuredConstraints.map((constraint) => (
                  <span
                    className="rounded border border-[#d8d1c4] bg-white px-2 py-1 text-xs font-semibold"
                    key={`${rule.ruleId}-${constraint.kind}-${constraint.value}`}
                  >
                    {constraint.kind.replaceAll('_', ' ')}: {constraint.value}
                  </span>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function ScenariosView({
  scenarios,
  selectedScenarioId,
  onStartScenario,
}: {
  scenarios: Scenario[]
  selectedScenarioId: string
  onStartScenario: (scenarioId: string) => void
}) {
  return (
    <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7]">
      <div className="border-b border-[#d8d1c4] p-4">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
          <Gavel className="h-4 w-4" aria-hidden="true" />
          Scenario Library
        </div>
      </div>
      <div className="divide-y divide-[#e2dbcf]">
        {scenarios.map((scenario) => (
          <article
            className="grid gap-3 p-4 lg:grid-cols-[1fr_auto]"
            key={scenario.id}
          >
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">{scenario.title}</h2>
                <span className="rounded bg-[#eef1ed] px-2 py-1 text-xs font-semibold text-[#4f5f57]">
                  {scenario.source.replaceAll('_', ' ')}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-[#59625d]">
                {scenario.proceduralPosture}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {scenario.issuesPresented.map((issue) => (
                  <span
                    className="rounded border border-[#d8d1c4] bg-white px-2 py-1 text-xs"
                    key={issue}
                  >
                    {issue}
                  </span>
                ))}
              </div>
            </div>
            <button
              className="flex h-10 items-center justify-center gap-2 rounded-md border border-[#1d4d4f] px-3 text-sm font-semibold text-[#1d4d4f] hover:bg-white disabled:border-[#b9c2bf] disabled:text-[#7d8884]"
              disabled={scenario.id === selectedScenarioId}
              onClick={() => onStartScenario(scenario.id)}
              type="button"
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Start
            </button>
          </article>
        ))}
      </div>
    </section>
  )
}

function TrialDocketView({
  courtListenerEnabled,
  courtListenerUnavailableReason,
  trialDocket,
  recapQuery,
  recapError,
  recapPending,
  recapResults,
  onQueryChange,
  onImportResult,
  onSearchRecap,
}: {
  courtListenerEnabled: boolean
  courtListenerUnavailableReason: string
  trialDocket: TrialDocket
  recapQuery: string
  recapError: string
  recapPending: boolean
  recapResults: CourtListenerSearchResult[]
  onQueryChange: (query: string) => void
  onImportResult: (result: CourtListenerSearchResult) => void
  onSearchRecap: () => void
}) {
  return (
    <div className="space-y-4">
      <CurrentTrialDocket trialDocket={trialDocket} />

      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7] p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
            <Search className="h-4 w-4" aria-hidden="true" />
            Find Another Trial Docket
          </div>
          <label className="block space-y-2 text-sm font-medium">
            CourtListener or RECAP query
            <input
              className="h-11 w-full rounded-md border border-[#c9c1b3] bg-white px-3"
              disabled={!courtListenerEnabled}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onSearchRecap()
              }}
              value={recapQuery}
            />
          </label>
          <button
            className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#5d5c28] px-4 text-sm font-semibold text-white hover:bg-[#4b4a20] disabled:cursor-not-allowed disabled:bg-[#aaa982]"
            disabled={recapPending || !courtListenerEnabled}
            onClick={onSearchRecap}
            type="button"
          >
            <Archive className="h-4 w-4" aria-hidden="true" />
            {recapPending ? 'Searching CourtListener' : 'Search Trial Dockets'}
          </button>
          {recapError ? (
            <p className="mt-3 text-sm font-medium text-[#8a321f]">{recapError}</p>
          ) : null}
          {!courtListenerEnabled ? (
            <p className="mt-3 text-sm font-medium text-[#68716c]">
              {courtListenerUnavailableReason}
            </p>
          ) : null}
        </section>

        <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7]">
          <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-[#d8d1c4] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
              <Search className="h-4 w-4" aria-hidden="true" />
              Docket Results
            </div>
            {recapResults.length ? (
              <span className="rounded bg-[#eef1ed] px-2 py-1 text-xs font-semibold text-[#4f5f57]">
                {recapResults.length} results
              </span>
            ) : null}
          </div>
          <div className="divide-y divide-[#e2dbcf]">
            {recapResults.map((result) => (
              <TrialDocketResult
                key={`${result.id}-${result.docket_id ?? 'docket'}`}
                courtListenerEnabled={courtListenerEnabled}
                result={result}
                onImportResult={onImportResult}
              />
            ))}
            {!recapPending && !recapResults.length ? (
              <div className="p-4 text-sm leading-6 text-[#68716c]">
                Search CourtListener to open a public trial docket or import a source
                reference into the simulator docket.
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}

function CurrentTrialDocket({ trialDocket }: { trialDocket: TrialDocket }) {
  return (
    <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7]">
      <div className="grid gap-3 border-b border-[#d8d1c4] p-4 lg:grid-cols-[1fr_auto]">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
            <ListTree className="h-4 w-4" aria-hidden="true" />
            Current Trial Docket
          </div>
          <h2 className="mt-1 text-xl font-semibold">{trialDocket.caption}</h2>
          <div className="mt-1 text-sm text-[#59625d]">
            {[trialDocket.court, trialDocket.docketNumber].filter(Boolean).join(' | ')}
          </div>
        </div>
        {trialDocket.sourceUrl ? (
          <a
            className="flex h-10 items-center justify-center gap-2 rounded-md bg-[#1d4d4f] px-3 text-sm font-semibold text-white hover:bg-[#173f41]"
            href={trialDocket.sourceUrl}
            rel="noreferrer"
            target="_blank"
          >
            <ListTree className="h-4 w-4" aria-hidden="true" />
            Open Source
          </a>
        ) : null}
      </div>
      <div>
        <div className="hidden grid-cols-[80px_160px_1fr] border-b border-[#d8d1c4] px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-[#68716c] md:grid">
          <div>No.</div>
          <div>Date</div>
          <div>Entry</div>
        </div>
        <div className="divide-y divide-[#e2dbcf]">
          {trialDocket.entries.map((entry) => (
            <article
              className="grid grid-cols-1 gap-2 px-4 py-4 text-sm md:grid-cols-[80px_160px_1fr]"
              key={`${entry.entryNumber}-${entry.title}`}
            >
              <div className="font-mono text-[#68716c]">{entry.entryNumber}</div>
              <div className="text-[#59625d]">
                {new Date(entry.filedAt).toLocaleDateString()}
              </div>
              <div>
                <div className="font-semibold">{entry.title}</div>
                <p className="mt-2 leading-6 text-[#3e4843]">{entry.text}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

function TrialDocketResult({
  courtListenerEnabled,
  result,
  onImportResult,
}: {
  courtListenerEnabled: boolean
  result: CourtListenerSearchResult
  onImportResult: (result: CourtListenerSearchResult) => void
}) {
  const docketUrl = courtListenerDocketUrl(result)

  return (
    <article className="grid gap-3 p-4 text-sm lg:grid-cols-[minmax(0,1fr)_220px]">
      <div className="min-w-0">
        <div className="font-semibold">
          {result.caseNameFull ?? result.caseName ?? 'Untitled docket'}
        </div>
        <div className="mt-1 text-xs leading-5 text-[#68716c]">
          {[result.docketNumber, result.court, result.dateFiled]
            .filter(Boolean)
            .join(' | ')}
        </div>
        {result.snippet ? (
          <p className="mt-2 line-clamp-3 text-xs leading-5 text-[#59625d]">
            {stripHtml(result.snippet)}
          </p>
        ) : null}
      </div>
      <div className="grid content-start gap-2">
        {docketUrl ? (
          <a
            className="flex h-9 items-center justify-center gap-2 rounded-md bg-[#1d4d4f] px-3 text-xs font-semibold text-white hover:bg-[#173f41]"
            href={docketUrl}
            rel="noreferrer"
            target="_blank"
          >
            <ListTree className="h-4 w-4" aria-hidden="true" />
            Open Trial Docket
          </a>
        ) : null}
        <button
          className="flex h-9 items-center justify-center gap-2 rounded-md border border-[#1d4d4f] px-3 text-xs font-semibold text-[#1d4d4f] hover:bg-[#eef6f3] disabled:cursor-not-allowed disabled:border-[#b9c2bf] disabled:text-[#7d8884]"
          disabled={!courtListenerEnabled}
          onClick={() => onImportResult(result)}
          type="button"
        >
          <FileCheck2 className="h-4 w-4" aria-hidden="true" />
          Import Source
        </button>
      </div>
    </article>
  )
}

function courtListenerDocketUrl(result: CourtListenerSearchResult) {
  if (result.absolute_url) {
    return new URL(result.absolute_url, 'https://www.courtlistener.com').toString()
  }

  if (result.docket_id) {
    return `https://www.courtlistener.com/docket/${result.docket_id}/`
  }

  return null
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

function AssessmentView({ session }: { session: CaseSession }) {
  if (!session.assessment) {
    return (
      <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7] p-6">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
          <BadgeCheck className="h-4 w-4" aria-hidden="true" />
          Assessment
        </div>
        <p className="mt-3 text-sm text-[#59625d]">Assessment unlocks after closure.</p>
      </section>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7] p-4">
        <div className="text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
          Result
        </div>
        <div className="mt-3 text-4xl font-semibold">{session.assessment.score}</div>
        <div className="mt-1 text-sm text-[#59625d]">{session.assessment.disposition}</div>
      </section>
      <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7] p-4">
        <AssessmentList title="Procedure" items={session.assessment.proceduralFindings} />
        <AssessmentList title="Merits" items={session.assessment.meritsFindings} />
        <AssessmentList title="Practice Targets" items={session.assessment.nextPracticeTargets} />
      </section>
    </div>
  )
}

function AssessmentList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mb-5 last:mb-0">
      <div className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
        {title}
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <div className="flex gap-2 text-sm leading-6" key={item}>
            <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-[#285b38]" aria-hidden="true" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function toolCallTitle(toolCall: ToolCall) {
  if (toolCall.tool === 'setDeadline') return toolCall.label
  if (toolCall.tool === 'submitToPanel') return 'Submit to Panel'
  if (toolCall.tool === 'disposeCase') return toolCall.disposition
  return toolCall.title
}

function toolCallText(toolCall: ToolCall) {
  if (toolCall.tool === 'setDeadline') {
    return `${toolCall.label}; example offset ${toolCall.offsetDays} days.`
  }
  return toolCall.text
}
