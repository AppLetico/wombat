/**
 * Control Plane Version Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateControlPlaneVersion,
  createVersionChecker,
  fetchControlPlaneCapabilities,
  WOMBAT_CONTRACT_VERSION,
  MIN_CONTRACT_VERSION,
  REQUIRED_FEATURES,
} from './controlPlaneVersion.js';

describe('fetchControlPlaneCapabilities', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  it('should fetch and parse capabilities', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        version: '1.0.0',
        contract_version: WOMBAT_CONTRACT_VERSION,
        features: [...REQUIRED_FEATURES],
        endpoints: ['/api/agents/send'],
      }),
    });

    const result = await fetchControlPlaneCapabilities('http://localhost:3000');

    expect(result).not.toBeNull();
    expect(result?.contractVersion).toBe(WOMBAT_CONTRACT_VERSION);
    expect(result?.features).toEqual([...REQUIRED_FEATURES]);
  });

  it('should return null on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await fetchControlPlaneCapabilities('http://localhost:3000');

    expect(result).toBeNull();
  });

  it('should return null on non-200 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
    });

    const result = await fetchControlPlaneCapabilities('http://localhost:3000');

    expect(result).toBeNull();
  });
});

describe('validateControlPlaneVersion', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  it('should return compatible when versions match', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        version: '1.0.0',
        contract_version: WOMBAT_CONTRACT_VERSION,
        features: [...REQUIRED_FEATURES],
        endpoints: [],
      }),
    });

    const result = await validateControlPlaneVersion('http://localhost:3000');

    expect(result.compatible).toBe(true);
    expect(result.wombatContractVersion).toBe(WOMBAT_CONTRACT_VERSION);
  });

  it('should return incompatible for version below minimum', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        version: '0.1.0',
        contract_version: '0.1.0',
        features: [],
        endpoints: [],
      }),
    });

    const result = await validateControlPlaneVersion('http://localhost:3000');

    expect(result.compatible).toBe(false);
    expect(result.error).toContain('below minimum');
  });

  it('should return incompatible when required features are missing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        version: '1.0.0',
        contract_version: WOMBAT_CONTRACT_VERSION,
        features: [], // missing required features
        endpoints: [],
      }),
    });

    const result = await validateControlPlaneVersion('http://localhost:3000');

    expect(result.compatible).toBe(false);
    expect(result.missingFeatures.length).toBeGreaterThan(0);
  });

  it('should return error when control plane returns non-200', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
    });

    const result = await validateControlPlaneVersion('http://localhost:3000');

    expect(result.compatible).toBe(false);
    expect(result.error).toContain('Failed to fetch');
  });

  it('should return error when control plane unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await validateControlPlaneVersion('http://localhost:3000');

    expect(result.compatible).toBe(false);
    expect(result.error).toContain('Failed to fetch');
  });
});

describe('createVersionChecker', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  it('should create a checker with cache', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        version: '1.0.0',
        contract_version: WOMBAT_CONTRACT_VERSION,
        features: [...REQUIRED_FEATURES],
        endpoints: [],
      }),
    });

    const checker = createVersionChecker(60000); // 60 second cache
    
    const result1 = await checker.check();
    const result2 = await checker.check();
    
    expect(result1.compatible).toBe(true);
    expect(result2.compatible).toBe(true);
    
    // Should only fetch once due to caching
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should return last result', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        version: '1.0.0',
        contract_version: WOMBAT_CONTRACT_VERSION,
        features: [...REQUIRED_FEATURES],
        endpoints: [],
      }),
    });

    const checker = createVersionChecker(60000);
    
    expect(checker.getLastResult()).toBeNull();
    
    await checker.check();
    
    const lastResult = checker.getLastResult();
    expect(lastResult).not.toBeNull();
    expect(lastResult?.compatible).toBe(true);
  });
});

describe('contract constants', () => {
  it('should export valid semver versions', () => {
    const semverRegex = /^\d+\.\d+\.\d+$/;

    expect(WOMBAT_CONTRACT_VERSION).toMatch(semverRegex);
    expect(MIN_CONTRACT_VERSION).toMatch(semverRegex);
  });

  it('should have required features defined', () => {
    expect(REQUIRED_FEATURES.length).toBeGreaterThan(0);
    expect(REQUIRED_FEATURES).toContain('task_list');
  });
});
