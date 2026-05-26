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

export class ConvexError extends Error {
  code: AppErrorCode
  metadata?: Record<string, unknown>

  constructor(code: AppErrorCode, message: string, metadata?: Record<string, unknown>) {
    super(message)
    this.name = 'ConvexError'
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

export function notFound(entity: string, id?: string) {
  return new ConvexError(AppErrorCode.NOT_FOUND, `${entity} not found`, { entity, ...(id ? { id } : {}) })
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
