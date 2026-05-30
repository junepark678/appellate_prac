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
import type * as authz from "../authz.js";
import type * as caseSessionEventLog from "../caseSessionEventLog.js";
import type * as caseSessions from "../caseSessions.js";
import type * as cohorts from "../cohorts.js";
import type * as errors from "../errors.js";
import type * as instructor from "../instructor.js";
import type * as integrations from "../integrations.js";
import type * as policies from "../policies.js";
import type * as rate_limit from "../rate_limit.js";
import type * as scenarioDrafts from "../scenarioDrafts.js";
import type * as scenarios from "../scenarios.js";
import type * as seed from "../seed.js";
import type * as telemetry from "../telemetry.js";
import type * as users from "../users.js";
import type * as validators from "../validators.js";
import type * as validators_actor from "../validators_actor.js";
import type * as validators_core from "../validators_core.js";
import type * as validators_document from "../validators_document.js";
import type * as validators_filing from "../validators_filing.js";
import type * as validators_scenario from "../validators_scenario.js";
import type * as validators_session from "../validators_session.js";
import type * as validators_tool from "../validators_tool.js";

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
  authz: typeof authz;
  caseSessionEventLog: typeof caseSessionEventLog;
  caseSessions: typeof caseSessions;
  cohorts: typeof cohorts;
  errors: typeof errors;
  instructor: typeof instructor;
  integrations: typeof integrations;
  policies: typeof policies;
  rate_limit: typeof rate_limit;
  scenarioDrafts: typeof scenarioDrafts;
  scenarios: typeof scenarios;
  seed: typeof seed;
  telemetry: typeof telemetry;
  users: typeof users;
  validators: typeof validators;
  validators_actor: typeof validators_actor;
  validators_core: typeof validators_core;
  validators_document: typeof validators_document;
  validators_filing: typeof validators_filing;
  validators_scenario: typeof validators_scenario;
  validators_session: typeof validators_session;
  validators_tool: typeof validators_tool;
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
