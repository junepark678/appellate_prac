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
  FileCheck2,
  FileText,
  Gavel,
  ListTree,
  Library,
  LogIn,
  PanelTop,
  Scale,
  Search,
  ShieldCheck,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { EcfWizard } from '../components/ecf/EcfWizard'
import { analyzeUploadAndPersistDocuments } from '../application/document-upload'
import {
  getCourtPack,
  getRuleItemsForCourt,
  scenarios,
} from '../modules/registry'
import { ca4CourtSourceVersions } from '../domain/rules/ca4-source-profile'
import {
  evaluateReleaseGate,
  sourceFreshnessStatuses,
} from '../domain/rules/source-governance'
import {
  createInitialSession,
  validateFiling,
} from '../domain/simulation'
import { nextActorWorkProductTask, type ActorWorkProductTask } from '../domain/actors/orchestration'
import {
  defaultFilingMetadata,
  filingDraftToSubmission,
  getAvailableEcfEventDefinitions,
  preflightEcfFiling,
} from '../domain/filing/ecf'
import { createTrialDocket } from '../domain/trial-docket'
import { nextProcedureToolCall } from '../domain/procedure/state-machine'
import { defaultPanelJudgeProfiles, formPanelConference } from '../domain/panel/conference'
import type {
  ActorWorkProduct,
  CaseSession,
  FilingDraft,
  FilingMetadata,
  ParticipantRole,
  Scenario,
  TrialDocket,
  ToolCall,
} from '../domain/types'
import type { CourtListenerSearchResult } from '../integrations/courtlistener'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'

export const Route = createFileRoute('/')({ component: Home })

type ViewKey =
  | 'docket'
  | 'file'
  | 'receipts'
  | 'panel'
  | 'parties'
  | 'trialDocket'
  | 'rules'
  | 'governance'
  | 'scenarios'
  | 'assessment'

type ViewTab = { key: ViewKey; label: string; icon: typeof PanelTop }

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

type SessionSummary = {
  id: string
  scenarioTitle: string
  shortCaption: string
  status: CaseSession['status']
  simulatedDate: string
  createdAt: number
}

function asCaseSessionId(id: string): Id<'caseSessions'> {
  return id as Id<'caseSessions'>
}

function asActorWorkProductId(id: string): Id<'actorWorkProducts'> {
  return id as Id<'actorWorkProducts'>
}

const enableLiveAi = import.meta.env.VITE_ENABLE_OPENROUTER === 'true'
const enableCourtListener = import.meta.env.VITE_ENABLE_COURTLISTENER === 'true'
const enableDebugActorPanel = import.meta.env.VITE_SHOW_DEBUG_ACTOR_PANEL === 'true'
const utcDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
})
const utcDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function formatDateUtc(value: string) {
  return utcDateFormatter.format(new Date(value))
}

