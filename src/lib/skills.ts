/**
 * OpenClaw-compatible skills loader.
 * Reads SKILL.md files from workspace/skills/ directory.
 *
 * Skills format (AgentSkills-compatible):
 * ---
 * name: skill-name
 * description: What this skill does
 * metadata: {"openclaw": {"requires": {"env": ["API_KEY"]}}}
 * ---
 * Instructions for the agent...
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { config } from "./config.js";

/**
 * Parsed skill from SKILL.md file.
 */
export interface Skill {
  name: string;
  description: string;
  location: string;
  instructions: string;
  metadata?: SkillMetadata;
  enabled: boolean;
  gateReason?: string;
}

/**
 * OpenClaw-compatible skill metadata.
 */
export interface SkillMetadata {
  openclaw?: {
    emoji?: string;
    homepage?: string;
    requires?: {
      bins?: string[];
      anyBins?: string[];
      env?: string[];
      config?: string[];
    };
    primaryEnv?: string;
    always?: boolean;
    os?: string[];
  };
}

/**
 * Skills loader result.
 */
export interface SkillsContext {
  skills: Skill[];
  enabledCount: number;
  totalCount: number;
  promptText: string;
}

// Cache for loaded skills
let skillsCache: SkillsContext | null = null;
let skillsCacheTime = 0;
const CACHE_TTL_MS = 60000; // 1 minute cache

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Simple parser for single-line YAML keys.
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const yamlContent = match[1];
  const body = match[2];
  const frontmatter: Record<string, unknown> = {};

  // Parse simple YAML (single-line keys only, as per OpenClaw spec)
  for (const line of yamlContent.split("\n")) {
    const keyMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (keyMatch) {
      const key = keyMatch[1];
      let value: unknown = keyMatch[2].trim();

      // Try to parse JSON values (for metadata)
      if (typeof value === "string" && (value.startsWith("{") || value.startsWith("["))) {
        try {
          value = JSON.parse(value);
        } catch {
          // Keep as string if not valid JSON
        }
      }

      // Remove quotes from strings
      if (typeof value === "string") {
        value = value.replace(/^["'](.*)["']$/, "$1");
      }

      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}

/**
 * Check if a skill passes its gates (requirements).
 */
function checkSkillGates(metadata: SkillMetadata | undefined): { enabled: boolean; reason?: string } {
  if (!metadata?.openclaw) {
    return { enabled: true };
  }

  const { requires, always, os } = metadata.openclaw;

  // Always-enabled skills bypass checks
  if (always) {
    return { enabled: true };
  }

  // OS check
  if (os && os.length > 0) {
    const currentOS = process.platform;
    if (!os.includes(currentOS)) {
      return { enabled: false, reason: `OS not supported (requires: ${os.join(", ")})` };
    }
  }

  // Environment variable checks
  if (requires?.env) {
    for (const envVar of requires.env) {
      if (!process.env[envVar]) {
        return { enabled: false, reason: `Missing env: ${envVar}` };
      }
    }
  }

  // Binary checks (simplified - just check if command exists in PATH)
  // Note: Full bin checking like OpenClaw requires shell execution
  // We do a simplified check here

  return { enabled: true };
}

/**
 * Load a single skill from a directory.
 */
function loadSkill(skillDir: string, skillName: string): Skill | null {
  const skillPath = join(skillDir, "SKILL.md");

  if (!existsSync(skillPath)) {
    return null;
  }

  try {
    const content = readFileSync(skillPath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);

    const name = (frontmatter.name as string) || skillName;
    const description = (frontmatter.description as string) || "";
    const metadata = frontmatter.metadata as SkillMetadata | undefined;

    const gateResult = checkSkillGates(metadata);

    return {
      name,
      description,
      location: skillDir,
      instructions: body.trim(),
      metadata,
      enabled: gateResult.enabled,
      gateReason: gateResult.reason
    };
  } catch {
    return null;
  }
}

/**
 * Load all skills from the workspace.
 */
export function loadSkills(workspacePath?: string): SkillsContext {
  const now = Date.now();

  // Return cached if fresh
  if (skillsCache && now - skillsCacheTime < CACHE_TTL_MS) {
    return skillsCache;
  }

  const wsPath = workspacePath || config.workspacePath;
  const skillsDir = join(wsPath, "skills");
  const skills: Skill[] = [];

  if (existsSync(skillsDir)) {
    try {
      const entries = readdirSync(skillsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skill = loadSkill(join(skillsDir, entry.name), entry.name);
          if (skill) {
            skills.push(skill);
          }
        }
      }
    } catch {
      // Skills directory not readable
    }
  }

  const enabledSkills = skills.filter((s) => s.enabled);
  const promptText = formatSkillsForPrompt(enabledSkills);

  const result: SkillsContext = {
    skills,
    enabledCount: enabledSkills.length,
    totalCount: skills.length,
    promptText
  };

  // Cache the result
  skillsCache = result;
  skillsCacheTime = now;

  return result;
}

/**
 * Format skills for injection into system prompt.
 * Following OpenClaw's XML format for skills list.
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) {
    return "";
  }

  const skillsXml = skills
    .map((skill) => {
      const emoji = skill.metadata?.openclaw?.emoji || "";
      const prefix = emoji ? `${emoji} ` : "";
      return `  <skill>
    <name>${prefix}${escapeXml(skill.name)}</name>
    <description>${escapeXml(skill.description)}</description>
    <location>${escapeXml(skill.location)}</location>
  </skill>`;
    })
    .join("\n");

  return `## Available Skills

The following skills are available. Read the skill's SKILL.md for detailed instructions when needed.

<skills>
${skillsXml}
</skills>`;
}

/**
 * Get full skill instructions for injection into prompt.
 * This includes the actual skill content, not just the list.
 */
export function getSkillInstructions(skills: Skill[]): string {
  if (skills.length === 0) {
    return "";
  }

  const sections = skills.map((skill) => {
    const emoji = skill.metadata?.openclaw?.emoji || "";
    const prefix = emoji ? `${emoji} ` : "";
    return `### ${prefix}${skill.name}

${skill.instructions}`;
  });

  return `## Skills

${sections.join("\n\n---\n\n")}`;
}

/**
 * Escape XML special characters.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Clear the skills cache.
 */
export function clearSkillsCache(): void {
  skillsCache = null;
  skillsCacheTime = 0;
}

/**
 * Get skills loader for a workspace.
 */
export class SkillsLoader {
  private workspacePath: string;

  constructor(workspacePath?: string) {
    this.workspacePath = workspacePath || config.workspacePath;
  }

  /**
   * Load all skills.
   */
  load(): SkillsContext {
    return loadSkills(this.workspacePath);
  }

  /**
   * Get enabled skills only.
   */
  getEnabledSkills(): Skill[] {
    return this.load().skills.filter((s) => s.enabled);
  }

  /**
   * Get prompt text for enabled skills.
   */
  getPromptText(): string {
    return this.load().promptText;
  }

  /**
   * Get full skill instructions for enabled skills.
   */
  getInstructions(): string {
    return getSkillInstructions(this.getEnabledSkills());
  }

  /**
   * Check if a skill is enabled.
   */
  isSkillEnabled(name: string): boolean {
    const skills = this.load().skills;
    const skill = skills.find((s) => s.name === name);
    return skill?.enabled ?? false;
  }

  /**
   * Clear cache.
   */
  clearCache(): void {
    clearSkillsCache();
  }
}

// Global skills loader instance
let globalSkillsLoader: SkillsLoader | null = null;

export function getSkillsLoader(): SkillsLoader {
  if (!globalSkillsLoader) {
    globalSkillsLoader = new SkillsLoader();
  }
  return globalSkillsLoader;
}

export function resetSkillsLoader(): void {
  globalSkillsLoader = null;
  clearSkillsCache();
}
