/*
 * Appellate Practice Simulator — federal appellate procedure training.
 * Copyright (C) 2026 Rhajune Park
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import type {
  ActorWorkProduct,
  Assessment,
  CaseSession,
  Deadline,
  DeadlineStatus,
  DocketEntry,
  EcfReceipt,
  FilingRecord,
  Participant,
  ToolCall,
} from './types'

export interface CaseSessionRepository {
  get(id: string): Promise<CaseSession | null>
  save(session: CaseSession): Promise<void>
  delete(id: string): Promise<void>
}

export interface FilingRepository {
  listForSession(sessionId: string): Promise<FilingRecord[]>
  save(sessionId: string, filing: FilingRecord): Promise<void>
}

export interface DocketEntryRepository {
  listForSession(sessionId: string): Promise<DocketEntry[]>
  save(sessionId: string, entry: DocketEntry): Promise<void>
}

export interface DeadlineRepository {
  listForSession(sessionId: string): Promise<Deadline[]>
  save(sessionId: string, deadline: Deadline): Promise<void>
  updateStatus(
    sessionId: string,
    deadlineId: string,
    status: DeadlineStatus,
  ): Promise<void>
}

export interface ParticipantRepository {
  listForSession(sessionId: string): Promise<Participant[]>
  save(sessionId: string, participant: Participant): Promise<void>
}

export interface ActorWorkProductRepository {
  listForSession(sessionId: string): Promise<ActorWorkProduct[]>
  save(sessionId: string, product: ActorWorkProduct): Promise<void>
  updateStatus(
    sessionId: string,
    productId: string,
    status: ActorWorkProduct['status'],
  ): Promise<void>
}

export interface SimulationAiProvider {
  requestToolCall(
    session: CaseSession,
  ): Promise<{ toolCall: ToolCall | null; rawText: string }>
  generateWorkProduct(
    session: CaseSession,
    kind: string,
  ): Promise<{ value: unknown | null; rawText: string }>
}

export interface EcfReceiptRepository {
  listForSession(sessionId: string): Promise<EcfReceipt[]>
  save(sessionId: string, receipt: EcfReceipt): Promise<void>
}

export interface AssessmentRepository {
  getForSession(sessionId: string): Promise<Assessment | null>
  save(sessionId: string, assessment: Assessment): Promise<void>
}

export interface SimulationRepository {
  sessions: CaseSessionRepository
  filings: FilingRepository
  docketEntries: DocketEntryRepository
  deadlines: DeadlineRepository
  participants: ParticipantRepository
  actorWorkProducts: ActorWorkProductRepository
  receipts: EcfReceiptRepository
  assessments: AssessmentRepository
  aiProvider: SimulationAiProvider
}

type SessionId = string
type EntityId = string

export class InMemorySimulationRepository implements SimulationRepository {
  private sessionStore = new Map<EntityId, CaseSession>()
  private filingStore = new Map<SessionId, FilingRecord[]>()
  private docketStore = new Map<SessionId, DocketEntry[]>()
  private deadlineStore = new Map<SessionId, Deadline[]>()
  private participantStore = new Map<SessionId, Participant[]>()
  private workProductStore = new Map<SessionId, ActorWorkProduct[]>()
  private receiptStore = new Map<SessionId, EcfReceipt[]>()
  private assessmentStore = new Map<SessionId, Assessment>()

  sessions: CaseSessionRepository = {
    get: async (id) => this.sessionStore.get(id) ?? null,
    save: async (session) => { this.sessionStore.set(session.id, session) },
    delete: async (id) => { this.sessionStore.delete(id) },
  }

  filings: FilingRepository = {
    listForSession: async (sessionId) =>
      this.filingStore.get(sessionId) ?? [],
    save: async (sessionId, filing) => {
      const list = this.filingStore.get(sessionId) ?? []
      list.push(filing)
      this.filingStore.set(sessionId, list)
    },
  }

  docketEntries: DocketEntryRepository = {
    listForSession: async (sessionId) =>
      this.docketStore.get(sessionId) ?? [],
    save: async (sessionId, entry) => {
      const list = this.docketStore.get(sessionId) ?? []
      list.push(entry)
      this.docketStore.set(sessionId, list)
    },
  }

  deadlines: DeadlineRepository = {
    listForSession: async (sessionId) =>
      this.deadlineStore.get(sessionId) ?? [],
    save: async (sessionId, deadline) => {
      const list = this.deadlineStore.get(sessionId) ?? []
      list.push(deadline)
      this.deadlineStore.set(sessionId, list)
    },
    updateStatus: async (sessionId, deadlineId, status) => {
      const list = this.deadlineStore.get(sessionId)
      if (!list) return
      const idx = list.findIndex((d) => d.id === deadlineId)
      if (idx !== -1) list[idx] = { ...list[idx], status }
    },
  }

  participants: ParticipantRepository = {
    listForSession: async (sessionId) =>
      this.participantStore.get(sessionId) ?? [],
    save: async (sessionId, participant) => {
      const list = this.participantStore.get(sessionId) ?? []
      list.push(participant)
      this.participantStore.set(sessionId, list)
    },
  }

  actorWorkProducts: ActorWorkProductRepository = {
    listForSession: async (sessionId) =>
      this.workProductStore.get(sessionId) ?? [],
    save: async (sessionId, product) => {
      const list = this.workProductStore.get(sessionId) ?? []
      list.push(product)
      this.workProductStore.set(sessionId, list)
    },
    updateStatus: async (sessionId, productId, status) => {
      const list = this.workProductStore.get(sessionId)
      if (!list) return
      const idx = list.findIndex((p) => p.id === productId)
      if (idx !== -1) list[idx] = { ...list[idx], status }
    },
  }

  receipts: EcfReceiptRepository = {
    listForSession: async (sessionId) =>
      this.receiptStore.get(sessionId) ?? [],
    save: async (sessionId, receipt) => {
      const list = this.receiptStore.get(sessionId) ?? []
      list.push(receipt)
      this.receiptStore.set(sessionId, list)
    },
  }

  assessments: AssessmentRepository = {
    getForSession: async (sessionId) =>
      this.assessmentStore.get(sessionId) ?? null,
    save: async (sessionId, assessment) => {
      this.assessmentStore.set(sessionId, assessment)
    },
  }

  aiProvider: SimulationAiProvider = {
    requestToolCall: async () => ({ toolCall: null, rawText: '' }),
    generateWorkProduct: async () => ({ value: null, rawText: '' }),
  }

  clear() {
    this.sessionStore.clear()
    this.filingStore.clear()
    this.docketStore.clear()
    this.deadlineStore.clear()
    this.participantStore.clear()
    this.workProductStore.clear()
    this.receiptStore.clear()
    this.assessmentStore.clear()
  }
}
