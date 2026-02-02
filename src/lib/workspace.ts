import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { config } from "./config.js";
import { getSkillsLoader, type SkillsContext } from "./skills.js";

/**
 * Maximum characters per bootstrap file before truncation.
 * Following OpenClaw's bootstrapMaxChars pattern to prevent prompt bloat.
 * Default: 20000 characters (same as OpenClaw)
 */
const BOOTSTRAP_MAX_CHARS = 20000;

/**
 * Truncation marker appended when a file exceeds the max size.
 */
const TRUNCATION_MARKER = "\n\n[... content truncated for prompt size ...]";

/**
 * Prompt mode for system prompt construction.
 * Following OpenClaw's promptMode pattern for context optimization.
 * - "full": Include all bootstrap files (SOUL, AGENTS, etc.) - for main agent
 * - "minimal": Include only AGENTS + TOOLS - for sub-agents/heartbeats to reduce tokens
 */
export type PromptMode = "full" | "minimal";

/**
 * Bootstrap files that can be loaded from the workspace.
 * Following OpenClaw's pattern for portable agent configuration.
 */
export interface WorkspaceBootstrap {
  /** Operating rules and instructions (AGENTS.md) */
  agents: string | null;
  /** Agent persona, boundaries, tone (SOUL.md or souls/<role>.md) */
  soul: string | null;
  /** Agent name/emoji/identity (IDENTITY.md) */
  identity: string | null;
  /** Tool usage notes (TOOLS.md) */
  tools: string | null;
  /** Heartbeat checklist (HEARTBEAT.md) */
  heartbeat: string | null;
  /** User profile (USER.md) */
  user: string | null;
}

/**
 * WorkspaceLoader reads bootstrap files from a configurable workspace directory.
 * This enables portable agent configuration - projects provide their own
 * AGENTS.md, SOUL.md, etc. instead of hardcoding prompts in code.
 */
export class WorkspaceLoader {
  private workspacePath: string;
  private cache: Map<string, string | null> = new Map();
  private maxChars: number;

  constructor(workspacePath?: string, maxChars?: number) {
    this.workspacePath = resolve(workspacePath || config.workspacePath);
    this.maxChars = maxChars ?? BOOTSTRAP_MAX_CHARS;
  }

  /**
   * Truncate content if it exceeds the max character limit.
   * Following OpenClaw's pattern to prevent prompt bloat.
   */
  private truncateIfNeeded(content: string): string {
    if (content.length <= this.maxChars) {
      return content;
    }
    // Truncate at the limit minus marker length
    const truncateAt = this.maxChars - TRUNCATION_MARKER.length;
    return content.slice(0, truncateAt) + TRUNCATION_MARKER;
  }

