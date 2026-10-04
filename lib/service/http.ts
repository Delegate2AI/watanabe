import { fail } from "@/lib/errors/codes";
import type { ServiceFailure, ServiceResult } from "./result";

/**
 * The HTTP half of the adapter pair: a `ServiceResult` in, a `Response` out.
 *
 * Status mapping is unchanged by construction, because this renders through the
 * same `fail()` and therefore the same `STATUS` table the routes have always
 * used. There is no second table here and there must never be one.
 *
 * What this module deliberately does NOT do is identity. `requireIdentity`
 * stays inline at the top of every handler and its 401 is returned untouched,
 * because `unauthorized()` answers `{ error: "<sentence>" }` while the failure
 * contract answers `{ error: { code } }`. Those are two different shapes on the
 * wire, and folding the 401 in here would quietly change every route's
 * unauthenticated response.
 */
export function failureResponse(failure: ServiceFailure): Response {
  return fail(failure.code, { detail: failure.detail, message: failure.message });
}

/**
 * Render a result. `render` covers the handlers that do not answer a plain 200:
 * a creation answering 201, or a route whose wire body differs from the value
 * the service returns.
 */
export function respond<T>(result: ServiceResult<T>, render?: (value: T) => Response): Response {
  if (!result.ok) return failureResponse(result);
  return render ? render(result.value) : Response.json(result.value);
}
