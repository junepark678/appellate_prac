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
  Users,
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
  validateFiling,
} from '../domain/simulation'
import { nextActorWorkProductTask, type ActorWorkProductTask } from '../domain/actors/orchestration'
import { preflightFilingSubmission } from '../domain/rules/executable-constraints'
import {
  ecfEventDefinitionFromFilingEvent,
  filingDraftToSubmission,
} from '../domain/filing/ecf'
import { nextProcedureToolCall } from '../domain/procedure/state-machine'
import type {
  ActorWorkProduct,
  CaseSession,
  FilingDraft,
  FilingEvent,
  ParticipantRole,
  Scenario,
  ToolCall,
  UploadedDocument,
  ValidationIssue,
} from '../domain/types'
import type { DocumentAnalysis } from '../modules/types'
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

type GenerateActorWorkProductAction = (args: {
  caseSessionId: Id<'caseSessions'>
}) => Promise<ActorWorkProduct>

type DocumentUploadUrlMutation = (args: {
  caseSessionId: Id<'caseSessions'>
}) => Promise<string>

type PersistDocumentAnalysisMutation = (args: {
  caseSessionId: Id<'caseSessions'>
  document: UploadedDocument
  analysis: DocumentAnalysis
}) => Promise<{
  document: UploadedDocument
  analysisId: string
}>

type AcceptActorWorkProductMutation = (args: {
  caseSessionId: Id<'caseSessions'>
  workProductId: string
}) => Promise<{
  session: CaseSession
  workProduct: ActorWorkProduct
}>

