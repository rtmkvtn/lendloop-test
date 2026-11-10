/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as http from "../http.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_automationFields from "../lib/automationFields.js";
import type * as lib_availability from "../lib/availability.js";
import type * as lib_dates from "../lib/dates.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_functions from "../lib/functions.js";
import type * as lib_members from "../lib/members.js";
import type * as lib_notifications from "../lib/notifications.js";
import type * as lib_requestFields from "../lib/requestFields.js";
import type * as lib_requestLifecycle from "../lib/requestLifecycle.js";
import type * as lib_signature from "../lib/signature.js";
import type * as lib_toolFields from "../lib/toolFields.js";
import type * as notifications from "../notifications.js";
import type * as requests from "../requests.js";
import type * as tools from "../tools.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  http: typeof http;
  "lib/audit": typeof lib_audit;
  "lib/automationFields": typeof lib_automationFields;
  "lib/availability": typeof lib_availability;
  "lib/dates": typeof lib_dates;
  "lib/env": typeof lib_env;
  "lib/errors": typeof lib_errors;
  "lib/functions": typeof lib_functions;
  "lib/members": typeof lib_members;
  "lib/notifications": typeof lib_notifications;
  "lib/requestFields": typeof lib_requestFields;
  "lib/requestLifecycle": typeof lib_requestLifecycle;
  "lib/signature": typeof lib_signature;
  "lib/toolFields": typeof lib_toolFields;
  notifications: typeof notifications;
  requests: typeof requests;
  tools: typeof tools;
  users: typeof users;
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
