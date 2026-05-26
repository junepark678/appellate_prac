/**
 * Pure functions shared between Convex auth logic and the rest of the app.
 * Convex modules cannot import from `src/`, so `convex/authz.ts` contains
 * a duplicate that must stay in sync — see the sync comment there.
 */

export function toDeterministicId(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}
