#!/usr/bin/env node
import { Command } from "commander";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const packageRoot = join(__dirname, "..");
const templateDir = join(packageRoot, "templates", "workspace");

function copyWorkspaceTemplate(targetDir: string, force: boolean): { created: string[]; skipped: string[] } {
  const created: string[] = [];
  const skipped: string[] = [];

  function copyRecursive(src: string, dest: string): void {
    const entries = readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);
      if (entry.isDirectory()) {
        if (!existsSync(destPath)) mkdirSync(destPath, { recursive: true });
        copyRecursive(srcPath, destPath);
      } else {
        if (existsSync(destPath) && !force) {
          skipped.push(destPath);
          continue;
        }
        mkdirSync(dirname(destPath), { recursive: true });
        copyFileSync(srcPath, destPath);
        created.push(destPath);
      }
    }
  }

  if (!existsSync(templateDir)) {
    console.error("Template not found. Run from package root or use: npm run init-workspace");
    process.exit(1);
  }
  mkdirSync(targetDir, { recursive: true });
  copyRecursive(templateDir, targetDir);
  return { created, skipped };
}

const program = new Command();

program.name("wombat").description("Wombat agent daemon utilities").version("0.1.0");

program
  .command("init [dir]")
  .description("Create a workspace from the built-in template (default: ./workspace)")
  .option("-f, --force", "Overwrite existing files")
  .action((dir, opts) => {
    const targetDir = join(process.cwd(), dir || process.env.WOMBAT_WORKSPACE || "workspace");
    const force = opts.force === true;
    console.log(`Initializing workspace at: ${targetDir}`);
    if (force) console.log("(--force: overwriting existing files)");
    const { created, skipped } = copyWorkspaceTemplate(targetDir, force);
    if (created.length) {
      console.log("Created:");
      created.forEach((p) => console.log("  ", p));
    }
    if (skipped.length) {
      console.log("Skipped (already exist; use --force to overwrite):");
      skipped.forEach((p) => console.log("  ", p));
    }
    console.log("\nNext: configure .env (BACKEND_URL, AGENT_JWT_SECRET, LLM keys) and run npm run dev");
  });

program
  .command("serve")
  .description("Start the agent daemon HTTP server")
  .action(() => {
    spawn("node", ["dist/server/index.js"], { stdio: "inherit" });
  });

program
  .command("dispatcher")
  .description("Run the notification dispatcher loop")
  .action(() => {
    spawn("node", ["dist/scripts/notification_dispatcher.js"], { stdio: "inherit" });
  });

program
  .command("heartbeat")
  .description("Run a heartbeat (set USER_ID, AGENT_ROLE)")
  .action(() => {
    spawn("node", ["dist/scripts/heartbeat.js"], { stdio: "inherit" });
  });

program
  .command("standup")
  .description("Run a daily standup (set USER_ID, AGENT_ROLE)")
  .action(() => {
    spawn("node", ["dist/scripts/daily_standup.js"], { stdio: "inherit" });
  });

program.parse();
