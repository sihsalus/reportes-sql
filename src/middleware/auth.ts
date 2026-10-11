/**
 * Incoming authentication middleware — per-request validation of the OpenMRS
 * `JSESSIONID` cookie against `${OPENMRS_API_URL}/ws/rest/v1/session`.
 *
 * Contract (see `sdd/incoming-openmrs-auth`):
 *
 * - Only `Cookie: JSESSIONID=<value>` is forwarded upstream by this gate. Never
 *   `Authorization` or any other cookie (including `JSESSIONIDSSO`). The
 *   conceptos proxy forwards the same cookie to OpenMRS.
 * - No caching: every request re-validates against OpenMRS.
 * - Upstream `Set-Cookie` headers are discarded — never forwarded to the client.
 * - The accept gate is `response.ok && body.authenticated === true`. Every
 *   failure — missing/invalid/unvalidated cookie, upstream 4xx/5xx, network
 *   error, timeout, invalid body — returns the same generic 401, revealing no
 *   case.
 * - On success `body.user` is attached as-is (preserving the OpenMRS shape,
 *   including roles and privileges) to `req.authUser`.
 * - `requireModuleAccess` gates every non-public route with `app:indicadores`,
 *   matching the frontend route/extension guard.
 * - `requireManagePrivilege` additionally gates writes with
 *   `app:indicadores.editar`. Super users (the roles listed below) bypass both,
 *   mirroring the frontend `userHasAccess`.
 */
import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import { settings } from "../config/index.js";

/**
 * Bounded timeout for the upstream `/session` call (implementation constant,
 * deliberately not configurable in this iteration).
 */
export const SESSION_VALIDATION_TIMEOUT_MS = 3000;

/**
 * The OpenMRS user attached to an authenticated request. Preserves OpenMRS's
 * own shape (`body.user` is attached as-is); the index signature keeps
 * forward-compatibility with fields OpenMRS adds later.
 */
export interface AuthUser {
  uuid: string;
  display?: string;
  systemId?: string;
  roles?: Array<{ display: string; uuid: string }>;
  privileges?: Array<{ display: string; uuid: string }>;
  [key: string]: unknown;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

/**
 * Extract the `JSESSIONID` cookie from a raw `Cookie` header.
 *
 * Manual parser (zero dependencies): splits on `;`, matches the name
 * case-insensitively, strips surrounding quotes, and returns `null` when
 * missing or empty. `JSESSIONIDSSO` and every other cookie are ignored.
 */
export function extractJSESSIONID(
  cookieHeader: string | undefined,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name.toLowerCase() !== "jsessionid") continue;
    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    return value === "" ? null : value;
  }
  return null;
}

function isPublicPath(path: string): boolean {
  // `/health` (both mount positions) and exactly `/docs` + `/docs/*`
  // (including `/docs/openapi.json`) stay public. A precise match avoids
  // exempting unrelated paths such as `/docsfoo`.
  return path === "/health" || path === "/docs" || path.startsWith("/docs/");
}

/**
 * Per-request session validation middleware.
 *
 * Mounted on `publicRouter` before all route registrations. Exempts `/health`
 * and `/docs`/`/docs/*`; every other request requires a valid OpenMRS session.
 */
export async function requireSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (isPublicPath(req.path ?? "/")) {
    next();
    return;
  }

  const jsessionid = extractJSESSIONID(req.headers["cookie"]);
  if (jsessionid === null) {
    res.status(401).json({ detail: "No autorizado" });
    return;
  }

  const base = settings.openmrs_api_url.replace(/\/+$/, "");
  const sessionUrl = `${base}/ws/rest/v1/session`;

  try {
    const response = await fetch(sessionUrl, {
      // Forward ONLY the session cookie — never Authorization, service
      // credentials, or any other cookie. Upstream Set-Cookie is discarded
      // (we never read or forward it).
      headers: { Cookie: `JSESSIONID=${jsessionid}` },
      signal: AbortSignal.timeout(SESSION_VALIDATION_TIMEOUT_MS),
    });

    if (!response.ok) {
      res.status(401).json({ detail: "No autorizado" });
      return;
    }

    let body: { authenticated?: unknown; user?: AuthUser };
    try {
      body = (await response.json()) as {
        authenticated?: unknown;
        user?: AuthUser;
      };
    } catch {
      res.status(401).json({ detail: "No autorizado" });
      return;
    }

    if (body.authenticated !== true) {
      res.status(401).json({ detail: "No autorizado" });
      return;
    }

    // Attach body.user as-is (preserves roles/privileges). No caching: every
    // request performed its own upstream validation above.
    req.authUser = body.user;
    next();
  } catch {
    // Network error, timeout, DNS failure — same generic 401, no case revealed.
    res.status(401).json({ detail: "No autorizado" });
  }
}

function userHasPrivilege(
  user: AuthUser | undefined,
  privilege: string,
): boolean {
  const privileges = user?.privileges;
  if (!Array.isArray(privileges)) return false;
  return privileges.some((entry) => {
    if (typeof entry === "string") return entry === privilege;
    return entry?.display === privilege || entry?.uuid === privilege;
  });
}

/**
 * Roles that identify a super user. Mirrors the frontend
 * (`@openmrs/esm-api` → `userHasAccess` → `isSuperUser`): a user holding any of
 * these roles bypasses the write privilege guard, so an administrator can
 * operate without being granted every module privilege.
 */
const SUPER_USER_ROLES = new Set([
  "System Developer",
  "Application: Has Super User Privileges",
]);

function isSuperUser(user: AuthUser | undefined): boolean {
  const roles = user?.roles;
  if (!Array.isArray(roles)) return false;
  return roles.some(
    (role) =>
      SUPER_USER_ROLES.has(role?.display) ||
      SUPER_USER_ROLES.has((role as { name?: string })?.name ?? ""),
  );
}

/**
 * Privileges that gate the module, fixed in code (name in code + definition in
 * metadata, the OpenMRS pattern). `MODULE_PRIVILEGE` gates read/access and
 * matches the frontend route/extension guard; `MANAGE_PRIVILEGE` gates writes
 * (POST/PUT/DELETE). Neither is a per-deployment knob.
 */
export const MODULE_PRIVILEGE = "app:indicadores";
export const MANAGE_PRIVILEGE = "app:indicadores.editar";

/**
 * Shared guard: super users always pass; a non-super user must hold the
 * privilege. Mirrors the frontend `userHasAccess` so an administrator is never
 * locked out.
 */
function makePrivilegeGuard(privilege: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isSuperUser(req.authUser)) {
      next();
      return;
    }
    if (!userHasPrivilege(req.authUser, privilege)) {
      res.status(403).json({ detail: "Sin privilegios" });
      return;
    }
    next();
  };
}

const moduleAccessGuard = makePrivilegeGuard(MODULE_PRIVILEGE);

/**
 * Module access gate — mounted after {@link requireSession}, so every
 * non-public route requires a valid session AND {@link MODULE_PRIVILEGE}.
 * `/health` and `/docs`/`/docs/*` stay public (no session is validated for
 * them, so no `authUser` is attached).
 */
export function requireModuleAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (isPublicPath(req.path ?? "/")) {
    next();
    return;
  }
  moduleAccessGuard(req, res, next);
}

/**
 * Write guard — required by every mutating route (POST/PUT/DELETE) on top of
 * {@link requireModuleAccess}, so a writer must also hold
 * {@link MANAGE_PRIVILEGE}.
 */
export const requireManagePrivilege = makePrivilegeGuard(MANAGE_PRIVILEGE);
