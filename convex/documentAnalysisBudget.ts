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

import type { MutationCtx, QueryCtx } from './_generated/server'
import { validationError } from './errors'

export const maxSessionGrowthBytes = 4 * 1024 * 1024
export const maxSessionProjectionBytes = 12 * 1024 * 1024
export const maxSessionOperationFootprintBytes = 12 * 1024 * 1024
// The 4 MiB reserve below Convex's 16 MiB transaction limit permits one
// bounded row read before the measured 12 MiB application limit is enforced.
const maxConvexTransactionBytes = 16 * 1024 * 1024

// Include a conservative allowance for a row's generated IDs, creation time,
// and index metadata in modeled transaction read/write totals. The row JSON
// itself still includes `_id` and `_creationTime` when it has been persisted.
export const modeledRowMetadataBytes = 4096
export const modeledQueryMetadataBytes = 1024
export const maximumConvexRowBytes = 1024 * 1024

const encoder = new TextEncoder()
const generatedIdBudgetPlaceholder = 'x'.repeat(128)
const generatedCreationTimePlaceholder = Number.MAX_SAFE_INTEGER

export type SessionAdmissionMetrics = {
  rowMaterialBytes: number
  projectionBytes: number
}

export type SessionOperationFootprint = {
  readBytes: number
  writeBytes: number
}

export function serializedJsonUtf8Bytes(value: unknown) {
  const json = JSON.stringify(value)
  return json === undefined ? undefined : encoder.encode(json).byteLength
}

export function fitsSessionProjection(bytes: number) {
  return (
    Number.isSafeInteger(bytes) &&
    bytes >= 0 &&
    bytes <= maxSessionProjectionBytes
  )
}

/**
 * The 4 MiB limit is an absolute resulting size. A session already above it
 * may only stay level or compact; the separate 12 MiB bound still applies.
 */
export function fitsSessionGrowth(
  previousBytes: number,
  resultingBytes: number,
) {
  if (
    !Number.isSafeInteger(previousBytes) ||
    previousBytes < 0 ||
    !Number.isSafeInteger(resultingBytes) ||
    resultingBytes < 0 ||
    resultingBytes > maxSessionProjectionBytes
  ) {
    return false
  }
  return previousBytes <= maxSessionGrowthBytes
    ? resultingBytes <= maxSessionGrowthBytes
    : resultingBytes <= previousBytes
}

export function fitsSessionAdmission(
  previous: SessionAdmissionMetrics,
  resulting: SessionAdmissionMetrics,
) {
  return (
    fitsSessionGrowth(previous.rowMaterialBytes, resulting.rowMaterialBytes) &&
    fitsSessionGrowth(previous.projectionBytes, resulting.projectionBytes)
  )
}

export function fitsSessionOperationFootprint(
  footprint: SessionOperationFootprint,
) {
  return (
    Number.isSafeInteger(footprint.readBytes) &&
    footprint.readBytes >= 0 &&
    footprint.readBytes <= maxSessionOperationFootprintBytes &&
    Number.isSafeInteger(footprint.writeBytes) &&
    footprint.writeBytes >= 0 &&
    footprint.writeBytes <= maxSessionOperationFootprintBytes
  )
}

export function modeledReadBytes(rowJsonBytes: number, pageCount = 1) {
  return (
    rowJsonBytes +
    Math.max(0, pageCount) *
      (modeledRowMetadataBytes + modeledQueryMetadataBytes)
  )
}

export function modeledWriteBytes(rowJsonBytes: number, rowCount: number) {
  return rowJsonBytes + Math.max(0, rowCount) * modeledRowMetadataBytes
}

export class SessionTransactionBudget {
  private reservedReadBytes = 0
  private readBytes = 0
  private writeBytes = 0
  private readonly knownRows = new Map<string, Record<string, unknown>>()

  private assertReadCapacity(maxRows: number) {
    const reservation =
      maxRows * (maximumConvexRowBytes + modeledRowMetadataBytes) +
      modeledQueryMetadataBytes
    if (
      this.readBytes + this.reservedReadBytes + reservation >
      maxConvexTransactionBytes
    ) {
      throw validationError(
        'Case session transaction exceeds the bounded read footprint.',
      )
    }
    this.reservedReadBytes += reservation
    return reservation
  }

