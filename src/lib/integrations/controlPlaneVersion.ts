/**
 * Control Plane Version Enforcement
 *
 * Validates compatibility between Clasper and the control plane backend.
 * Prevents silent failures due to API contract mismatches.
 */

import { config } from '../core/config.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Control plane capabilities/version info
 */
export interface ControlPlaneCapabilities {
  version: string;
  contractVersion: string;
  features: string[];
  endpoints: string[];
}

/**
 * Result of version validation
 */
export interface VersionCheckResult {
  compatible: boolean;
  clasperContractVersion: string;
  controlPlaneContractVersion?: string;
  error?: string;
  warnings: string[];
  missingFeatures: string[];
}

/**
 * Error thrown when version mismatch is detected
 */
export class VersionMismatchError extends Error {
  public readonly result: VersionCheckResult;

  constructor(message: string, result: VersionCheckResult) {
    super(message);
    this.name = 'VersionMismatchError';
    this.result = result;
  }
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Current Clasper control plane contract version
 * Increment when breaking changes are made to the contract
 */
export const CLASPER_CONTRACT_VERSION = '1.1.0';

/**
 * Minimum supported control plane contract version
 */
export const MIN_CONTRACT_VERSION = '1.0.0';

/**
 * Required features for this version of Clasper
 */
export const REQUIRED_FEATURES = [
  'task_list',
  'task_create',
  'message_post',
];

/**
 * Optional features that enhance functionality
 */
export const OPTIONAL_FEATURES = [
  'document_post',
  'tool_discover',
  'tool_execute',
];

// ============================================================================
// Version Utilities
// ============================================================================

/**
 * Parse a semver version string
 */
function parseVersion(version: string): { major: number; minor: number; patch: number } | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

/**
 * Check if version A is >= version B
 */
function isVersionGte(a: string, b: string): boolean {
  const vA = parseVersion(a);
  const vB = parseVersion(b);
  
  if (!vA || !vB) return false;
  
  if (vA.major !== vB.major) return vA.major > vB.major;
  if (vA.minor !== vB.minor) return vA.minor > vB.minor;
  return vA.patch >= vB.patch;
}

/**
 * Check if two versions are compatible (same major version)
 */
function areVersionsCompatible(a: string, b: string): boolean {
  const vA = parseVersion(a);
  const vB = parseVersion(b);
  
  if (!vA || !vB) return false;
  
  return vA.major === vB.major;
}

// ============================================================================
// Version Checking
// ============================================================================

/**
 * Fetch capabilities from control plane
 */
export async function fetchControlPlaneCapabilities(
  baseUrl: string,
  timeout: number = 5000
): Promise<ControlPlaneCapabilities | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const response = await fetch(`${baseUrl}/api/capabilities`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    
    return {
      version: data.version || 'unknown',
      contractVersion: data.contract_version || data.version || '1.0.0',
      features: data.features || [],
      endpoints: data.endpoints || [],
    };
  } catch {
    return null;
  }
}

/**
 * Validate control plane compatibility
 */
export async function validateControlPlaneVersion(
  baseUrl?: string
): Promise<VersionCheckResult> {
  const url = baseUrl || config.backendUrl;
  const warnings: string[] = [];
  const missingFeatures: string[] = [];
  
  // If no control plane URL configured, skip validation
  if (!url) {
    return {
      compatible: true,
      clasperContractVersion: CLASPER_CONTRACT_VERSION,
      warnings: ['No control plane URL configured - skipping version check'],
      missingFeatures: [],
    };
  }
  
  const capabilities = await fetchControlPlaneCapabilities(url);
  
  if (!capabilities) {
    return {
      compatible: false,
      clasperContractVersion: CLASPER_CONTRACT_VERSION,
      error: 'Failed to fetch control plane capabilities - control plane may be unreachable',
      warnings: [],
      missingFeatures: [],
    };
  }
  
  // Check contract version
  const cpVersion = capabilities.contractVersion;
  
  if (!isVersionGte(cpVersion, MIN_CONTRACT_VERSION)) {
    return {
      compatible: false,
      clasperContractVersion: CLASPER_CONTRACT_VERSION,
      controlPlaneContractVersion: cpVersion,
      error: `Control plane version ${cpVersion} is below minimum required ${MIN_CONTRACT_VERSION}`,
      warnings: [],
      missingFeatures: [],
    };
  }
  
  if (!areVersionsCompatible(cpVersion, CLASPER_CONTRACT_VERSION)) {
    return {
      compatible: false,
      clasperContractVersion: CLASPER_CONTRACT_VERSION,
      controlPlaneContractVersion: cpVersion,
      error: `Major version mismatch: Clasper expects ${CLASPER_CONTRACT_VERSION.split('.')[0]}.x.x, control plane is ${cpVersion}`,
      warnings: [],
      missingFeatures: [],
    };
  }
  
  // Check required features
  for (const feature of REQUIRED_FEATURES) {
    if (!capabilities.features.includes(feature)) {
      missingFeatures.push(feature);
    }
  }
  
  if (missingFeatures.length > 0) {
    return {
      compatible: false,
      clasperContractVersion: CLASPER_CONTRACT_VERSION,
      controlPlaneContractVersion: cpVersion,
      error: `Control plane missing required features: ${missingFeatures.join(', ')}`,
      warnings: [],
      missingFeatures,
    };
  }
  
  // Check optional features
  for (const feature of OPTIONAL_FEATURES) {
    if (!capabilities.features.includes(feature)) {
      warnings.push(`Optional feature not available: ${feature}`);
    }
  }
  
  return {
    compatible: true,
    clasperContractVersion: CLASPER_CONTRACT_VERSION,
    controlPlaneContractVersion: cpVersion,
    warnings,
    missingFeatures: [],
  };
}

/**
 * Validate and throw on mismatch (for startup checks)
 */
export async function enforceControlPlaneVersion(
  baseUrl?: string
): Promise<VersionCheckResult> {
  const result = await validateControlPlaneVersion(baseUrl);
  
  if (!result.compatible) {
    throw new VersionMismatchError(
      result.error || 'Control plane version incompatible',
      result
    );
  }
  
  return result;
}

/**
 * Create middleware-style checker for per-request validation (optional)
 */
export function createVersionChecker(cacheMs: number = 60000): {
  check: () => Promise<VersionCheckResult>;
  getLastResult: () => VersionCheckResult | null;
} {
  let lastResult: VersionCheckResult | null = null;
  let lastCheck: number = 0;
  
  return {
    check: async () => {
      const now = Date.now();
      
      if (lastResult && now - lastCheck < cacheMs) {
        return lastResult;
      }
      
      lastResult = await validateControlPlaneVersion();
      lastCheck = now;
      return lastResult;
    },
    getLastResult: () => lastResult,
  };
}
