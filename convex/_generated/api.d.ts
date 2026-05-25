/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as adminSources from "../adminSources.js";
import type * as assignments from "../assignments.js";
import type * as authHelpers from "../authHelpers.js";
import type * as caseSessions from "../caseSessions.js";
import type * as cohorts from "../cohorts.js";
import type * as instructor from "../instructor.js";
import type * as integrations from "../integrations.js";
import type * as policies from "../policies.js";
import type * as scenarioDrafts from "../scenarioDrafts.js";
import type * as scenarios from "../scenarios.js";
import type * as seed from "../seed.js";
import type * as users from "../users.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  adminSources: typeof adminSources;
  assignments: typeof assignments;
  authHelpers: typeof authHelpers;
  caseSessions: typeof caseSessions;
  cohorts: typeof cohorts;
  instructor: typeof instructor;
  integrations: typeof integrations;
  policies: typeof policies;
  scenarioDrafts: typeof scenarioDrafts;
  scenarios: typeof scenarios;
  seed: typeof seed;
  users: typeof users;
  validators: typeof validators;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