  private recordRows(value: unknown, reservation: number) {
    this.reservedReadBytes -= reservation
    const rows = Array.isArray(value)
      ? value
      : value &&
          typeof value === 'object' &&
          Array.isArray((value as { page?: unknown }).page)
        ? (value as { page: unknown[] }).page
        : value === null || value === undefined
          ? []
          : [value]
    let bytes = modeledQueryMetadataBytes
    for (const row of rows) {
      const rowBytes = serializedJsonUtf8Bytes(row)
      if (rowBytes === undefined) continue
      bytes += rowBytes + modeledRowMetadataBytes
      if (row && typeof row === 'object' && '_id' in row) {
        this.knownRows.set(
          String((row as { _id: unknown })._id),
          row as Record<string, unknown>,
        )
      }
    }
    if (this.readBytes + bytes > maxSessionOperationFootprintBytes) {
      throw validationError(
        'Case session transaction exceeds the bounded read footprint.',
      )
    }
    this.readBytes += bytes
  }

  read<T>(load: () => Promise<T>, maxRows = 1) {
    const reservation = this.assertReadCapacity(maxRows)
    return load().then(
      (value) => {
        this.recordRows(value, reservation)
        return value
      },
      (error: unknown) => {
        this.reservedReadBytes -= reservation
        throw error
      },
    )
  }

  readPage<T>(load: () => Promise<T>, maxRows: number) {
    return this.read(load, maxRows)
  }

  rejectUnboundedCollection(): never {
    throw validationError(
      'Case session rows must be read with bounded one-row pagination.',
    )
  }

  private assertWriteBytes(bytes: number) {
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      this.writeBytes + bytes > maxSessionOperationFootprintBytes
    ) {
      throw validationError(
        'Case session transaction exceeds the bounded write footprint.',
      )
    }
    this.writeBytes += bytes
  }

  insert<T>(
    table: string,
    value: Record<string, unknown>,
    insert: () => Promise<T>,
  ) {
    const row = {
      ...value,
      _id: generatedIdBudgetPlaceholder,
      _creationTime: generatedCreationTimePlaceholder,
    }
    const bytes = serializedJsonUtf8Bytes(row)
    if (bytes === undefined) {
      throw validationError('Case session row cannot be serialized.')
    }
    this.assertWriteBytes(bytes + modeledRowMetadataBytes)
    return insert().then((id) => {
      this.knownRows.set(String(id), {
        ...value,
        _id: id,
        _creationTime: generatedCreationTimePlaceholder,
      })
      void table
      return id
    })
  }

  async patch<T>(
    id: string,
    patch: Record<string, unknown>,
    update: () => Promise<T>,
    getOld: () => Promise<Record<string, unknown> | null>,
  ) {
    let old = this.knownRows.get(id)
    if (!old) {
      old = (await this.read(getOld)) ?? undefined
    }
    if (!old) return update()
    const next = { ...old, ...patch }
    const oldBytes = serializedJsonUtf8Bytes(old)
    const nextBytes = serializedJsonUtf8Bytes(next)
    if (oldBytes === undefined || nextBytes === undefined) {
      throw validationError('Case session row cannot be serialized.')
    }
    this.assertWriteBytes(oldBytes + nextBytes + 2 * modeledRowMetadataBytes)
    const result = await update()
    this.knownRows.set(id, next)
    return result
  }

  async delete<T>(
    id: string,
    remove: () => Promise<T>,
    getOld: () => Promise<Record<string, unknown> | null>,
  ) {
    let old = this.knownRows.get(id)
    if (!old) old = (await this.read(getOld)) ?? undefined
    if (old) {
      const bytes = serializedJsonUtf8Bytes(old)
      if (bytes === undefined) {
        throw validationError('Case session row cannot be serialized.')
      }
      this.assertWriteBytes(bytes + modeledRowMetadataBytes)
    }
    const result = await remove()
    this.knownRows.delete(id)
    return result
  }

  async replace<T>(
    id: string,
    replacement: Record<string, unknown>,
    update: () => Promise<T>,
    getOld: () => Promise<Record<string, unknown> | null>,
  ) {
    let old = this.knownRows.get(id)
    if (!old) old = (await this.read(getOld)) ?? undefined
    if (!old) return update()
    const next = {
      ...replacement,
      _id: old._id,
      _creationTime: old._creationTime,
    }
    const oldBytes = serializedJsonUtf8Bytes(old)
    const nextBytes = serializedJsonUtf8Bytes(next)
    if (oldBytes === undefined || nextBytes === undefined) {
      throw validationError('Case session row cannot be serialized.')
    }
    this.assertWriteBytes(oldBytes + nextBytes + 2 * modeledRowMetadataBytes)
    const result = await update()
    this.knownRows.set(id, next)
    return result
  }

  snapshot() {
    return { readBytes: this.readBytes, writeBytes: this.writeBytes }
  }
}