function formatDateTimeUtc(value: string) {
  return utcDateTimeFormatter.format(new Date(value))
}

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
  const [actorPending, setActorPending] = useState(false)
  const [actorError, setActorError] = useState('')
  const [documentPending, setDocumentPending] = useState(false)
  const [documentError, setDocumentError] = useState('')
  const [sessionPending, setSessionPending] = useState(false)
  const [sessionError, setSessionError] = useState('')
  const [draft, setDraft] = useState<FilingDraft>(() =>
    createEmptyDraft(createInitialSession(), 'notice_of_appeal'),
  )
  const [filingMetadata, setFilingMetadata] = useState<FilingMetadata>(() =>
    createDefaultMetadata(createInitialSession(), 'notice_of_appeal'),
  )
  const upsertCurrentUser = useMutation(api.users.upsertCurrentUser)
  const createCaseSession = useMutation(api.caseSessions.create)
  const submitFiling = useMutation(api.caseSessions.submitFiling)
  const submitEcfFiling = useMutation(api.caseSessions.submitEcfFiling)
  const advanceProcedure = useMutation(api.caseSessions.advanceProcedure)
  const advanceSimulationTurn = useMutation(api.caseSessions.advanceSimulationTurn)
  const generateDocumentUploadUrl = useMutation(api.caseSessions.generateDocumentUploadUrl)
  const persistDocumentAnalysis = useMutation(api.caseSessions.persistDocumentAnalysis)
  const acceptActorWorkProduct = useMutation(api.caseSessions.acceptActorWorkProduct)
  const rejectActorWorkProduct = useMutation(api.caseSessions.rejectActorWorkProduct)
  const importCourtListenerSource = useMutation(
    api.caseSessions.importCourtListenerSource,
  )
  const advanceLive = useAction(api.caseSessions.advanceLiveEvent) as AdvanceLiveEventAction
  const generateActorWorkProduct = useAction(api.caseSessions.generateActorWorkProduct)
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
    api.scenarios.listAvailableForCurrentUser,
    canUseConvex ? {} : 'skip',
  )
  const integrationStatus = useQuery(
    api.integrations.getIntegrationStatus,
    canUseConvex ? {} : 'skip',
  )
  const importedTrialDocket = useQuery(
    api.caseSessions.getTrialDocketForCurrentUser,
    canUseConvex && session
      ? { caseSessionId: asCaseSessionId(session.id) }
      : 'skip',
  )
  const ecfEventAvailabilityQuery = useQuery(
    api.caseSessions.getAvailableEcfEvents,
    canUseConvex && session
      ? { caseSessionId: asCaseSessionId(session.id) }
      : 'skip',
  )
  const activeSession = session ?? null
  const scenarioOptions = publishedScenarios ?? scenarios
  const ruleItems = activeSession ? getRuleItemsForCourt(activeSession.courtPackId) : []
  const visibleTabs = useMemo(
    () => (activeSession ? navigationTabsForSession(activeSession) : []),
    [activeSession],
  )
  const visibleViewKeys = visibleTabs.map((tab) => tab.key)
  const selectedView =
    activeSession && visibleViewKeys.includes(activeView) ? activeView : 'docket'
  const ecfEventAvailability =
    ecfEventAvailabilityQuery ??
    (activeSession ? getAvailableEcfEventDefinitions(activeSession) : [])
  const activeToolCall = activeSession ? nextProcedureToolCall(activeSession) : null
  const activeActorTask = activeSession ? nextActorWorkProductTask(activeSession) : null
  const validationIssues = useMemo(
    () => {
      if (!activeSession) return []
      const submission = filingDraftToSubmission(draft, filingMetadata)
      return submission
        ? preflightEcfFiling(activeSession, submission).issues
        : validateFiling(activeSession, draft)
    },
    [activeSession, draft, filingMetadata],
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
    setFilingMetadata(createDefaultMetadata(activeSession, 'notice_of_appeal'))
    setTrialDocket(createTrialDocket(activeSession))
  }, [activeSession?.id])

  useEffect(() => {
    if (!activeSession) return
    setTrialDocket(importedTrialDocket ?? createTrialDocket(activeSession))
  }, [activeSession, importedTrialDocket])

  useEffect(() => {
    if (!activeSession || selectedView === activeView) return
    setActiveView(selectedView)
  }, [activeSession, activeView, selectedView])

  function resetDraft(eventId = draft.eventId) {
    if (!activeSession) return
    setDraft(createEmptyDraft(activeSession, eventId))
    setFilingMetadata(createDefaultMetadata(activeSession, eventId))
  }

  async function startScenario(scenarioId: string) {
    setSessionPending(true)
    setSessionError('')
    try {
      const nextSession = await createCaseSession({ scenarioId })
      setActiveCaseSessionId(asCaseSessionId(nextSession.id))
      setTrialDocket(createTrialDocket(nextSession))
      setDraft(createEmptyDraft(nextSession, 'notice_of_appeal'))
      setFilingMetadata(createDefaultMetadata(nextSession, 'notice_of_appeal'))
      setActiveView('docket')
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Unable to create session')
    } finally {
      setSessionPending(false)
    }
  }

  function resumeSession(caseSessionId: string) {
    setActiveCaseSessionId(asCaseSessionId(caseSessionId))
    setActiveView('docket')
    setSessionError('')
  }

  async function submitDraft() {
    if (!activeSession) return
    setSessionPending(true)
    setSessionError('')
    try {
      const submission = filingDraftToSubmission(draft, filingMetadata)
      const nextSession = submission
        ? (
            await submitEcfFiling({
              caseSessionId: asCaseSessionId(activeSession.id),
              submission,
            })
          ).session
        : await submitFiling({
            caseSessionId: asCaseSessionId(activeSession.id),
            draft,
          })
      setDraft(createEmptyDraft(nextSession, draft.eventId))
      setFilingMetadata(createDefaultMetadata(nextSession, draft.eventId))
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
      const result = await advanceProcedure({
        caseSessionId: asCaseSessionId(activeSession.id),
      })
      const nextSession = result.session
      if (nextSession.status === 'closed') {
        setActiveView('assessment')
      }
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Unable to advance event')
    } finally {
      setSessionPending(false)
    }
  }

  async function advanceSimulation() {
    if (!activeSession) return
    setSessionPending(true)
    setSessionError('')
    try {
      const result = await advanceSimulationTurn({
        caseSessionId: asCaseSessionId(activeSession.id),
      })
      if (result.session.status === 'closed') {
        setActiveView('assessment')
      }
    } catch (error) {
      setSessionError(
        error instanceof Error ? error.message : 'Unable to advance simulation turn',
      )
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
        caseSessionId: asCaseSessionId(activeSession.id),
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

  async function generateNextActorWorkProduct() {
    if (!activeSession) return
    if (!liveAiReady) {
      setActorError(liveAiUnavailableReason)
      return
    }
    setActorPending(true)
    setActorError('')
    try {
      await generateActorWorkProduct({
        caseSessionId: asCaseSessionId(activeSession.id),
      })
    } catch (error) {
      setActorError(
        error instanceof Error ? error.message : 'Actor work product generation failed',
      )
    } finally {
      setActorPending(false)
    }
  }

  async function acceptWorkProduct(workProductId: string) {
    if (!activeSession) return
    setActorPending(true)
    setActorError('')
    try {
      const result = await acceptActorWorkProduct({
        caseSessionId: asCaseSessionId(activeSession.id),
        workProductId: asActorWorkProductId(workProductId),
      })
      if (result.workProduct.status === 'rejected') {
        setActorError(result.validationReason ?? 'Actor work product was rejected.')
      }
      if (result.session.status === 'closed') {
        setActiveView('assessment')
      }
    } catch (error) {
      setActorError(
        error instanceof Error ? error.message : 'Unable to accept actor work product',
      )
    } finally {
      setActorPending(false)
    }
  }

  async function rejectWorkProduct(workProductId: string) {
    if (!activeSession) return
    setActorPending(true)
    setActorError('')
    try {
      await rejectActorWorkProduct({
        caseSessionId: asCaseSessionId(activeSession.id),
        workProductId: asActorWorkProductId(workProductId),
      })
    } catch (error) {
      setActorError(
        error instanceof Error ? error.message : 'Unable to reject actor work product',
      )
    } finally {
      setActorPending(false)
    }
  }

  async function analyzeAndAttachDocuments(files: FileList | null) {
    if (!activeSession) return
    setDocumentPending(true)
    setDocumentError('')
    try {
      const documents = await analyzeUploadAndPersistDocuments(
        { generateDocumentUploadUrl, persistDocumentAnalysis },
        asCaseSessionId(activeSession.id),
        files,
      )
      setDraft((current) => ({ ...current, documents: [...current.documents, ...documents] }))
    } catch (error) {
      setDocumentError(
        error instanceof Error
          ? error.message
          : 'PDF analysis failed. The document was not attached.',
      )
    } finally {
      setDocumentPending(false)
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
        caseSessionId: asCaseSessionId(activeSession.id),
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
                  {formatLabel(activeSession.status)}
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
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
                <aside className="space-y-4">
                  <CasePanel session={activeSession} />
                  <DeadlinePanel session={activeSession} />
                  <JurisdictionPanel courtPackId={activeSession.courtPackId} />
                </aside>

                <section className="min-w-0">
                  <ViewTabs
                    activeView={selectedView}
                    tabs={visibleTabs}
                    onSelect={setActiveView}
                  />

                  {selectedView === 'docket' && activeToolCall ? (
                    <DocketView
                      session={activeSession}
                      activeToolCall={activeToolCall}
                      activeActorTask={activeActorTask}
                      busy={sessionPending}
                      aiError={aiError}
                      aiPending={aiPending}
                      actorError={actorError}
                      actorPending={actorPending}
                      liveAiEnabled={liveAiReady}
                      liveAiUnavailableReason={liveAiUnavailableReason}
                      onAdvanceExpected={advanceExpectedEvent}
                      onAdvanceSimulationTurn={advanceSimulation}
                      onAdvanceLive={advanceLiveEvent}
                      onGenerateActorWorkProduct={generateNextActorWorkProduct}
                    />
                  ) : null}

                  {selectedView === 'file' ? (
                    <EcfWizard
                      draft={draft}
                      busy={sessionPending}
                      documentError={documentError}
                      documentPending={documentPending}
                      eventAvailability={ecfEventAvailability}
                      learnerRole={learnerRole}
                      metadata={filingMetadata}
                      session={activeSession}
                      validationIssues={validationIssues}
                      onDraftChange={setDraft}
                      onDocumentsSelected={analyzeAndAttachDocuments}
                      onMetadataChange={setFilingMetadata}
                      onReset={resetDraft}
                      onSubmit={submitDraft}
                    />
                  ) : null}

                  {selectedView === 'receipts' ? (
                    <ReceiptView session={activeSession} />
                  ) : null}

                  {selectedView === 'panel' ? (
                    <PanelView
                      actorBusy={actorPending}
                      actorError={actorError}
                      session={activeSession}
                      onAcceptWorkProduct={acceptWorkProduct}
                      onRejectWorkProduct={rejectWorkProduct}
                    />
                  ) : null}

                  {selectedView === 'parties' ? (
                    <PartiesView
                      actorBusy={actorPending}
                      actorError={actorError}
                      session={activeSession}
                      onAcceptWorkProduct={acceptWorkProduct}
                      onRejectWorkProduct={rejectWorkProduct}
                    />
                  ) : null}

                  {selectedView === 'rules' ? (
                    <RulesView
                      ruleItems={ruleItems}
                      courtPackId={activeSession.courtPackId}
                    />
                  ) : null}

                  {selectedView === 'governance' ? (
                    <SourceGovernanceView courtPackId={activeSession.courtPackId} />
                  ) : null}

                  {selectedView === 'trialDocket' ? (
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

                  {selectedView === 'scenarios' ? (
                    <ScenariosView
                      scenarios={scenarioOptions}
                      selectedScenarioId={activeSession.scenario.id}
                      onStartScenario={startScenario}
                    />
                  ) : null}

                  {selectedView === 'assessment' ? (
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
            {session.shortCaption} - {formatDateUtc(session.simulatedDate)}
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
                <span className="text-xs text-[#68716c]">
                  {formatLabel(session.status)} - {formatDateUtc(session.simulatedDate)}
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
                {scenario.training ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded bg-[#eef1ed] px-2 py-1 text-xs font-semibold text-[#4f5f57]">
                      {formatLabel(scenario.training.difficulty)}
                    </span>
                    {scenario.training.practiceFocus.slice(0, 3).map((focus) => (
                      <span
                        className="rounded border border-[#d8d1c4] bg-white px-2 py-1 text-xs"
                        key={`${scenario.id}-${focus}`}
                      >
                        {formatLabel(focus)}
                      </span>
                    ))}
                  </div>
                ) : null}
                <p className="mt-2 text-sm leading-6 text-[#59625d]">
                  {scenario.proceduralPosture}
                </p>
                {scenario.training?.learningObjectives.length ? (
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-[#68716c]">
                    {scenario.training.learningObjectives.slice(0, 2).join(' ')}
                  </p>
                ) : null}
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
  const event = getCourtPack(session.courtPackId).filingEvents.find(
    (candidate) => candidate.id === eventId,
  )
  return {
    eventId,
    participantRole: learnerRole,
    title: event?.label ?? 'Filing',
    documents: [],
    certificateOfService: true,
    certificateOfCompliance: eventId.includes('brief'),
    sealed: false,
    notes: '',
  }
}

function createDefaultMetadata(session: CaseSession, eventId: string): FilingMetadata {
  const event = getCourtPack(session.courtPackId).filingEvents.find(
    (candidate) => candidate.id === eventId,
  )
  const representedParty = session.participants.find((participant) =>
    event?.allowedParticipantRoles.includes(participant.role),
  )
  const sealed = event?.ecfCategory === 'sealed' || eventId.includes('seal')
  return {
    ...defaultFilingMetadata(eventId, sealed),
    representedPartyId: representedParty?.id ?? learnerRole,
    feePaymentStatus: event?.feeBehavior === 'required' ? 'pending' : 'not_required',
  }
}

function statusClass(status: CaseSession['status'] | 'active') {
  const base = 'rounded-md px-3 py-2 text-sm font-semibold'
  if (status === 'closed') return `${base} bg-[#dceadf] text-[#285b38]`
  if (status === 'submitted') return `${base} bg-[#e5e2f4] text-[#443a7a]`
  if (status === 'dismissed') return `${base} bg-[#f1dad2] text-[#8a321f]`
  return `${base} bg-[#e6eee9] text-[#1d4d4f]`
}

function acceptedFilings(session: CaseSession) {
  return session.filings.filter((filing) => filing.outcome !== 'rejected')
}

function hasAcceptedFiling(session: CaseSession, eventId?: string) {
  return acceptedFilings(session).some((filing) =>
    eventId ? filing.eventId === eventId : true,
  )
}

function hasPanelActivity(session: CaseSession) {
  return Boolean(
    session.status === 'submitted' ||
      session.status === 'closed' ||
      session.panelAssignment ||
      session.benchMemo ||
      session.panelDeliberation ||
      session.panelDisposition ||
      session.actorWorkProducts?.some((product) =>
        ['bench_memo', 'judge_vote_memo', 'panel_disposition_draft'].includes(product.kind),
      ),
  )
}

function hasPartyActivity(session: CaseSession) {
  return Boolean(
    session.counterpartyStrategy ||
      (session.amicusParticipation?.candidates.length ?? 0) > 0 ||
      session.actorWorkProducts?.some((product) =>
        [
          'counterparty_strategy',
          'counterparty_filing_draft',
          'amicus_recommendation',
          'amicus_filing_draft',
        ].includes(product.kind),
      ) ||
      acceptedFilings(session).some((filing) =>
        ['appellee', 'amicus'].includes(filing.participantRole),
      ),
  )
}

function navigationTabsForSession(session: CaseSession): ViewTab[] {
  return [
    { key: 'docket', label: 'Docket', icon: PanelTop },
    { key: 'file', label: 'File', icon: Upload },
    ...((session.ecfReceipts?.length ?? 0) > 0
      ? [{ key: 'receipts' as const, label: 'Receipts', icon: FileCheck2 }]
      : []),
    ...(hasPartyActivity(session)
      ? [{ key: 'parties' as const, label: 'Parties', icon: Users }]
      : []),
    ...(hasPanelActivity(session)
      ? [{ key: 'panel' as const, label: 'Panel', icon: Gavel }]
      : []),
    { key: 'trialDocket', label: 'Trial Record', icon: ListTree },
    { key: 'rules', label: 'Rules', icon: Library },
    { key: 'governance', label: 'Sources', icon: ShieldCheck },
    { key: 'scenarios', label: 'Scenarios', icon: Search },
    ...(session.assessment
      ? [{ key: 'assessment' as const, label: 'Assessment', icon: BadgeCheck }]
      : []),
  ]
}

function formatLabel(value: string) {
  return value
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bCa4\b/g, 'CA4')
    .replace(/\bCm\b/g, 'CM')
    .replace(/\bEcf\b/g, 'ECF')
    .replace(/\bPdf\b/g, 'PDF')
    .replace(/\bFrap\b/g, 'FRAP')
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
                {formatDateUtc(deadline.dueDate)}
              </div>
            </div>
            <span className="h-fit rounded bg-[#eef1ed] px-2 py-1 text-xs font-semibold text-[#4f5f57]">
              {formatLabel(deadline.status)}
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
        Court Rules
      </div>
      <div className="space-y-3 text-sm">
        <InfoRow label="Ruleset" value={courtPack.label} />
        <InfoRow label="Docket format" value={courtPack.docketNumberFormat} />
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
  tabs,
  onSelect,
}: {
  activeView: ViewKey
  tabs: ViewTab[]
  onSelect: (view: ViewKey) => void
}) {
  return (
    <nav className="mb-4 flex flex-wrap gap-2">
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
  activeActorTask,
  busy,
  aiError,
  aiPending,
  actorError,
  actorPending,
  liveAiEnabled,
  liveAiUnavailableReason,
  onAdvanceExpected,
  onAdvanceSimulationTurn,
  onAdvanceLive,
  onGenerateActorWorkProduct,
}: {
  session: CaseSession
  activeToolCall: ToolCall
  activeActorTask: ActorWorkProductTask | null
  busy: boolean
  aiError: string
  aiPending: boolean
  actorError: string
  actorPending: boolean
  liveAiEnabled: boolean
  liveAiUnavailableReason: string
  onAdvanceExpected: () => void
  onAdvanceSimulationTurn: () => void
  onAdvanceLive: () => void
  onGenerateActorWorkProduct: () => void
}) {
  return (
    <div className="space-y-4">
      <WorkflowStatusGrid session={session} />
      <SimulationTurnsTimeline session={session} />

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
          <div className="grid gap-2 sm:grid-cols-2 lg:w-[560px]">
            <button
              className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-[#1d4d4f] px-4 text-sm font-semibold text-white hover:bg-[#173f41] disabled:cursor-not-allowed disabled:bg-[#9aa6a2] sm:col-span-2"
              disabled={session.status === 'closed' || busy || aiPending}
              onClick={onAdvanceSimulationTurn}
              type="button"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
              Advance Simulation Turn
            </button>
            <button
              className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-[#1d4d4f] px-4 text-sm font-semibold text-[#1d4d4f] hover:bg-white disabled:cursor-not-allowed disabled:border-[#9aa6a2] disabled:text-[#9aa6a2]"
              disabled={session.status === 'closed' || busy || aiPending || !liveAiEnabled}
              onClick={onAdvanceLive}
              type="button"
            >
              <Bot className="h-4 w-4" aria-hidden="true" />
              {aiPending ? 'Calling AI' : 'Live AI Event'}
            </button>
            <button
              className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-[#8b3f2f] px-4 text-sm font-semibold text-[#8b3f2f] hover:bg-white disabled:cursor-not-allowed disabled:border-[#b9988f] disabled:text-[#b9988f]"
              disabled={session.status === 'closed' || busy || aiPending}
              onClick={onAdvanceExpected}
              type="button"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
              Procedure Event
            </button>
          </div>
        </div>
      </section>

      {enableDebugActorPanel && activeActorTask ? (
        <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
                <Bot className="h-4 w-4" aria-hidden="true" />
                Actor Work Product
              </div>
              <div className="mt-1 text-lg font-semibold">{activeActorTask.label}</div>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-[#59625d]">
                {formatLabel(activeActorTask.actorId)} will draft a source-linked {formatLabel(activeActorTask.kind)} for review.
              </p>
              {actorError ? (
                <p className="mt-2 text-sm font-medium text-[#8a321f]">{actorError}</p>
              ) : null}
            </div>
            <button
              className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-[#5d5c28] px-4 text-sm font-semibold text-white hover:bg-[#4b4a20] disabled:cursor-not-allowed disabled:bg-[#aaa982]"
              disabled={actorPending || !liveAiEnabled}
              onClick={onGenerateActorWorkProduct}
              type="button"
            >
              <Bot className="h-4 w-4" aria-hidden="true" />
              {actorPending ? 'Drafting' : 'Generate Work Product'}
            </button>
          </div>
        </section>
      ) : null}

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
                {formatDateUtc(entry.filedAt)}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{entry.title}</span>
                  <span className="rounded bg-[#eef1ed] px-2 py-1 text-xs font-semibold text-[#4f5f57]">
                    {formatLabel(entry.actorRole)}
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

function WorkflowStatusGrid({ session }: { session: CaseSession }) {
  const counterparty = session.counterpartyStrategy
  const amicus = session.amicusParticipation
  const panelVotes = session.panelDeliberation?.votes.length ?? 0
  const latestReceipt = session.ecfReceipts?.at(-1)
  const amicusCount = amicus?.candidates.length ?? 0
  const noticeFiled = hasAcceptedFiling(session, 'notice_of_appeal')
  const tiles: Array<{
    icon: typeof PanelTop
    title: string
    value: string
    detail: string
  }> = []

  if (noticeFiled && latestReceipt) {
    tiles.push({
      icon: FileCheck2,
      title: 'Latest Receipt',
      value: latestReceipt.receiptNumber,
      detail: latestReceipt.nextExpectedDeadline?.label ?? 'Accepted ECF filing received.',
    })
  }

  if (counterparty || amicusCount > 0) {
    tiles.push({
      icon: Users,
      title: 'Parties',
      value:
        counterparty?.recommendedNextFilingEventId
          ? `Next: ${formatLabel(counterparty.recommendedNextFilingEventId)}`
          : amicusCount > 0
            ? `${amicusCount} Amicus Candidate${amicusCount === 1 ? '' : 's'}`
            : 'Appellee Strategy Ready',
      detail:
        counterparty?.forfeitureArguments.at(0) ??
        amicus?.candidates.at(0)?.rationale ??
        'Party activity is available for this posture.',
    })
  }

  if (hasPanelActivity(session)) {
    tiles.push({
      icon: Gavel,
      title: 'Panel',
      value: session.panelDisposition?.disposition
        ? formatLabel(session.panelDisposition.disposition)
        : session.panelAssignment
          ? `${panelVotes}/3 Votes`
          : 'Ready for Submission',
      detail: session.benchMemo?.recommendedDisposition ?? 'Panel activity has begun.',
    })
  }

  if (!tiles.length) return null

  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {tiles.map((tile) => (
        <StatusTile
          detail={tile.detail}
          icon={tile.icon}
          key={tile.title}
          title={tile.title}
          value={tile.value}
        />
      ))}
    </section>
  )
}

function SimulationTurnsTimeline({ session }: { session: CaseSession }) {
  const turns = session.simulationTurns ?? []
  if (!turns.length) return null

  return (
    <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7]">
      <div className="border-b border-[#d8d1c4] p-4">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
          <Bot className="h-4 w-4" aria-hidden="true" />
          Simulation Turns
        </div>
      </div>
      <div className="divide-y divide-[#e2dbcf]">
        {turns.slice(-8).map((turn) => (
          <article
            className="grid gap-3 p-4 text-sm lg:grid-cols-[140px_180px_1fr]"
            key={turn.id}
          >
            <div>
              <div className="font-mono text-[#68716c]">Turn {turn.turnNumber}</div>
              <div className="mt-1 text-xs text-[#68716c]">
                {formatDateUtc(turn.startedAt)}
              </div>
            </div>
            <div>
              <div className="font-semibold">{formatLabel(turn.actorId)}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="rounded bg-[#eef1ed] px-2 py-1 text-xs font-semibold text-[#4f5f57]">
                  {formatLabel(turn.kind)}
                </span>
                <span className="rounded border border-[#d8d1c4] bg-white px-2 py-1 text-xs font-semibold">
                  {formatLabel(turn.status)}
                </span>
              </div>
            </div>
            <div className="space-y-1 leading-6 text-[#59625d]">
              {turn.effects.map((effect) => (
                <div key={`${turn.id}-${effect}`}>{effect}</div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function StatusTile({
  icon: Icon,
  title,
  value,
  detail,
}: {
  icon: typeof PanelTop
  title: string
  value: string
  detail: string
}) {
  return (
    <article className="min-h-32 rounded-lg border border-[#d8d1c4] bg-[#fbfaf7] p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
        <Icon className="h-4 w-4" aria-hidden="true" />
        {title}
      </div>
      <div className="truncate font-semibold">{value}</div>
      <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#59625d]">{detail}</p>
    </article>
  )
}

function ReceiptView({ session }: { session: CaseSession }) {
  const receipts = session.ecfReceipts ?? []
  return (
    <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7]">
      <div className="border-b border-[#d8d1c4] p-4">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
          <FileCheck2 className="h-4 w-4" aria-hidden="true" />
          ECF Receipts
        </div>
      </div>
      <div className="divide-y divide-[#e2dbcf]">
        {receipts.length ? (
          receipts.map((receipt) => (
            <article className="grid gap-3 p-4 text-sm lg:grid-cols-[240px_1fr]" key={receipt.id}>
              <div>
                <div className="font-mono font-semibold">{receipt.receiptNumber}</div>
                <div className="mt-1 text-xs text-[#68716c]">
                  {formatDateTimeUtc(receipt.createdAt)}
                </div>
                <div className="mt-2 rounded bg-[#eef1ed] px-2 py-1 text-xs font-semibold text-[#4f5f57]">
                  {formatLabel(receipt.eventId ?? 'filing')}
                </div>
              </div>
              <div>
                <p className="leading-6 text-[#3e4843]">{receipt.docketText ?? receipt.noticeOfDocketActivityText}</p>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <InfoRow label="Filer" value={formatLabel(receipt.filer ?? 'appellant')} />
                  <InfoRow label="Service" value={receipt.serviceList.join(', ') || 'None'} />
                  <InfoRow label="Next deadline" value={receipt.nextExpectedDeadline?.label ?? 'None'} />
                </div>
                {receipt.documentList?.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {receipt.documentList.map((document) => (
                      <span
                        className="rounded border border-[#d8d1c4] bg-white px-2 py-1 text-xs"
                        key={`${receipt.id}-${document.fileName}`}
                      >
                        {formatLabel(document.attachmentType)}: {document.fileName}
                      </span>
                    ))}
                  </div>
                ) : null}
                {[...(receipt.warnings ?? []), ...(receipt.deficiencies ?? [])].length ? (
                  <div className="mt-3 space-y-1 text-xs font-medium text-[#8a321f]">
                    {[...(receipt.warnings ?? []), ...(receipt.deficiencies ?? [])].map((item) => (
                      <div key={item}>{item}</div>
                    ))}
                  </div>
                ) : null}
              </div>
            </article>
          ))
        ) : (
          <EmptyState text="No accepted ECF filings have generated receipts yet." />
        )}
      </div>
    </section>
  )
}

function PanelView({
  actorBusy,
  actorError,
  session,
  onAcceptWorkProduct,
  onRejectWorkProduct,
}: {
  actorBusy: boolean
  actorError: string
  session: CaseSession
  onAcceptWorkProduct: (workProductId: string) => void
  onRejectWorkProduct: (workProductId: string) => void
}) {
  const votes = session.panelDeliberation?.votes ?? []
  const conference = formPanelConference(session)
  const panelWorkProducts = (session.actorWorkProducts ?? []).filter((product) =>
    ['bench_memo', 'judge_vote_memo', 'panel_disposition_draft'].includes(product.kind),
  )
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7] p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
            <Gavel className="h-4 w-4" aria-hidden="true" />
            Panel Status
          </div>
          <div className="space-y-3 text-sm">
            <InfoRow
              label="Assignment"
              value={
                session.panelAssignment?.judgeActorIds.map(formatLabel).join(', ') ??
                'Not Assigned'
              }
            />
            <InfoRow
              label="Presiding judge"
              value={
                session.panelAssignment?.presidingJudgeActorId
                  ? formatLabel(session.panelAssignment.presidingJudgeActorId)
                  : 'Pending'
              }
            />
            <InfoRow
              label="Oral argument"
              value={
                session.panelAssignment?.oralArgumentDisposition
                  ? formatLabel(session.panelAssignment.oralArgumentDisposition)
                  : 'Pending'
              }
            />
            <InfoRow
              label="Disposition"
              value={
                session.panelDisposition?.disposition
                  ? formatLabel(session.panelDisposition.disposition)
                  : 'Pending'
              }
            />
            <InfoRow
              label="Mandate"
              value={
                session.panelDeliberation?.mandateStatus
                  ? formatLabel(session.panelDeliberation.mandateStatus)
                  : 'Not Started'
              }
            />
            <InfoRow
              label="Conference"
              value={conference ? `Majority: ${formatLabel(conference.majorityResult)}` : 'Pending'}
            />
          </div>
        </section>
        <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7]">
        <div className="border-b border-[#d8d1c4] p-4">
          <div className="text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
            Deliberation
          </div>
        </div>
        <div className="divide-y divide-[#e2dbcf]">
          {session.benchMemo ? (
            <article className="p-4 text-sm">
              <div className="font-semibold">Staff attorney memo</div>
              <p className="mt-2 leading-6 text-[#59625d]">
                Recommended disposition: {formatLabel(session.benchMemo.recommendedDisposition)}.
              </p>
              <div className="mt-3 space-y-2">
                {session.benchMemo.issueSummaries.map((summary) => (
                  <div className="rounded-md border border-[#e2dbcf] bg-white p-3" key={summary}>
                    {summary}
                  </div>
                ))}
              </div>
            </article>
          ) : (
            <EmptyState text="No staff memo has been prepared yet." />
          )}
          {session.panelAssignment ? (
            <article className="p-4 text-sm">
              <div className="font-semibold">Judge profiles</div>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {defaultPanelJudgeProfiles
                  .filter((profile) =>
                    session.panelAssignment?.judgeActorIds.includes(profile.actorId),
                  )
                  .map((profile) => (
                    <div className="rounded-md border border-[#e2dbcf] bg-white p-3" key={profile.actorId}>
                      <div className="font-semibold">{formatLabel(profile.actorId)}</div>
                      <div className="mt-1 text-xs text-[#68716c]">{formatLabel(profile.panelRole)}</div>
                      <div className="mt-2 text-xs leading-5 text-[#59625d]">
                        {formatLabel(profile.decisionStyle)} · Jurisdiction {formatLabel(profile.jurisdictionSensitivity)}
                      </div>
                    </div>
                  ))}
              </div>
            </article>
          ) : null}
          {votes.map((vote) => (
            <article className="p-4 text-sm" key={vote.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{vote.judgeActorId}</span>
                <span className="rounded bg-[#eef1ed] px-2 py-1 text-xs font-semibold text-[#4f5f57]">
                  {formatLabel(vote.vote)}
                </span>
                {vote.joinsMajority ? (
                  <span className="rounded bg-[#dceadf] px-2 py-1 text-xs font-semibold text-[#285b38]">
                    Majority
                  </span>
                ) : null}
              </div>
              <p className="mt-2 leading-6 text-[#59625d]">{vote.rationale}</p>
            </article>
          ))}
          {session.panelDisposition ? (
            <article className="p-4 text-sm">
              <div className="font-semibold">Judgment</div>
              <p className="mt-2 leading-6 text-[#59625d]">{session.panelDisposition.judgmentText}</p>
              {session.panelDisposition.separateOpinions.length ? (
                <div className="mt-3 space-y-2">
                  {session.panelDisposition.separateOpinions.map((opinion) => (
                    <div className="rounded-md border border-[#e2dbcf] bg-white p-3" key={`${opinion.judgeActorId}-${opinion.type}`}>
                      <div className="font-semibold">{formatLabel(opinion.type)} by {formatLabel(opinion.judgeActorId)}</div>
                      <p className="mt-1 leading-5 text-[#59625d]">{opinion.text}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          ) : null}
        </div>
        </section>
      </div>
      <WorkProductsSection
        actorBusy={actorBusy}
        actorError={actorError}
        products={panelWorkProducts}
        session={session}
        title="Panel AI Work Products"
        onAcceptWorkProduct={onAcceptWorkProduct}
        onRejectWorkProduct={onRejectWorkProduct}
      />
    </div>
  )
}

function PartiesView({
  actorBusy,
  actorError,
  session,
  onAcceptWorkProduct,
  onRejectWorkProduct,
}: {
  actorBusy: boolean
  actorError: string
  session: CaseSession
  onAcceptWorkProduct: (workProductId: string) => void
  onRejectWorkProduct: (workProductId: string) => void
}) {
  const strategy = session.counterpartyStrategy
  const candidates = session.amicusParticipation?.candidates ?? []
  const appelleeFilings = acceptedFilings(session).filter(
    (filing) => filing.participantRole === 'appellee',
  )
  const partyWorkProducts = (session.actorWorkProducts ?? []).filter((product) =>
    [
      'counterparty_strategy',
      'counterparty_filing_draft',
      'amicus_recommendation',
      'amicus_filing_draft',
    ].includes(product.kind),
  )

  if (!strategy && !candidates.length && !partyWorkProducts.length) {
    return <EmptyState text="Party activity will appear after a relevant accepted filing." />
  }

  return (
    <div className="space-y-4">
      <WorkProductsSection
        actorBusy={actorBusy}
        actorError={actorError}
        products={partyWorkProducts}
        session={session}
        title="Party AI Work Products"
        onAcceptWorkProduct={onAcceptWorkProduct}
        onRejectWorkProduct={onRejectWorkProduct}
      />

      {strategy ? (
        <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7] p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
            <Bot className="h-4 w-4" aria-hidden="true" />
            Appellee Strategy
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <StrategyList title="Preserved Issues" items={strategy.preservedIssues} />
            <StrategyList title="Forfeiture / Waiver" items={strategy.forfeitureArguments} />
            <StrategyList title="Jurisdiction" items={strategy.jurisdictionArguments} />
            <StrategyList title="Merits" items={strategy.meritsArguments} />
            <StrategyList title="Procedural Motions" items={strategy.proceduralMotions} />
            <div className="rounded-md border border-[#e2dbcf] bg-white p-3 text-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#68716c]">
                Recommended Next Event
              </div>
              <div className="mt-1 font-semibold">
                {formatLabel(strategy.recommendedNextFilingEventId ?? 'monitor docket')}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {appelleeFilings.length ? (
        <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7]">
          <div className="border-b border-[#d8d1c4] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
              <Users className="h-4 w-4" aria-hidden="true" />
              Appellee Decision History
            </div>
          </div>
          <div className="divide-y divide-[#e2dbcf]">
            {appelleeFilings.map((filing) => (
              <article className="grid gap-2 p-4 text-sm md:grid-cols-[180px_1fr]" key={filing.id}>
                <div>
                  <div className="font-semibold">{formatLabel(filing.eventId)}</div>
                  <div className="mt-1 text-xs text-[#68716c]">
                    {formatDateUtc(filing.filedAt)}
                  </div>
                </div>
                <p className="leading-6 text-[#59625d]">{filing.notes || filing.title}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {candidates.length ? (
        <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7]">
          <div className="border-b border-[#d8d1c4] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Amici
            </div>
          </div>
          <div className="divide-y divide-[#e2dbcf]">
            {candidates.map((candidate) => (
              <article
                className="grid gap-3 p-4 text-sm lg:grid-cols-[260px_1fr]"
                key={candidate.id}
              >
                <div>
                  <div className="font-semibold">{candidate.organizationName}</div>
                  <div className="mt-1 text-xs text-[#68716c]">
                    {formatLabel(candidate.organizationType)}
                  </div>
                  <div className="mt-2 rounded bg-[#eef1ed] px-2 py-1 text-xs font-semibold text-[#4f5f57]">
                    Supports {formatLabel(candidate.supportsRole)}
                  </div>
                </div>
                <div>
                  <p className="leading-6 text-[#59625d]">{candidate.interestStatement}</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <InfoRow label="Consent" value={formatLabel(candidate.consentStatus)} />
                    <InfoRow
                      label="Leave"
                      value={candidate.requiresLeave ? 'Required' : 'Not required'}
                    />
                    <InfoRow
                      label="Status"
                      value={candidate.recommended ? 'Recommended' : 'Not recommended'}
                    />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function WorkProductsSection({
  actorBusy,
  actorError,
  products,
  session,
  title,
  onAcceptWorkProduct,
  onRejectWorkProduct,
}: {
  actorBusy: boolean
  actorError: string
  products: ActorWorkProduct[]
  session: CaseSession
  title: string
  onAcceptWorkProduct: (workProductId: string) => void
  onRejectWorkProduct: (workProductId: string) => void
}) {
  if (!products.length) return null

  return (
    <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7]">
      <div className="border-b border-[#d8d1c4] p-4">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
          <Bot className="h-4 w-4" aria-hidden="true" />
          {title}
        </div>
        {actorError ? (
          <p className="mt-2 text-sm font-medium text-[#8a321f]">{actorError}</p>
        ) : null}
      </div>
      <div className="divide-y divide-[#e2dbcf]">
        {products.map((product) => (
          <WorkProductCard
            actorBusy={actorBusy}
            key={product.id}
            product={product}
            session={session}
            onAcceptWorkProduct={onAcceptWorkProduct}
            onRejectWorkProduct={onRejectWorkProduct}
          />
        ))}
      </div>
    </section>
  )
}

function WorkProductCard({
  actorBusy,
  product,
  session,
  onAcceptWorkProduct,
  onRejectWorkProduct,
}: {
  actorBusy: boolean
  product: ActorWorkProduct
  session: CaseSession
  onAcceptWorkProduct: (workProductId: string) => void
  onRejectWorkProduct: (workProductId: string) => void
}) {
  const filing = isGeneratedFilingWorkProduct(product)
  const sourceLabels = sourceLabelsForWorkProduct(session, product)

  return (
    <article className="grid gap-3 p-4 text-sm lg:grid-cols-[220px_1fr]">
      <div>
        <div className="font-semibold">{formatLabel(product.kind)}</div>
        <div className="mt-1 text-xs text-[#68716c]">
          {formatLabel(product.actorId)} · {formatDateTimeUtc(product.createdAt)}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="rounded bg-[#eef1ed] px-2 py-1 text-xs font-semibold text-[#4f5f57]">
            {formatLabel(product.status)}
          </span>
          <span className="rounded border border-[#d8d1c4] bg-white px-2 py-1 text-xs font-semibold text-[#3e4843]">
            {filing ? 'AI Draft' : 'Reasoning Memo'}
          </span>
          {filing && product.status === 'accepted' ? (
            <span className="rounded bg-[#dceadf] px-2 py-1 text-xs font-semibold text-[#285b38]">
              Accepted Filing
            </span>
          ) : null}
        </div>
        {product.status === 'proposed' ? (
          <div className="mt-3 grid gap-2">
            <button
              className="h-9 rounded-md bg-[#1d4d4f] px-3 text-xs font-semibold text-white hover:bg-[#173f41] disabled:cursor-not-allowed disabled:bg-[#9aa6a2]"
              disabled={actorBusy}
              onClick={() => onAcceptWorkProduct(product.id)}
              type="button"
            >
              Accept
            </button>
            <button
              className="h-9 rounded-md border border-[#8a321f] px-3 text-xs font-semibold text-[#8a321f] hover:bg-[#fff1ee] disabled:cursor-not-allowed disabled:border-[#b9988f] disabled:text-[#b9988f]"
              disabled={actorBusy}
              onClick={() => onRejectWorkProduct(product.id)}
              type="button"
            >
              Reject
            </button>
          </div>
        ) : null}
      </div>
      <div>
        <div className="font-semibold">{workProductTitle(product)}</div>
        <p className="mt-2 leading-6 text-[#59625d]">{workProductSummary(product)}</p>
        {sourceLabels.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {sourceLabels.map((label) => (
              <span
                className="rounded border border-[#d8d1c4] bg-white px-2 py-1 text-xs"
                key={label}
              >
                {label}
              </span>
            ))}
          </div>
        ) : null}
        {product.validationIssues?.length ? (
          <div className="mt-3 space-y-2">
            {product.validationIssues.map((issue, index) => (
              <ActorValidationItem issue={issue} key={`${issue.code ?? issue.message}-${index}`} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  )
}

function ActorValidationItem({
  issue,
}: {
  issue: NonNullable<ActorWorkProduct['validationIssues']>[number]
}) {
  const tone =
    issue.severity === 'error'
      ? 'border-[#edc6bc] bg-[#fff1ee] text-[#8a321f]'
      : issue.severity === 'warning'
        ? 'border-[#ead7a7] bg-[#fff8e5] text-[#785b16]'
        : 'border-[#cdd8e8] bg-[#f0f5ff] text-[#334f7c]'

  return (
    <div className={`rounded-md border p-3 text-sm ${tone}`}>
      <div className="font-semibold">{formatLabel(issue.severity)}</div>
      <p className="mt-1 leading-5">{issue.message}</p>
      {issue.cureSuggestion ? (
        <p className="mt-2 leading-5">{issue.cureSuggestion}</p>
      ) : null}
    </div>
  )
}

function isGeneratedFilingWorkProduct(product: ActorWorkProduct) {
  return 'documentText' in product.workProduct
}

function workProductTitle(product: ActorWorkProduct) {
  return 'title' in product.workProduct ? product.workProduct.title : formatLabel(product.kind)
}

function workProductSummary(product: ActorWorkProduct) {
  if ('documentText' in product.workProduct) {
    return product.workProduct.documentText.slice(0, 520)
  }
  return [
    product.workProduct.summary,
    ...product.workProduct.recommendations.slice(0, 2),
  ].join(' ')
}

function sourceLabelsForWorkProduct(session: CaseSession, product: ActorWorkProduct) {
  const filingById = new Map(session.filings.map((filing) => [filing.id, filing.title]))
  return [
    ...product.sourceFilingIds.map(
      (sourceId) => `Filing: ${filingById.get(sourceId) ?? sourceId}`,
    ),
    ...product.sourceDocumentAnalysisIds.map((sourceId) => `Analysis: ${sourceId}`),
  ].slice(0, 8)
}

function StrategyList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border border-[#e2dbcf] bg-white p-3 text-sm">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#68716c]">
        {title}
      </div>
      {items.length ? (
        <div className="space-y-2">
          {items.map((item) => (
            <div className="leading-5 text-[#3e4843]" key={item}>
              {item}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[#68716c]">None</div>
      )}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="p-4 text-sm leading-6 text-[#59625d]">
      {text}
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
                    {formatLabel(constraint.kind)}: {constraint.value}
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

function SourceGovernanceView({ courtPackId }: { courtPackId: string }) {
  const courtPack = getCourtPack(courtPackId)
  const statuses = sourceFreshnessStatuses(ca4CourtSourceVersions)
  const betaGate = evaluateReleaseGate({ mode: 'beta' })
  const productionGate = evaluateReleaseGate({ mode: 'production', env: {} })

  return (
    <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7]">
      <div className="border-b border-[#d8d1c4] p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Source Governance
            </div>
            <h2 className="mt-1 text-xl font-semibold">{courtPack.label}</h2>
            <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded border border-[#d8d1c4] bg-white px-2 py-1">
                Release: {formatLabel(courtPack.releaseStatus ?? 'draft')}
              </span>
              <span className={betaGate.pass ? statusClass('active') : statusClass('dismissed')}>
                Beta gate {betaGate.pass ? 'passed' : 'blocked'}
              </span>
              <span className={productionGate.pass ? statusClass('active') : statusClass('dismissed')}>
                Production gate {productionGate.pass ? 'passed' : 'blocked'}
              </span>
            </div>
          </div>
          <div className="rounded-md border border-[#d8d1c4] bg-white px-3 py-2 text-sm text-[#59625d] lg:max-w-[420px]">
            Active constraints, deadlines, and ECF events must reference published source versions before production release.
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="border-b border-[#d8d1c4] text-xs font-semibold uppercase tracking-[0.08em] text-[#68716c]">
            <tr>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Effective</th>
              <th className="px-4 py-3">Review</th>
              <th className="px-4 py-3">Bundled Hash</th>
              <th className="px-4 py-3">Freshness</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e2dbcf]">
            {statuses.map((status) => {
              const source = ca4CourtSourceVersions.find(
                (candidate) => candidate.sourceVersionId === status.sourceVersionId,
              )
              return (
                <tr key={status.sourceVersionId}>
                  <td className="px-4 py-3 align-top">
                    <a
                      className="font-semibold text-[#1d4d4f]"
                      href={status.sourceUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {source?.label ?? status.sourceVersionId}
                    </a>
                    <div className="mt-1 font-mono text-xs text-[#68716c]">
                      {status.sourceVersionId}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top text-[#59625d]">
                    {status.effectiveDate}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className={status.published ? statusClass('active') : statusClass('setup')}>
                      {formatLabel(status.reviewStatus)}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <code className="block max-w-[260px] break-all rounded bg-white px-2 py-1 text-xs text-[#3e4843]">
                      {status.bundledHash}
                    </code>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className={status.stale ? statusClass('dismissed') : statusClass('active')}>
                      {status.stale ? 'Stale' : 'Current'}
                    </span>
                    {status.staleReason ? (
                      <div className="mt-2 max-w-[260px] text-xs leading-5 text-[#8a321f]">
                        {status.staleReason}
                      </div>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {productionGate.issues.length ? (
        <div className="border-t border-[#d8d1c4] p-4">
          <div className="text-sm font-semibold text-[#8a321f]">Production Blockers</div>
          <ul className="mt-2 grid gap-2 text-sm leading-6 text-[#59625d]">
            {productionGate.issues.slice(0, 8).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}
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
                  {formatLabel(scenario.source)}
                </span>
                {scenario.training ? (
                  <span className="rounded bg-[#e7f1ef] px-2 py-1 text-xs font-semibold text-[#305f58]">
                    {formatLabel(scenario.training.difficulty)}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-sm leading-6 text-[#59625d]">
                {scenario.proceduralPosture}
              </p>
              {scenario.training ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {scenario.training.practiceFocus.map((focus) => (
                    <span
                      className="rounded border border-[#d8d1c4] bg-white px-2 py-1 text-xs"
                      key={`${scenario.id}-${focus}`}
                    >
                      {formatLabel(focus)}
                    </span>
                  ))}
                </div>
              ) : null}
              {scenario.training?.learningObjectives.length ? (
                <ul className="mt-3 space-y-1 text-xs leading-5 text-[#59625d]">
                  {scenario.training.learningObjectives.slice(0, 3).map((objective) => (
                    <li key={objective}>{objective}</li>
                  ))}
                </ul>
              ) : null}
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

function formatFileSize(sizeBytes: number) {
  if (sizeBytes >= 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`
}

function trialDocketDocumentHref(document: TrialDocket['entries'][number]['documents'][number]) {
  return document.fileUrl ?? document.sourceUrl
}

function trialDocketDocumentLabel(
  entry: TrialDocket['entries'][number],
  document: TrialDocket['entries'][number]['documents'][number],
) {
  const value = `${document.label} ${entry.title}`.toLowerCase()
  if (value.includes('opinion') || value.includes('order')) return 'Opinion PDF'
  if (value.includes('judgment')) return 'Judgment PDF'
  return entry.documents.length > 1 ? document.label : 'Open PDF'
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
                {formatDateUtc(entry.filedAt)}
              </div>
              <div>
                <div className="font-semibold">{entry.title}</div>
                <p className="mt-2 leading-6 text-[#3e4843]">{entry.text}</p>
                {entry.documents.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {entry.documents.map((document) => {
                      const href = trialDocketDocumentHref(document)
                      const metadata = [
                        `${document.pageCount} ${document.pageCount === 1 ? 'page' : 'pages'}`,
                        formatFileSize(document.sizeBytes),
                      ].join(' | ')
                      const content = (
                        <>
                          <FileCheck2 className="h-4 w-4" aria-hidden="true" />
                          <span>{trialDocketDocumentLabel(entry, document)}</span>
                          <span className="font-normal text-[#59625d]">{metadata}</span>
                        </>
                      )
                      return href ? (
                        <a
                          className="inline-flex min-h-9 items-center gap-2 rounded-md border border-[#cfc7b9] bg-white px-3 py-2 text-xs font-semibold text-[#1d4d4f] hover:border-[#1d4d4f]"
                          href={href}
                          key={document.id}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {content}
                        </a>
                      ) : (
                        <span
                          className="inline-flex min-h-9 items-center gap-2 rounded-md border border-[#d8d1c4] bg-[#f2eee6] px-3 py-2 text-xs font-semibold text-[#59625d]"
                          key={document.id}
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                          <span>{document.storageId ? 'Stored PDF' : 'PDF'}</span>
                          <span className="font-normal">{metadata}</span>
                        </span>
                      )
                    })}
                  </div>
                ) : null}
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
    try {
      return new URL(result.absolute_url, 'https://www.courtlistener.com').toString()
    } catch {
      return null
    }
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
  if (toolCall.tool === 'draftStaffMemo') return 'Staff Attorney Memo'
  if (toolCall.tool === 'castRuntimePanelVote') return 'Panel Vote'
  if (toolCall.tool === 'draftRuntimePanelDisposition') return toolCall.disposition
  if (toolCall.tool === 'enterJudgment') return toolCall.disposition
  if (toolCall.tool === 'setMandateDeadline') return toolCall.label
  if (toolCall.tool === 'recommendClerkAction') return 'Clerk Recommendation'
  if (toolCall.tool === 'recommendAmicusParticipation') return 'Amicus Recommendation'
  if (toolCall.tool === 'draftBenchMemo') return 'Bench Memorandum'
  if (toolCall.tool === 'castPanelVote') return 'Panel Vote'
  if (toolCall.tool === 'draftPanelDisposition') return toolCall.disposition
  if (toolCall.tool === 'draftAssessmentFeedback') return 'Assessment Feedback'
  return toolCall.title
}

function toolCallText(toolCall: ToolCall) {
  if (toolCall.tool === 'setDeadline') {
    return `${toolCall.label}; example offset ${toolCall.offsetDays} days.`
  }
  if (toolCall.tool === 'recommendClerkAction') return toolCall.recommendation
  if (toolCall.tool === 'recommendAmicusParticipation') return toolCall.rationale
  if (toolCall.tool === 'draftBenchMemo') return toolCall.recommendation
  if (toolCall.tool === 'castPanelVote') return toolCall.rationale
  if (toolCall.tool === 'draftStaffMemo') return toolCall.text
  if (toolCall.tool === 'castRuntimePanelVote') return toolCall.rationale
  if (toolCall.tool === 'draftRuntimePanelDisposition') return toolCall.judgmentText
  if (toolCall.tool === 'enterJudgment') return toolCall.judgmentText
  if (toolCall.tool === 'setMandateDeadline') {
    return `${toolCall.label}; example offset ${toolCall.offsetDays} days.`
  }
  if (toolCall.tool === 'draftAssessmentFeedback') {
    return [
      ...toolCall.proceduralFindings,
      ...toolCall.meritsFindings,
      ...toolCall.nextPracticeTargets,
    ].join(' ')
  }
  return toolCall.text
}
