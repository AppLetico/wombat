import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import {
  SkillsLoader,
  loadSkills,
  formatSkillsForPrompt,
  getSkillInstructions,
  clearSkillsCache,
  type Skill
} from "./skills.js";

const TEST_WORKSPACE = "/tmp/wombat-skills-test";

describe("skills", () => {
  beforeEach(() => {
    // Create test workspace
    if (existsSync(TEST_WORKSPACE)) {
      rmSync(TEST_WORKSPACE, { recursive: true });
    }
    mkdirSync(join(TEST_WORKSPACE, "skills"), { recursive: true });
    clearSkillsCache();
  });

  afterEach(() => {
    if (existsSync(TEST_WORKSPACE)) {
      rmSync(TEST_WORKSPACE, { recursive: true });
    }
    clearSkillsCache();
  });

  describe("loadSkills", () => {
    it("loads skills from workspace/skills directory", () => {
      // Create a test skill
      const skillDir = join(TEST_WORKSPACE, "skills", "test-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: test-skill
description: A test skill
---
This is the skill instructions.`
      );

      const context = loadSkills(TEST_WORKSPACE);

      expect(context.totalCount).toBe(1);
      expect(context.enabledCount).toBe(1);
      expect(context.skills[0].name).toBe("test-skill");
      expect(context.skills[0].description).toBe("A test skill");
      expect(context.skills[0].instructions).toBe("This is the skill instructions.");
    });

    it("parses metadata from frontmatter", () => {
      const skillDir = join(TEST_WORKSPACE, "skills", "meta-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: meta-skill
description: Skill with metadata
metadata: {"openclaw": {"emoji": "🔧", "requires": {"env": ["TEST_API_KEY"]}}}
---
Instructions here.`
      );

      const context = loadSkills(TEST_WORKSPACE);

      expect(context.skills[0].metadata?.openclaw?.emoji).toBe("🔧");
      expect(context.skills[0].metadata?.openclaw?.requires?.env).toContain("TEST_API_KEY");
    });

    it("disables skills with missing env requirements", () => {
      const skillDir = join(TEST_WORKSPACE, "skills", "gated-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: gated-skill
description: Requires API key
metadata: {"openclaw": {"requires": {"env": ["NONEXISTENT_API_KEY_12345"]}}}
---
Instructions.`
      );

      const context = loadSkills(TEST_WORKSPACE);

      expect(context.skills[0].enabled).toBe(false);
      expect(context.skills[0].gateReason).toContain("Missing env");
    });

    it("enables skills with always: true", () => {
      const skillDir = join(TEST_WORKSPACE, "skills", "always-skill");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: always-skill
description: Always enabled
metadata: {"openclaw": {"always": true, "requires": {"env": ["NONEXISTENT_KEY"]}}}
---
Always runs.`
      );

      const context = loadSkills(TEST_WORKSPACE);

      expect(context.skills[0].enabled).toBe(true);
    });

    it("returns empty when no skills directory exists", () => {
      rmSync(join(TEST_WORKSPACE, "skills"), { recursive: true });

      const context = loadSkills(TEST_WORKSPACE);

      expect(context.totalCount).toBe(0);
      expect(context.enabledCount).toBe(0);
    });

    it("ignores directories without SKILL.md", () => {
      const skillDir = join(TEST_WORKSPACE, "skills", "incomplete");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "README.md"), "Not a skill");

      const context = loadSkills(TEST_WORKSPACE);

      expect(context.totalCount).toBe(0);
    });
  });

  describe("formatSkillsForPrompt", () => {
    it("formats skills as XML", () => {
      const skills: Skill[] = [
        {
          name: "test-skill",
          description: "A test skill",
          location: "/path/to/skill",
          instructions: "Instructions",
          enabled: true
        }
      ];

      const formatted = formatSkillsForPrompt(skills);

      expect(formatted).toContain("## Available Skills");
      expect(formatted).toContain("<skills>");
      expect(formatted).toContain("<name>test-skill</name>");
      expect(formatted).toContain("<description>A test skill</description>");
    });

    it("includes emoji in name", () => {
      const skills: Skill[] = [
        {
          name: "emoji-skill",
          description: "Has an emoji",
          location: "/path",
          instructions: "...",
          enabled: true,
          metadata: { openclaw: { emoji: "🎉" } }
        }
      ];

      const formatted = formatSkillsForPrompt(skills);

      expect(formatted).toContain("<name>🎉 emoji-skill</name>");
    });

    it("returns empty string for no skills", () => {
      const formatted = formatSkillsForPrompt([]);
      expect(formatted).toBe("");
    });

    it("escapes XML special characters", () => {
      const skills: Skill[] = [
        {
          name: "test<skill>",
          description: "Uses & symbols",
          location: "/path",
          instructions: "...",
          enabled: true
        }
      ];

      const formatted = formatSkillsForPrompt(skills);

      expect(formatted).toContain("&lt;");
      expect(formatted).toContain("&amp;");
    });
  });

  describe("getSkillInstructions", () => {
    it("returns full skill instructions", () => {
      const skills: Skill[] = [
        {
          name: "skill-1",
          description: "First skill",
          location: "/path",
          instructions: "Instructions for skill 1",
          enabled: true
        },
        {
          name: "skill-2",
          description: "Second skill",
          location: "/path",
          instructions: "Instructions for skill 2",
          enabled: true
        }
      ];

      const instructions = getSkillInstructions(skills);

      expect(instructions).toContain("## Skills");
      expect(instructions).toContain("### skill-1");
      expect(instructions).toContain("Instructions for skill 1");
      expect(instructions).toContain("### skill-2");
      expect(instructions).toContain("Instructions for skill 2");
    });
  });

  describe("SkillsLoader", () => {
    it("loads skills from configured workspace", () => {
      const skillDir = join(TEST_WORKSPACE, "skills", "loader-test");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: loader-test
description: Test skill
---
Test instructions.`
      );

      const loader = new SkillsLoader(TEST_WORKSPACE);
      const enabledSkills = loader.getEnabledSkills();

      expect(enabledSkills.length).toBe(1);
      expect(enabledSkills[0].name).toBe("loader-test");
    });

    it("checks if skill is enabled", () => {
      const skillDir = join(TEST_WORKSPACE, "skills", "check-test");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: check-test
description: Check test
---
Test.`
      );

      const loader = new SkillsLoader(TEST_WORKSPACE);

      expect(loader.isSkillEnabled("check-test")).toBe(true);
      expect(loader.isSkillEnabled("nonexistent")).toBe(false);
    });

    it("gets prompt text for enabled skills", () => {
      const skillDir = join(TEST_WORKSPACE, "skills", "prompt-test");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---
name: prompt-test
description: Prompt test skill
---
Prompt test instructions.`
      );

      const loader = new SkillsLoader(TEST_WORKSPACE);
      const promptText = loader.getPromptText();

      expect(promptText).toContain("<skills>");
      expect(promptText).toContain("prompt-test");
    });
  });
});