type BudgetedCtx = QueryCtx | MutationCtx

const transactionBudgets = new WeakMap<object, SessionTransactionBudget>()
const trackedContexts = new WeakMap<object, object>()

function wrapQueryBuilder(
  target: object,
  budget: SessionTransactionBudget,
): object {
  return new Proxy(target, {
    get(query, property) {
      const method = Reflect.get(query, property, query)
      if (typeof method !== 'function') return method
      if (property === 'collect') {
        return () => budget.rejectUnboundedCollection()
      }
      if (property === 'paginate') {
        return (...args: unknown[]) => {
          const options = (args[0] ?? {}) as { numItems?: number }
          const maxRows = options.numItems ?? 1
          return budget.readPage(
            () => Reflect.apply(method, query, args) as Promise<unknown>,
            maxRows,
          )
        }
      }
      if (property === 'take') {
        return (...args: unknown[]) => {
          const requestedRows = Number(args[0])
          const maxRows =
            Number.isSafeInteger(requestedRows) && requestedRows >= 0
              ? requestedRows
              : 1
          return budget.read(
            () => Reflect.apply(method, query, [maxRows]) as Promise<unknown>,
            maxRows,
          )
        }
      }
      if (property === 'first' || property === 'unique') {
        return (...args: unknown[]) =>
          budget.read(
            () => Reflect.apply(method, query, args) as Promise<unknown>,
            property === 'unique' ? 2 : 1,
          )
      }
      return (...args: unknown[]) =>
        wrapQueryBuilder(Reflect.apply(method, query, args), budget)
    },
  })
}

function wrapDatabase(db: object, budget: SessionTransactionBudget): object {
  return new Proxy(db, {
    get(target, property) {
      const value = Reflect.get(target, property, target)
      if (property === 'system' && value && typeof value === 'object') {
        return wrapDatabase(value, budget)
      }
      if (property === 'query') {
        return (...args: unknown[]) =>
          wrapQueryBuilder(Reflect.apply(value, target, args), budget)
      }
      if (property === 'get') {
        return (...args: unknown[]) =>
          budget.read(
            () => Reflect.apply(value, target, args) as Promise<unknown>,
            1,
          )
      }
      if (property === 'insert') {
        return (table: string, row: Record<string, unknown>) =>
          budget.insert(
            table,
            row,
            () =>
              Reflect.apply(value, target, [table, row]) as Promise<unknown>,
          )
      }
      if (property === 'patch') {
        return (id: unknown, patch: Record<string, unknown>) =>
          budget.patch(
            String(id),
            patch,
            () => Reflect.apply(value, target, [id, patch]) as Promise<unknown>,
            () =>
              Reflect.apply(Reflect.get(target, 'get', target), target, [
                id,
              ]) as Promise<Record<string, unknown> | null>,
          )
      }
      if (property === 'replace') {
        return (id: unknown, replacement: Record<string, unknown>) =>
          budget.replace(
            String(id),
            replacement,
            () =>
              Reflect.apply(value, target, [
                id,
                replacement,
              ]) as Promise<unknown>,
            () =>
              Reflect.apply(Reflect.get(target, 'get', target), target, [
                id,
              ]) as Promise<Record<string, unknown> | null>,
          )
      }
      if (property === 'delete') {
        return (id: unknown) =>
          budget.delete(
            String(id),
            () => Reflect.apply(value, target, [id]) as Promise<unknown>,
            () =>
              Reflect.apply(Reflect.get(target, 'get', target), target, [
                id,
              ]) as Promise<Record<string, unknown> | null>,
          )
      }
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

export function withSessionTransactionBudget<T extends BudgetedCtx>(ctx: T) {
  const source = ctx as object
  let budget = transactionBudgets.get(source)
  let tracked = trackedContexts.get(source)
  if (!budget || !tracked) {
    budget = budget ?? new SessionTransactionBudget()
    const proxy = new Proxy(ctx, {
      get(target, property) {
        if (property === 'db')
          return wrapDatabase(Reflect.get(target, property, target), budget!)
        return Reflect.get(target, property, target)
      },
    })
    tracked = proxy
    transactionBudgets.set(source, budget)
    transactionBudgets.set(proxy, budget)
    trackedContexts.set(source, proxy)
    trackedContexts.set(proxy, proxy)
  }
  return {
    ctx: tracked as T,
    budget,
  }
}
