import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { WorkspaceLoader, resetWorkspaceLoader } from "./workspace.js";
import { resetSkillsLoader } from "./skills.js";

const TEST_WORKSPACE = "./test-workspace-unit";

describe("WorkspaceLoader", () => {
  beforeEach(() => {
    // Create test workspace directory
    mkdirSync(TEST_WORKSPACE, { recursive: true });
    mkdirSync(join(TEST_WORKSPACE, "souls"), { recursive: true });
    resetWorkspaceLoader();
    resetSkillsLoader();
  });

  afterEach(() => {
    // Clean up test workspace
    rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    resetWorkspaceLoader();
    resetSkillsLoader();
  });

  describe("loadSoul", () => {
    it("loads SOUL.md as default", () => {
      writeFileSync(join(TEST_WORKSPACE, "SOUL.md"), "# Default Soul\n\nI am a helpful assistant.");
      
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const soul = loader.loadSoul();
      
      expect(soul).toContain("Default Soul");
      expect(soul).toContain("helpful assistant");
    });

    it("loads role-specific soul from souls/<role>.md", () => {
      writeFileSync(join(TEST_WORKSPACE, "SOUL.md"), "# Default Soul");
      writeFileSync(join(TEST_WORKSPACE, "souls", "analyst.md"), "# Analyst Soul\n\nI analyze data.");
      
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const soul = loader.loadSoul("analyst");
      
      expect(soul).toContain("Analyst Soul");
      expect(soul).toContain("analyze data");
    });

    it("falls back to SOUL.md when role-specific file doesn't exist", () => {
      writeFileSync(join(TEST_WORKSPACE, "SOUL.md"), "# Default Soul");
      
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const soul = loader.loadSoul("nonexistent");
      
      expect(soul).toContain("Default Soul");
    });

    it("returns null when no soul files exist", () => {
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const soul = loader.loadSoul();
      
      expect(soul).toBeNull();
    });
  });

  describe("loadAgents", () => {
    it("loads AGENTS.md", () => {
      writeFileSync(join(TEST_WORKSPACE, "AGENTS.md"), "## Operating Rules\n\n- Rule 1\n- Rule 2");
      
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const agents = loader.loadAgents();
      
      expect(agents).toContain("Operating Rules");
      expect(agents).toContain("Rule 1");
    });

    it("returns null when AGENTS.md doesn't exist", () => {
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const agents = loader.loadAgents();
      
      expect(agents).toBeNull();
    });
  });

  describe("loadIdentity", () => {
    it("loads IDENTITY.md", () => {
      writeFileSync(join(TEST_WORKSPACE, "IDENTITY.md"), "# Identity\n\nName: TestBot");
      
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const identity = loader.loadIdentity();
      
      expect(identity).toContain("TestBot");
    });
  });

  describe("loadHeartbeat", () => {
    it("loads HEARTBEAT.md", () => {
      writeFileSync(join(TEST_WORKSPACE, "HEARTBEAT.md"), "## On Wake\n\n- Check tasks");
      
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const heartbeat = loader.loadHeartbeat();
      
      expect(heartbeat).toContain("On Wake");
      expect(heartbeat).toContain("Check tasks");
    });
  });

  describe("loadAll", () => {
    it("loads all bootstrap files", () => {
      writeFileSync(join(TEST_WORKSPACE, "AGENTS.md"), "# Agents");
      writeFileSync(join(TEST_WORKSPACE, "SOUL.md"), "# Soul");
      writeFileSync(join(TEST_WORKSPACE, "IDENTITY.md"), "# Identity");
      writeFileSync(join(TEST_WORKSPACE, "TOOLS.md"), "# Tools");
      writeFileSync(join(TEST_WORKSPACE, "HEARTBEAT.md"), "# Heartbeat");
      writeFileSync(join(TEST_WORKSPACE, "USER.md"), "# User");
      
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const all = loader.loadAll();
      
      expect(all.agents).toContain("Agents");
      expect(all.soul).toContain("Soul");
      expect(all.identity).toContain("Identity");
      expect(all.tools).toContain("Tools");
      expect(all.heartbeat).toContain("Heartbeat");
      expect(all.user).toContain("User");
    });

    it("loads role-specific soul when role is provided", () => {
      writeFileSync(join(TEST_WORKSPACE, "SOUL.md"), "# Default");
      writeFileSync(join(TEST_WORKSPACE, "souls", "lead.md"), "# Lead Soul");
      
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const all = loader.loadAll("lead");
      
      expect(all.soul).toContain("Lead Soul");
    });
  });

  describe("buildSystemPrompt", () => {
    it("combines SOUL.md and AGENTS.md", () => {
      writeFileSync(join(TEST_WORKSPACE, "SOUL.md"), "# My Persona\n\nI am helpful.");
      writeFileSync(join(TEST_WORKSPACE, "AGENTS.md"), "# Rules\n\n- Be safe");
      
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const prompt = loader.buildSystemPrompt();
      
      expect(prompt).toContain("My Persona");
      expect(prompt).toContain("I am helpful");
      expect(prompt).toContain("Operating Rules");
      expect(prompt).toContain("Be safe");
    });

    it("returns only SOUL.md if AGENTS.md doesn't exist", () => {
      writeFileSync(join(TEST_WORKSPACE, "SOUL.md"), "# My Persona\n\nI am helpful.");
      
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const prompt = loader.buildSystemPrompt();
      
      expect(prompt).toContain("My Persona");
      expect(prompt).not.toContain("Operating Rules");
    });

    it("returns only AGENTS.md content if SOUL.md doesn't exist", () => {
      writeFileSync(join(TEST_WORKSPACE, "AGENTS.md"), "# Rules\n\n- Be safe");
      
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const prompt = loader.buildSystemPrompt();
      
      expect(prompt).toContain("Operating Rules");
      expect(prompt).toContain("Be safe");
    });

    it("returns generic fallback when no files exist", () => {
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      // Pass includeSkills=false to test fallback without skills
      const prompt = loader.buildSystemPrompt(undefined, "full", false);
      
      expect(prompt).toContain("helpful AI assistant");
    });

    it("includes role in fallback when provided", () => {
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      // Pass includeSkills=false to test fallback without skills
      const prompt = loader.buildSystemPrompt("analyst", "full", false);
      
      expect(prompt).toContain("role: analyst");
    });

    it("uses role-specific soul in combined prompt", () => {
      writeFileSync(join(TEST_WORKSPACE, "souls", "specialist.md"), "# Specialist\n\nI specialize.");
      writeFileSync(join(TEST_WORKSPACE, "AGENTS.md"), "# Rules\n\n- Follow rules");
      
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const prompt = loader.buildSystemPrompt("specialist");
      
      expect(prompt).toContain("Specialist");
      expect(prompt).toContain("I specialize");
      expect(prompt).toContain("Follow rules");
    });

    it("minimal mode excludes SOUL.md but includes AGENTS.md and TOOLS.md", () => {
      writeFileSync(join(TEST_WORKSPACE, "SOUL.md"), "# My Persona\n\nI am helpful.");
      writeFileSync(join(TEST_WORKSPACE, "AGENTS.md"), "# Rules\n\n- Be safe");
      writeFileSync(join(TEST_WORKSPACE, "TOOLS.md"), "# Tool Notes\n\n- Use APIs");
      
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const prompt = loader.buildSystemPrompt(undefined, "minimal");
      
      // Minimal mode should NOT include SOUL.md
      expect(prompt).not.toContain("My Persona");
      expect(prompt).not.toContain("I am helpful");
      
      // Minimal mode SHOULD include AGENTS.md and TOOLS.md
      expect(prompt).toContain("Operating Rules");
      expect(prompt).toContain("Be safe");
      expect(prompt).toContain("Tools");
      expect(prompt).toContain("Use APIs");
    });

    it("full mode includes SOUL.md but not TOOLS.md", () => {
      writeFileSync(join(TEST_WORKSPACE, "SOUL.md"), "# My Persona\n\nI am helpful.");
      writeFileSync(join(TEST_WORKSPACE, "AGENTS.md"), "# Rules\n\n- Be safe");
      writeFileSync(join(TEST_WORKSPACE, "TOOLS.md"), "# Tool Notes\n\n- Use APIs");
      
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const prompt = loader.buildSystemPrompt(undefined, "full");
      
      // Full mode SHOULD include SOUL.md and AGENTS.md
      expect(prompt).toContain("My Persona");
      expect(prompt).toContain("I am helpful");
      expect(prompt).toContain("Operating Rules");
      expect(prompt).toContain("Be safe");
      
      // Full mode should NOT include TOOLS.md in system prompt
      expect(prompt).not.toContain("Tool Notes");
    });
  });

  describe("caching", () => {
    it("caches file reads", () => {
      writeFileSync(join(TEST_WORKSPACE, "SOUL.md"), "# Original");
      
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const first = loader.loadSoul();
      
      // Modify file after first read
      writeFileSync(join(TEST_WORKSPACE, "SOUL.md"), "# Modified");
      
      const second = loader.loadSoul();
      
      // Should still return cached value
      expect(first).toBe(second);
      expect(second).toContain("Original");
    });

    it("clearCache allows re-reading files", () => {
      writeFileSync(join(TEST_WORKSPACE, "SOUL.md"), "# Original");
      
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const first = loader.loadSoul();
      
      // Modify file
      writeFileSync(join(TEST_WORKSPACE, "SOUL.md"), "# Modified");
      
      // Clear cache
      loader.clearCache();
      
      const second = loader.loadSoul();
      
      expect(second).toContain("Modified");
    });
  });

  describe("getWorkspacePath", () => {
    it("returns resolved workspace path", () => {
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const path = loader.getWorkspacePath();
      
      expect(path).toContain("test-workspace-unit");
    });
  });

  describe("loadMemoryContext", () => {
    it("returns null when no memory files exist", () => {
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const memory = loader.loadMemoryContext();
      
      expect(memory).toBeNull();
    });

    it("loads MEMORY.md as long-term memory", () => {
      writeFileSync(join(TEST_WORKSPACE, "MEMORY.md"), "# Long-term notes\n\nUser prefers dark mode.");
      
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const memory = loader.loadMemoryContext();
      
      expect(memory).toContain("Long-term Memory");
      expect(memory).toContain("User prefers dark mode");
    });

    it("loads today's daily log", () => {
      mkdirSync(join(TEST_WORKSPACE, "memory"), { recursive: true });
      
      const today = new Date();
      const formatDate = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      
      writeFileSync(join(TEST_WORKSPACE, "memory", `${formatDate(today)}.md`), "Discussed project roadmap.");
      
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const memory = loader.loadMemoryContext();
      
      expect(memory).toContain("Today");
      expect(memory).toContain("Discussed project roadmap");
    });

    it("loads yesterday's daily log", () => {
      mkdirSync(join(TEST_WORKSPACE, "memory"), { recursive: true });
      
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const formatDate = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      
      writeFileSync(join(TEST_WORKSPACE, "memory", `${formatDate(yesterday)}.md`), "Reviewed sprint backlog.");
      
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const memory = loader.loadMemoryContext();
      
      expect(memory).toContain("Yesterday");
      expect(memory).toContain("Reviewed sprint backlog");
    });

    it("combines all memory sources", () => {
      mkdirSync(join(TEST_WORKSPACE, "memory"), { recursive: true });
      
      const today = new Date();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const formatDate = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      
      writeFileSync(join(TEST_WORKSPACE, "MEMORY.md"), "User likes TypeScript.");
      writeFileSync(join(TEST_WORKSPACE, "memory", `${formatDate(yesterday)}.md`), "Started new project.");
      writeFileSync(join(TEST_WORKSPACE, "memory", `${formatDate(today)}.md`), "Working on features.");
      
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const memory = loader.loadMemoryContext();
      
      expect(memory).toContain("Long-term Memory");
      expect(memory).toContain("User likes TypeScript");
      expect(memory).toContain("Yesterday");
      expect(memory).toContain("Started new project");
      expect(memory).toContain("Today");
      expect(memory).toContain("Working on features");
    });
  });

  describe("buildTimeContext", () => {
    it("includes date, time, and timezone", () => {
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const timeContext = loader.buildTimeContext("America/New_York");

      expect(timeContext).toContain("## Current Time");
      expect(timeContext).toContain("**Date:**");
      expect(timeContext).toContain("**Time:**");
      expect(timeContext).toContain("**Timezone:**");
      expect(timeContext).toContain("America/New_York");
    });

    it("uses system timezone when not provided", () => {
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const timeContext = loader.buildTimeContext();

      // Should still have the structure
      expect(timeContext).toContain("## Current Time");
      expect(timeContext).toContain("**Timezone:**");
    });

    it("formats time in 12-hour format", () => {
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const timeContext = loader.buildTimeContext("UTC");

      // Should contain AM or PM
      expect(timeContext).toMatch(/AM|PM/);
    });
  });

  describe("truncation", () => {
    it("truncates files exceeding maxChars limit", () => {
      // Create a file larger than the custom limit
      const largeContent = "x".repeat(500);
      writeFileSync(join(TEST_WORKSPACE, "SOUL.md"), largeContent);
      
      // Use a small maxChars for testing
      const loader = new WorkspaceLoader(TEST_WORKSPACE, 100);
      const soul = loader.loadSoul();
      
      // Should be truncated
      expect(soul).not.toBeNull();
      expect(soul!.length).toBeLessThan(largeContent.length);
      expect(soul).toContain("[... content truncated");
    });

    it("does not truncate files under the limit", () => {
      const content = "# Short content\n\nThis is fine.";
      writeFileSync(join(TEST_WORKSPACE, "SOUL.md"), content);
      
      const loader = new WorkspaceLoader(TEST_WORKSPACE, 1000);
      const soul = loader.loadSoul();
      
      expect(soul).toBe(content);
      expect(soul).not.toContain("truncated");
    });

    it("uses default 20000 char limit", () => {
      // Create content just under the default limit
      const content = "x".repeat(19000);
      writeFileSync(join(TEST_WORKSPACE, "SOUL.md"), content);
      
      const loader = new WorkspaceLoader(TEST_WORKSPACE);
      const soul = loader.loadSoul();
      
      // Should not be truncated
      expect(soul).toBe(content);
    });
  });
});