type RejectActorWorkProductMutation = (args: {
  caseSessionId: Id<'caseSessions'>
  workProductId: string
}) => Promise<ActorWorkProduct>

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
  const [actorPending, setActorPending] = useState(false)
  const [actorError, setActorError] = useState('')
  const [documentPending, setDocumentPending] = useState(false)
  const [documentError, setDocumentError] = useState('')
  const [sessionPending, setSessionPending] = useState(false)
  const [sessionError, setSessionError] = useState('')
  const [draft, setDraft] = useState<FilingDraft>(() =>
    createEmptyDraft(createInitialSession(), 'notice_of_appeal'),
  )
  const upsertCurrentUser = useMutation(api.users.upsertCurrentUser)
  const createCaseSession = useMutation(api.caseSessions.create)
  const submitFiling = useMutation(api.caseSessions.submitFiling)
  const submitEcfFiling = useMutation(api.caseSessions.submitEcfFiling)
  const advanceProcedure = useMutation(api.caseSessions.advanceProcedure)
  const generateDocumentUploadUrl = useMutation(
    (api as any).caseSessions.generateDocumentUploadUrl,
  ) as DocumentUploadUrlMutation
  const persistDocumentAnalysis = useMutation(
    (api as any).caseSessions.persistDocumentAnalysis,
  ) as PersistDocumentAnalysisMutation
  const acceptActorWorkProduct = useMutation(
    (api as any).caseSessions.acceptActorWorkProduct,
  ) as AcceptActorWorkProductMutation
  const rejectActorWorkProduct = useMutation(
    (api as any).caseSessions.rejectActorWorkProduct,
  ) as RejectActorWorkProductMutation
  const importCourtListenerSource = useMutation(
    api.caseSessions.importCourtListenerSource,
  )
  const advanceLive = useAction(api.caseSessions.advanceLiveEvent) as AdvanceLiveEventAction
  const generateActorWorkProduct = useAction(
    (api as any).caseSessions.generateActorWorkProduct,
  ) as GenerateActorWorkProductAction
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
  const visibleTabs = useMemo(
    () => (activeSession ? navigationTabsForSession(activeSession) : []),
    [activeSession],
  )
  const visibleViewKeys = visibleTabs.map((tab) => tab.key)
  const selectedView =
    activeSession && visibleViewKeys.includes(activeView) ? activeView : 'docket'
  const availableEvents = (courtPack?.filingEvents ?? []).filter((event) =>
    event.allowedParticipantRoles.includes(learnerRole),
  )
  const activeToolCall = activeSession ? nextProcedureToolCall(activeSession) : null
  const activeActorTask = activeSession ? nextActorWorkProductTask(activeSession) : null
  const validationIssues = useMemo(
    () => {
      if (!activeSession) return []
      const submission = filingDraftToSubmission(draft)
      return submission
        ? preflightFilingSubmission(activeSession, submission).issues
        : validateFiling(activeSession, draft)
    },
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

  useEffect(() => {
    if (!activeSession || selectedView === activeView) return
    setActiveView(selectedView)
  }, [activeSession, activeView, selectedView])

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
      const submission = filingDraftToSubmission(draft)
      const nextSession = submission
        ? (
            await submitEcfFiling({
              caseSessionId: activeSession.id as Id<'caseSessions'>,
              submission,
            })
          ).session
        : await submitFiling({
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
      const result = await advanceProcedure({
        caseSessionId: activeSession.id as Id<'caseSessions'>,
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
        caseSessionId: activeSession.id as Id<'caseSessions'>,
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
        caseSessionId: activeSession.id as Id<'caseSessions'>,
        workProductId,
      })
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
        caseSessionId: activeSession.id as Id<'caseSessions'>,
        workProductId,
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
      const documents = await Promise.all(
        Array.from(files ?? []).map((file) =>
          analyzeUploadAndPersistDocument(activeSession.id as Id<'caseSessions'>, file),
        ),
      )
      setDraft((current) => ({ ...current, documents }))
    } catch (error) {
      setDocumentError(
        error instanceof Error ? error.message : 'PDF analysis failed; using filename signals',
      )
      const documents: UploadedDocument[] = Array.from(files ?? []).map(inferDocumentSignals)
      setDraft((current) => ({ ...current, documents }))
    } finally {
      setDocumentPending(false)
    }
  }

  async function analyzeUploadAndPersistDocument(
    caseSessionId: Id<'caseSessions'>,
    file: File,
  ): Promise<UploadedDocument> {
    const base = inferDocumentSignals(file)
    const { pdfJsAnalyzer } = await import('../modules/documents/pdfjs-analyzer')
    const [analysis, sha256, storageId] = await Promise.all([
      pdfJsAnalyzer.analyze({
        fileName: file.name,
        mimeType: file.type || 'application/pdf',
        sizeBytes: file.size,
        extractedSignals: base.extractedSignals,
        arrayBuffer: () => file.arrayBuffer(),
      }),
      sha256File(file),
      uploadToConvexStorage(caseSessionId, file),
    ])
    const document = documentFromAnalysis(base, analysis, storageId, sha256)

    try {
      const persisted = await persistDocumentAnalysis({
        caseSessionId,
        document,
        analysis,
      })
      return persisted.document
    } catch {
      return document
    }
  }

  async function uploadToConvexStorage(caseSessionId: Id<'caseSessions'>, file: File) {
    const uploadUrl = await generateDocumentUploadUrl({ caseSessionId })
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/pdf' },
      body: file,
    })
    if (!response.ok) {
      throw new Error('Unable to store PDF in Convex storage.')
    }
    const payload = (await response.json()) as { storageId?: string }
    return payload.storageId
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
                      aiError={aiError}
                      aiPending={aiPending}
                      actorError={actorError}
                      actorPending={actorPending}
                      liveAiEnabled={liveAiReady}
                      liveAiUnavailableReason={liveAiUnavailableReason}
                      onAdvanceExpected={advanceExpectedEvent}
                      onAdvanceLive={advanceLiveEvent}
                      onGenerateActorWorkProduct={generateNextActorWorkProduct}
                    />
                  ) : null}

                  {selectedView === 'file' ? (
                    <FilingView
                      draft={draft}
                      documentError={documentError}
                      documentPending={documentPending}
                      events={availableEvents}
                      validationIssues={validationIssues}
                      onDraftChange={setDraft}
                      onDocumentsSelected={analyzeAndAttachDocuments}
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
                <span className="text-xs text-[#68716c]">
                  {formatLabel(session.status)} - {new Date(session.simulatedDate).toLocaleDateString()}
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

async function sha256File(file: File) {
  if (!globalThis.crypto?.subtle) return undefined
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function signalsFromAnalysis(base: UploadedDocument, analysis: DocumentAnalysis) {
  return [
    ...base.extractedSignals,
    ...(analysis.sectionMap?.map((section) => section.label.toLowerCase()) ?? []),
    ...(analysis.certificateOfServiceDetected ? ['certificate of service'] : []),
    ...(analysis.certificateOfComplianceDetected ? ['certificate of compliance'] : []),
    ...((analysis.recordCitations?.length ?? 0) > 0 ? ['record citation'] : []),
    ...((analysis.appendixCitations?.length ?? 0) > 0 ? ['appendix'] : []),
  ].filter((signal, index, values) => values.indexOf(signal) === index)
}

function documentFromAnalysis(
  base: UploadedDocument,
  analysis: DocumentAnalysis,
  storageId?: string,
  sha256?: string,
): UploadedDocument {
  return {
    ...base,
    ...(storageId ? { storageId } : {}),
    ...(sha256 ? { sha256 } : {}),
    ...(typeof analysis.pageCount === 'number' ? { pageCount: analysis.pageCount } : {}),
    ...(analysis.normalizedText ? { extractedText: analysis.normalizedText } : {}),
    ...(analysis.textExtractionStatus
      ? { textExtractionStatus: analysis.textExtractionStatus }
      : {}),
    ...(typeof analysis.wordCount === 'number' ? { wordCount: analysis.wordCount } : {}),
    extractedSignals: signalsFromAnalysis(base, analysis),
    analysis,
  }
}

function statusClass(status: CaseSession['status']) {
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
                {new Date(deadline.dueDate).toLocaleDateString()}
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
  aiError,
  aiPending,
  actorError,
  actorPending,
  liveAiEnabled,
  liveAiUnavailableReason,
  onAdvanceExpected,
  onAdvanceLive,
  onGenerateActorWorkProduct,
}: {
  session: CaseSession
  activeToolCall: ToolCall
  activeActorTask: ActorWorkProductTask | null
  aiError: string
  aiPending: boolean
  actorError: string
  actorPending: boolean
  liveAiEnabled: boolean
  liveAiUnavailableReason: string
  onAdvanceExpected: () => void
  onAdvanceLive: () => void
  onGenerateActorWorkProduct: () => void
}) {
  return (
    <div className="space-y-4">
      <WorkflowStatusGrid session={session} />

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
              Procedure Event
            </button>
          </div>
        </div>
      </section>

      {activeActorTask ? (
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
                {new Date(entry.filedAt).toLocaleDateString()}
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

function FilingView({
  draft,
  documentError,
  documentPending,
  events,
  validationIssues,
  onDraftChange,
  onDocumentsSelected,
  onReset,
  onSubmit,
}: {
  draft: FilingDraft
  documentError: string
  documentPending: boolean
  events: FilingEvent[]
  validationIssues: ValidationIssue[]
  onDraftChange: (draft: FilingDraft) => void
  onDocumentsSelected: (files: FileList | null) => void
  onReset: (eventId?: string) => void
  onSubmit: () => void
}) {
  const errors = validationIssues.filter((issue) => issue.severity === 'error')
  const selectedEvent = events.find((event) => event.id === draft.eventId)
  const ecfDefinition = selectedEvent
    ? ecfEventDefinitionFromFilingEvent(selectedEvent)
    : null
  const briefWarnings = validationIssues.filter((issue) =>
    [
      'jurisdictional_statement_missing',
      'issues_presented_missing',
      'standard_of_review_missing',
      'argument_section_missing',
      'conclusion_relief_missing',
      'record_citations_missing',
      'appendix_references_missing',
    ].includes(issue.code ?? ''),
  )
  const appendixWarnings = validationIssues.filter((issue) =>
    (issue.code ?? '').startsWith('appendix_support_') ||
    (issue.code ?? '').startsWith('issue_coverage_'),
  )

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-lg border border-[#d8d1c4] bg-[#fbfaf7] p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
            <FileText className="h-4 w-4" aria-hidden="true" />
            CM/ECF Filing Workflow
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

        <div className="mb-4 grid gap-2 md:grid-cols-4">
          {['Event', 'Metadata', 'Documents', 'Review'].map((step, index) => (
            <div
              className="rounded-md border border-[#d8d1c4] bg-white px-3 py-2 text-sm"
              key={step}
            >
              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#68716c]">
                Step {index + 1}
              </div>
              <div className="mt-1 font-semibold">{step}</div>
            </div>
          ))}
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

        {ecfDefinition ? (
          <section className="mt-4 rounded-lg border border-[#e2dbcf] bg-white p-3">
            <div className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
              Event Metadata
            </div>
            <div className="grid gap-3 text-sm md:grid-cols-3">
              <InfoRow label="Category" value={formatLabel(ecfDefinition.category)} />
              <InfoRow label="Fee" value={formatLabel(ecfDefinition.feeBehavior)} />
              <InfoRow label="Service" value={formatLabel(ecfDefinition.serviceBehavior)} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {ecfDefinition.metadataFields.map((field) => (
                <span
                  className="rounded border border-[#d8d1c4] bg-[#fbfaf7] px-2 py-1 text-xs font-medium text-[#3e4843]"
                  key={field.key}
                >
                  {field.label}
                  {field.required ? ' Required' : ''}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        <label className="mt-4 block space-y-2 text-sm font-medium">
          PDF documents
          <div className="grid min-h-36 place-items-center rounded-lg border border-dashed border-[#b7aa98] bg-white px-4 py-6 text-center">
            <div>
              <FileArchive className="mx-auto h-8 w-8 text-[#1d4d4f]" aria-hidden="true" />
              <input
                accept="application/pdf"
                className="mt-4 w-full max-w-sm text-sm"
                disabled={documentPending}
                multiple
                onChange={(event) => onDocumentsSelected(event.target.files)}
                type="file"
              />
              {documentPending ? (
                <div className="mt-3 text-xs font-semibold text-[#68716c]">
                  Extracting PDF text and storing upload...
                </div>
              ) : null}
              {documentError ? (
                <div className="mt-3 text-xs font-semibold text-[#8a321f]">
                  {documentError}
                </div>
              ) : null}
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
                    {(document.sizeBytes / 1024).toFixed(1)} KB · {formatDocumentAnalysis(document)}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <DocumentMetric label="Text" value={formatLabel(document.textExtractionStatus ?? document.analysis?.textExtractionStatus ?? 'fallback')} />
                    <DocumentMetric label="Pages" value={String(document.pageCount ?? document.analysis?.pageCount ?? 'n/a')} />
                    <DocumentMetric label="Words" value={String(document.wordCount ?? document.analysis?.wordCount ?? 'n/a')} />
                    <DocumentMetric
                      label="Certificates"
                      value={certificateStatus(document)}
                    />
                    <DocumentMetric
                      label="Record cites"
                      value={String(document.analysis?.recordCitations?.length ?? 0)}
                    />
                  </div>
                </div>
                <span className="h-fit rounded bg-[#eef1ed] px-2 py-1 text-xs font-semibold text-[#4f5f57]">
                  {document.mimeType}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {[...briefWarnings, ...appendixWarnings].length ? (
          <section className="mt-4 rounded-lg border border-[#ead7a7] bg-[#fff8e5] p-3">
            <div className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#785b16]">
              Brief Analysis Warnings
            </div>
            <div className="space-y-2">
              {[...briefWarnings, ...appendixWarnings].slice(0, 6).map((warning, index) => (
                <div className="text-sm leading-5 text-[#785b16]" key={`${warning.code}-${index}`}>
                  {warning.message}
                </div>
              ))}
            </div>
          </section>
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

        <section className="mt-4 rounded-lg border border-[#e2dbcf] bg-white p-3">
          <div className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-[#68716c]">
            Review
          </div>
          <div className="grid gap-3 text-sm md:grid-cols-3">
            <InfoRow label="Main document" value={draft.documents[0]?.fileName ?? 'Not attached'} />
            <InfoRow label="Attachments" value={String(Math.max(0, draft.documents.length - 1))} />
            <InfoRow
              label="Receipt status"
              value={errors.length ? 'Cannot file until errors are cured' : 'Receipt preview ready'}
            />
          </div>
        </section>

        <div className="mt-4 flex justify-end">
          <button
            className="flex h-11 items-center gap-2 rounded-md bg-[#1d4d4f] px-4 text-sm font-semibold text-white hover:bg-[#173e40] disabled:cursor-not-allowed disabled:bg-[#9aa6a2]"
            disabled={errors.length > 0 || documentPending}
            onClick={onSubmit}
            type="button"
          >
            <FileCheck2 className="h-4 w-4" aria-hidden="true" />
            Submit ECF Filing
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
            groupValidationIssuesBySource(validationIssues).map((group) => (
              <div className="space-y-2" key={group.source}>
                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#68716c]">
                  {group.source}
                </div>
                {group.issues.map((issue, index) => (
                  <ValidationItem issue={issue} key={`${issue.message}-${index}`} />
                ))}
              </div>
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

function validationSource(issue: ValidationIssue) {
  const ruleIds = issue.ruleRefs.map((rule) => rule.ruleId)
  if (ruleIds.some((ruleId) => ruleId.startsWith('FRAP'))) return 'FRAP'
  if (ruleIds.some((ruleId) => ruleId.startsWith('CA4_LR'))) return 'CA4 Local Rule'
  return 'Simulator'
}

function groupValidationIssuesBySource(issues: ValidationIssue[]) {
  const order = ['FRAP', 'CA4 Local Rule', 'Simulator']
  return order
    .map((source) => ({
      source,
      issues: issues.filter((issue) => validationSource(issue) === source),
    }))
    .filter((group) => group.issues.length)
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

function DocumentMetric({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded border border-[#d8d1c4] bg-[#fbfaf7] px-2 py-1 text-xs font-medium text-[#3e4843]">
      {label}: {value}
    </span>
  )
}

function formatDocumentAnalysis(document: UploadedDocument) {
  const status = document.textExtractionStatus ?? document.analysis?.textExtractionStatus
  const recordCites = document.analysis?.recordCitations?.length ?? 0
  const appendixCites = document.analysis?.appendixCitations?.length ?? 0
  if (!status) return document.extractedSignals.join(', ') || 'metadata only'
  return `${formatLabel(status)} · ${recordCites} record cite${recordCites === 1 ? '' : 's'} · ${appendixCites} appendix cite${appendixCites === 1 ? '' : 's'}`
}

function certificateStatus(document: UploadedDocument) {
  const service = document.analysis?.certificateOfServiceDetected
  const compliance = document.analysis?.certificateOfComplianceDetected
  if (service && compliance) return 'service + compliance'
  if (service) return 'service'
  if (compliance) return 'compliance'
  return 'not detected'
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
          <div className="font-semibold">{formatLabel(issue.severity)}</div>
          <p className="mt-1 leading-5">{issue.message}</p>
          {issue.code ? (
            <div className="mt-1 font-mono text-xs opacity-80">{issue.code}</div>
          ) : null}
          {issue.cureSuggestion ? (
            <p className="mt-2 leading-5">{issue.cureSuggestion}</p>
          ) : null}
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
                  {new Date(receipt.createdAt).toLocaleString()}
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
          {formatLabel(product.actorId)} · {new Date(product.createdAt).toLocaleString()}
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
              <ValidationItem issue={issue} key={`${issue.code ?? issue.message}-${index}`} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
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