  /**
   * Read a file from the workspace, returning null if it doesn't exist.
   * Results are cached for the lifetime of this loader instance.
   * Large files are truncated to prevent prompt bloat.
   */
  private readFile(relativePath: string): string | null {
    const cacheKey = relativePath;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) ?? null;
    }

    const fullPath = join(this.workspacePath, relativePath);
    if (!existsSync(fullPath)) {
      this.cache.set(cacheKey, null);
      return null;
    }

    try {
      const content = readFileSync(fullPath, "utf-8");
      const truncated = this.truncateIfNeeded(content);
      this.cache.set(cacheKey, truncated);
      return truncated;
    } catch {
      this.cache.set(cacheKey, null);
      return null;
    }
  }

  /**
   * Load the SOUL file for a given role.
   * Checks in order:
   * 1. souls/<role>.md (e.g., souls/jarvis.md)
   * 2. SOUL.md (fallback for single-agent setups)
   */
  loadSoul(role?: string): string | null {
    if (role) {
      const roleSoul = this.readFile(`souls/${role}.md`);
      if (roleSoul) return roleSoul;
    }
    return this.readFile("SOUL.md");
  }

  /**
   * Load the AGENTS.md operating rules.
   */
  loadAgents(): string | null {
    return this.readFile("AGENTS.md");
  }

  /**
   * Load the IDENTITY.md file.
   */
  loadIdentity(): string | null {
    return this.readFile("IDENTITY.md");
  }

  /**
   * Load the TOOLS.md file.
   */
  loadTools(): string | null {
    return this.readFile("TOOLS.md");
  }

  /**
   * Load the HEARTBEAT.md file.
   */
  loadHeartbeat(): string | null {
    return this.readFile("HEARTBEAT.md");
  }

  /**
   * Load the USER.md file.
   */
  loadUser(): string | null {
    return this.readFile("USER.md");
  }

  /**
   * Load the BOOT.md file (one-time initialization).
   * Following OpenClaw's pattern for first-run instructions.
   */
  loadBoot(): string | null {
    return this.readFile("BOOT.md");
  }

  /**
   * Check if BOOT.md has been run (marker file exists).
   */
  isBootComplete(): boolean {
    return existsSync(join(this.workspacePath, ".boot-complete"));
  }

  /**
   * Mark BOOT.md as complete.
   */
  markBootComplete(): void {
    const markerPath = join(this.workspacePath, ".boot-complete");
    try {
      writeFileSync(markerPath, new Date().toISOString());
    } catch {
      // Ignore write errors
    }
  }

  /**
   * Load all bootstrap files at once.
   */
  loadAll(role?: string): WorkspaceBootstrap {
    return {
      agents: this.loadAgents(),
      soul: this.loadSoul(role),
      identity: this.loadIdentity(),
      tools: this.loadTools(),
      heartbeat: this.loadHeartbeat(),
      user: this.loadUser()
    };
  }

  /**
   * Load skills from workspace.
   * Following OpenClaw's skills pattern.
   */
  loadSkills(): SkillsContext {
    const loader = getSkillsLoader();
    return loader.load();
  }

  /**
   * Get skill instructions for the system prompt.
   */
  getSkillInstructions(): string {
    const loader = getSkillsLoader();
    return loader.getInstructions();
  }

  /**
   * Build a system prompt from workspace files.
   * Combines AGENTS.md + SOUL.md (for role) into a coherent prompt.
   * Falls back to a generic default if no files exist.
   *
   * @param role - Agent role for soul file lookup
   * @param mode - Prompt mode: "full" (default) or "minimal" (for sub-agents/heartbeats)
   * @param includeSkills - Whether to include skill instructions (default: true for full mode)
   *
   * Following OpenClaw's promptMode pattern:
   * - "full": SOUL + AGENTS + skills + all context (default for main agent)
   * - "minimal": AGENTS + TOOLS only (for sub-agents, reduces token usage)
   */
  buildSystemPrompt(role?: string, mode: PromptMode = "full", includeSkills = true): string {
    const parts: string[] = [];

    if (mode === "full") {
      // Full mode: include SOUL.md (persona)
      const soul = this.loadSoul(role);
      if (soul) {
        parts.push(soul.trim());
      }
    }

    // Both modes: include AGENTS.md (operating rules)
    const agents = this.loadAgents();
    if (agents) {
      parts.push("## Operating Rules\n\n" + agents.trim());
    }

    if (mode === "minimal") {
      // Minimal mode: also include TOOLS.md if available
      const tools = this.loadTools();
      if (tools) {
        parts.push("## Tools\n\n" + tools.trim());
      }
    }

    // Include skills in full mode (OpenClaw-compatible)
    if (mode === "full" && includeSkills) {
      const skillInstructions = this.getSkillInstructions();
      if (skillInstructions) {
        parts.push(skillInstructions);
      }
    }

    if (parts.length === 0) {
      // Generic fallback when no workspace files exist
      const modeNote = mode === "minimal" ? " (minimal context)" : "";
      return `You are a helpful AI assistant${role ? ` (role: ${role})` : ""}${modeNote}. Follow instructions carefully and provide accurate, helpful responses.`;
    }

    return parts.join("\n\n");
  }

  /**
   * Load memory context from workspace.
   * Following OpenClaw's memory pattern:
   * - MEMORY.md: curated long-term memory
   * - memory/YYYY-MM-DD.md: daily logs (today + yesterday)
   *
   * Returns combined memory content or null if no memory files exist.
   */
  loadMemoryContext(): string | null {
    const parts: string[] = [];

    // Load curated long-term memory
    const longTermMemory = this.readFile("MEMORY.md");
    if (longTermMemory) {
      parts.push("### Long-term Memory\n\n" + longTermMemory.trim());
    }

    // Load today's and yesterday's daily logs
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const formatDate = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const todayLog = this.readFile(`memory/${formatDate(today)}.md`);
    const yesterdayLog = this.readFile(`memory/${formatDate(yesterday)}.md`);

    if (yesterdayLog) {
      parts.push(`### Yesterday (${formatDate(yesterday)})\n\n` + yesterdayLog.trim());
    }

    if (todayLog) {
      parts.push(`### Today (${formatDate(today)})\n\n` + todayLog.trim());
    }

    if (parts.length === 0) {
      return null;
    }

    return parts.join("\n\n");
  }

  /**
   * Clear the cache (useful if files may have changed).
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get the resolved workspace path.
   */
  getWorkspacePath(): string {
    return this.workspacePath;
  }

  /**
   * Build time context string for system prompt.
   * Following OpenClaw's time context pattern.
   */
  buildTimeContext(timezone?: string): string {
    const now = new Date();
    const tz = timezone || config.defaultTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Format date and time
    const dateFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });

    const timeFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });

    const date = dateFormatter.format(now);
    const time = timeFormatter.format(now);

    return `## Current Time\n\n- **Date:** ${date}\n- **Time:** ${time}\n- **Timezone:** ${tz}`;
  }

  /**
   * Check if the workspace path exists and is accessible.
   */
  isAccessible(): boolean {
    return existsSync(this.workspacePath);
  }

  /**
   * Get the max chars limit.
   */
  getMaxChars(): number {
    return this.maxChars;
  }

  /**
   * Get context statistics for all bootstrap files.
   * Following OpenClaw's /context pattern for visibility into prompt sizes.
   */
  getContextStats(role?: string): ContextStats {
    const files: FileStats[] = [];
    let totalChars = 0;

    // Load each file and track stats
    const fileSpecs: Array<{ name: string; loader: () => string | null }> = [
      { name: "AGENTS.md", loader: () => this.loadAgents() },
      { name: role ? `souls/${role}.md` : "SOUL.md", loader: () => this.loadSoul(role) },
      { name: "IDENTITY.md", loader: () => this.loadIdentity() },
      { name: "TOOLS.md", loader: () => this.loadTools() },
      { name: "HEARTBEAT.md", loader: () => this.loadHeartbeat() },
      { name: "USER.md", loader: () => this.loadUser() }
    ];

    for (const spec of fileSpecs) {
      const content = spec.loader();
      const rawPath = join(this.workspacePath, spec.name);
      let rawChars = 0;
      let exists = false;

      try {
        if (existsSync(rawPath)) {
          exists = true;
          rawChars = readFileSync(rawPath, "utf-8").length;
        }
      } catch {
        // File read error
      }

      const injectedChars = content?.length ?? 0;
      const truncated = rawChars > this.maxChars;

      files.push({
        name: spec.name,
        exists,
        rawChars,
        injectedChars,
        truncated,
        estimatedTokens: Math.ceil(injectedChars / 4) // Rough estimate: ~4 chars per token
      });

      totalChars += injectedChars;
    }

    // Build system prompt to get final size
    const systemPrompt = this.buildSystemPrompt(role);
    const systemPromptChars = systemPrompt.length;

    return {
      workspacePath: this.workspacePath,
      maxCharsPerFile: this.maxChars,
      files,
      totalBootstrapChars: totalChars,
      systemPromptChars,
      estimatedSystemPromptTokens: Math.ceil(systemPromptChars / 4)
    };
  }
}

/**
 * Stats for a single bootstrap file.
 */
export interface FileStats {
  name: string;
  exists: boolean;
  rawChars: number;
  injectedChars: number;
  truncated: boolean;
  estimatedTokens: number;
}

/**
 * Context statistics for the workspace.
 * Following OpenClaw's /context pattern.
 */
export interface ContextStats {
  workspacePath: string;
  maxCharsPerFile: number;
  files: FileStats[];
  totalBootstrapChars: number;
  systemPromptChars: number;
  estimatedSystemPromptTokens: number;
}

/**
 * Default workspace loader instance.
 * Uses the workspace path from config/environment.
 */
let defaultLoader: WorkspaceLoader | null = null;

export function getWorkspaceLoader(): WorkspaceLoader {
  if (!defaultLoader) {
    defaultLoader = new WorkspaceLoader();
  }
  return defaultLoader;
}

/**
 * Reset the default loader (useful for testing or config changes).
 */
export function resetWorkspaceLoader(): void {
  defaultLoader = null;
}
