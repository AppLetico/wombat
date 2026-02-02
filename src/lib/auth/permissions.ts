/**
 * Permission Registry
 *
 * Defines action-level permissions mapped to roles for fine-grained RBAC.
 * Following the canonical role hierarchy: viewer < operator < release_manager < admin
 */

import type { OpsRole } from "./opsAuth.js";

/**
 * All defined permissions in the system
 */
export type Permission =
  // Trace permissions
  | "trace:view"
  | "trace:annotate"
  | "trace:diff"
  | "trace:label"
  // Workspace permissions
  | "workspace:view"
  | "workspace:promote"
  | "workspace:rollback"
  | "workspace:lock"
  // Skill permissions
  | "skill:view"
  | "skill:promote"
  // Budget/retention
  | "budget:view"
  | "budget:modify"
  | "retention:view"
  | "retention:modify"
  // Dashboard
  | "dashboard:view"
  // Audit
  | "audit:view"
  // Override (dangerous actions)
  | "override:use";

/**
 * Permission definitions mapping permissions to the roles that have them.
 * Roles are listed in order of increasing privilege.
 */
export const PERMISSIONS: Record<Permission, OpsRole[]> = {
  // Trace permissions
  "trace:view": ["viewer", "operator", "release_manager", "admin"],
  "trace:annotate": ["operator", "release_manager", "admin"],
  "trace:diff": ["operator", "release_manager", "admin"],
  "trace:label": ["operator", "release_manager", "admin"],

  // Workspace permissions
  "workspace:view": ["viewer", "operator", "release_manager", "admin"],
  "workspace:promote": ["release_manager", "admin"],
  "workspace:rollback": ["release_manager", "admin"],
  "workspace:lock": ["admin"],

  // Skill permissions
  "skill:view": ["viewer", "operator", "release_manager", "admin"],
  "skill:promote": ["admin"],

  // Budget/retention
  "budget:view": ["operator", "release_manager", "admin"],
  "budget:modify": ["release_manager", "admin"],
  "retention:view": ["operator", "release_manager", "admin"],
  "retention:modify": ["release_manager", "admin"],

  // Dashboard
  "dashboard:view": ["viewer", "operator", "release_manager", "admin"],

  // Audit
  "audit:view": ["operator", "release_manager", "admin"],

  // Override (dangerous actions)
  "override:use": ["release_manager", "admin"],
};

/**
 * Role hierarchy rank for comparison
 */
const ROLE_RANK: Record<OpsRole, number> = {
  viewer: 1,
  operator: 2,
  release_manager: 3,
  admin: 4,
};

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: OpsRole, permission: Permission): boolean {
  const allowedRoles = PERMISSIONS[permission];
  if (!allowedRoles) {
    return false;
  }
  return allowedRoles.includes(role);
}

/**
 * Check if a role has a specific permission (with any role from an array)
 */
export function hasAnyRoleWithPermission(roles: OpsRole[], permission: Permission): boolean {
  return roles.some((role) => hasPermission(role, permission));
}

/**
 * Get all effective permissions for a given role
 */
export function getEffectivePermissions(role: OpsRole): Permission[] {
  return (Object.entries(PERMISSIONS) as [Permission, OpsRole[]][])
    .filter(([, allowedRoles]) => allowedRoles.includes(role))
    .map(([permission]) => permission);
}

/**
 * Get all effective permissions for any of the given roles
 */
export function getEffectivePermissionsForRoles(roles: OpsRole[]): Permission[] {
  const permissions = new Set<Permission>();
  for (const role of roles) {
    for (const permission of getEffectivePermissions(role)) {
      permissions.add(permission);
    }
  }
  return Array.from(permissions).sort();
}

/**
 * Get role rank for comparison
 */
export function getRoleRank(role: OpsRole): number {
  return ROLE_RANK[role] || 0;
}

/**
 * Check if one role is at least as privileged as another
 */
export function isRoleAtLeast(role: OpsRole, minimumRole: OpsRole): boolean {
  return getRoleRank(role) >= getRoleRank(minimumRole);
}

/**
 * Get the minimum role required for a permission
 */
export function getMinimumRoleForPermission(permission: Permission): OpsRole | null {
  const allowedRoles = PERMISSIONS[permission];
  if (!allowedRoles || allowedRoles.length === 0) {
    return null;
  }
  // Return the role with the lowest rank (most permissive)
  return allowedRoles.reduce((minRole, role) =>
    getRoleRank(role) < getRoleRank(minRole) ? role : minRole
  );
}

/**
 * PermissionError thrown when a permission check fails
 */
export class PermissionError extends Error {
  permission: Permission;
  role: OpsRole;
  requiredRoles: OpsRole[];

  constructor(permission: Permission, role: OpsRole) {
    const requiredRoles = PERMISSIONS[permission] || [];
    super(`Permission denied: ${permission} requires one of [${requiredRoles.join(", ")}], but role is ${role}`);
    this.name = "PermissionError";
    this.permission = permission;
    this.role = role;
    this.requiredRoles = requiredRoles;
  }
}
