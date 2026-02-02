import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { config } from "../core/config.js";

export type OpsRole = "viewer" | "operator" | "release_manager" | "admin";

export interface OpsContext {
  userId: string;
  tenantId: string;
  workspaceId?: string;
  roles: OpsRole[];
  role: OpsRole;
  allowedTenants: string[];
  raw: JWTPayload;
}

export class OpsAuthError extends Error {
  code: "missing_token" | "invalid_token" | "config_error" | "missing_claim";

  constructor(message: string, code: OpsAuthError["code"]) {
    super(message);
    this.name = "OpsAuthError";
    this.code = code;
  }
}

const ROLE_RANK: Record<OpsRole, number> = {
  viewer: 1,
  operator: 2,
  release_manager: 3,
  admin: 4
};

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getClaim(payload: JWTPayload, claimName: string): unknown {
  if (!claimName) return undefined;
  if (!claimName.includes(".")) {
    return (payload as Record<string, unknown>)[claimName];
  }
  const parts = claimName.split(".");
  let current: unknown = payload as Record<string, unknown>;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function normalizeRoles(value: unknown): OpsRole[] {
  const rawRoles: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") rawRoles.push(item);
    }
  } else if (typeof value === "string") {
    rawRoles.push(...value.split(",").map((v) => v.trim()));
  }

  const roles = rawRoles
    .map((role) => role.toLowerCase())
    .filter((role): role is OpsRole =>
      role === "viewer" ||
      role === "operator" ||
      role === "release_manager" ||
      role === "admin"
    );

  return roles.length > 0 ? roles : ["viewer"];
}

function selectPrimaryRole(roles: OpsRole[]): OpsRole {
  return roles.reduce((best, role) => (ROLE_RANK[role] > ROLE_RANK[best] ? role : best), roles[0]);
}

function normalizeAllowedTenants(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function getJwks() {
  if (jwks) return jwks;
  const issuer = config.opsOidcIssuer;
  const jwksUrl = config.opsOidcJwksUrl || (issuer ? `${issuer.replace(/\/$/, "")}/.well-known/jwks.json` : "");
  if (!jwksUrl) {
    throw new OpsAuthError("OPS_OIDC_JWKS_URL or OPS_OIDC_ISSUER is required", "config_error");
  }
  jwks = createRemoteJWKSet(new URL(jwksUrl));
  return jwks;
}

export async function verifyOpsToken(token: string): Promise<OpsContext> {
  if (!config.opsOidcIssuer || !config.opsOidcAudience) {
    throw new OpsAuthError("OPS_OIDC_ISSUER and OPS_OIDC_AUDIENCE are required", "config_error");
  }

  const { payload } = await jwtVerify(token, getJwks(), {
    issuer: config.opsOidcIssuer,
    audience: config.opsOidcAudience
  });

  const tenantClaim = getClaim(payload, config.opsTenantClaim);
  if (!tenantClaim || typeof tenantClaim !== "string") {
    throw new OpsAuthError("Missing tenant claim in token", "missing_claim");
  }

  const workspaceClaim = getClaim(payload, config.opsWorkspaceClaim);
  const roleClaim = getClaim(payload, config.opsRoleClaim) ?? (payload as Record<string, unknown>).role;
  const allowedTenantsClaim = getClaim(payload, config.opsAllowedTenantsClaim);

  const roles = normalizeRoles(roleClaim);
  const role = selectPrimaryRole(roles);
  const allowedTenants = normalizeAllowedTenants(allowedTenantsClaim);

  const userId =
    ((payload as Record<string, unknown>).user_id as string | undefined) ||
    payload.sub ||
    "unknown";

  return {
    userId,
    tenantId: tenantClaim,
    workspaceId: typeof workspaceClaim === "string" ? workspaceClaim : undefined,
    roles,
    role,
    allowedTenants,
    raw: payload
  };
}

export function canAccessTenant(context: OpsContext, tenantId: string): boolean {
  if (context.tenantId === tenantId) return true;
  if (context.role !== "admin") return false;
  if (context.allowedTenants.length === 0) return false;
  return context.allowedTenants.includes(tenantId);
}

export function canAccessWorkspace(context: OpsContext, workspaceId?: string): boolean {
  if (!workspaceId || !context.workspaceId) return true;
  return context.workspaceId === workspaceId;
}

export function requireRole(context: OpsContext, minimumRole: OpsRole): void {
  if (ROLE_RANK[context.role] < ROLE_RANK[minimumRole]) {
    throw new OpsAuthError("Insufficient role for operation", "invalid_token");
  }
}

export async function requireOpsContextFromHeaders(
  headers: Record<string, string | string[] | undefined>
): Promise<OpsContext> {
  const header = headers["authorization"];
  if (!header || typeof header !== "string") {
    throw new OpsAuthError("Missing Authorization header", "missing_token");
  }
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new OpsAuthError("Invalid Authorization header", "missing_token");
  }
  if (process.env.WOMBAT_TEST_MODE === "true") {
    return {
      userId: "test-user",
      tenantId: "test-tenant",
      workspaceId: "test-tenant",
      roles: ["admin"],
      role: "admin",
      allowedTenants: [],
      raw: {}
    };
  }
  try {
    return await verifyOpsToken(match[1]);
  } catch (error) {
    if (error instanceof OpsAuthError) {
      throw error;
    }
    throw new OpsAuthError("Token verification failed", "invalid_token");
  }
}
