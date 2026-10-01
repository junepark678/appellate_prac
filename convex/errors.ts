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

import { ConvexError as ConvexValuesError, type Value } from 'convex/values'

export enum AppErrorCode {
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  AUTH_USER_NOT_INITIALIZED = 'AUTH_USER_NOT_INITIALIZED',
  AUTH_UNAUTHORIZED_ROLE = 'AUTH_UNAUTHORIZED_ROLE',
  NOT_FOUND = 'NOT_FOUND',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  CONFLICT = 'CONFLICT',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  RATE_LIMITED = 'RATE_LIMITED',
  SESSION_LOCKED = 'SESSION_LOCKED',
  INVITE_EXPIRED = 'INVITE_EXPIRED',
  INVITE_ALREADY_ACCEPTED = 'INVITE_ALREADY_ACCEPTED',
  INVITE_EMAIL_MISMATCH = 'INVITE_EMAIL_MISMATCH',
  PROVIDER_ERROR = 'PROVIDER_ERROR',
  PROVIDER_TIMEOUT = 'PROVIDER_TIMEOUT',
}

export type AppErrorMetadata = Record<string, Value>

export type AppErrorData = {
  code: AppErrorCode
  message: string
  metadata?: AppErrorMetadata
}

/**
 * Convex's transport only preserves structured errors that extend its native
 * ConvexError. Keep the legacy code/metadata properties while placing the
 * complete, stable error contract in `.data` for clients and wire responses.
 */
export class ConvexError extends ConvexValuesError<AppErrorData> {
  readonly code: AppErrorCode
  readonly metadata?: AppErrorMetadata

  constructor(code: AppErrorCode, message: string, metadata?: AppErrorMetadata) {
    const data: AppErrorData = {
      code,
      message,
      ...(metadata ? { metadata } : {}),
    }
    super(data)
    // Preserve the pre-envelope message property for existing local callers.
    this.message = message
    this.code = code
    if (metadata) this.metadata = metadata
  }
}

export function authRequired() {
  return new ConvexError(AppErrorCode.AUTH_REQUIRED, 'Authentication required')
}

export function unauthorizedRole(roles: string[]) {
  return new ConvexError(
    AppErrorCode.AUTH_UNAUTHORIZED_ROLE,
    `${roles.join(' or ')} role required`,
    { roles },
  )
}

export function userNotInitialized() {
  return new ConvexError(AppErrorCode.AUTH_USER_NOT_INITIALIZED, 'User profile is not initialized')
}

export function notFound(entity: string, _id?: string) {
  // Do not return caller-supplied identifiers or details for foreign records.
  return new ConvexError(AppErrorCode.NOT_FOUND, `${entity} not found`)
}

export function sessionLocked() {
  return new ConvexError(AppErrorCode.SESSION_LOCKED, 'Session is locked')
}

export function inviteExpired() {
  return new ConvexError(AppErrorCode.INVITE_EXPIRED, 'Invite has expired')
}

export function inviteAlreadyAccepted() {
  return new ConvexError(AppErrorCode.INVITE_ALREADY_ACCEPTED, 'Invite has already been accepted')
}

export function inviteEmailMismatch() {
  return new ConvexError(AppErrorCode.INVITE_EMAIL_MISMATCH, 'Invite email does not match your account')
}

export function providerError(provider: string, status: number) {
  return new ConvexError(
    AppErrorCode.PROVIDER_ERROR,
    `Provider ${provider} returned error status ${status}`,
    { provider, status },
  )
}

export function providerTimeout(provider: string) {
  return new ConvexError(AppErrorCode.PROVIDER_TIMEOUT, `Provider ${provider} timed out`, { provider })
}

export function rateLimited(action: string) {
  return new ConvexError(AppErrorCode.RATE_LIMITED, `Rate limited: ${action}`, { action })
}

export function validationError(message: string, field?: string) {
  return new ConvexError(
    AppErrorCode.VALIDATION_ERROR,
    message,
    { ...(field ? { field } : {}) },
  )
}
