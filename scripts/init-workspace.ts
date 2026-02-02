#!/usr/bin/env node
/**
 * Initialize a Wombat workspace from the built-in template.
 * Creates workspace/ (or WOMBAT_WORKSPACE) with AGENTS.md, SOUL.md, etc.
 * Skips existing files unless --force.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const templateDir = path.join(repoRoot, "templates", "workspace");

const force = process.argv.includes("--force");
const targetDir = process.env.WOMBAT_WORKSPACE || path.join(process.cwd(), "workspace");

function copyRecursive(src: string, dest: string): { created: string[]; skipped: string[] } {
  const created: string[] = [];
  const skipped: string[] = [];

  if (!fs.existsSync(src)) {
    console.error(`Template not found: ${src}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
        created.push(destPath);
      }
      const sub = copyRecursive(srcPath, destPath);
      created.push(...sub.created);
      skipped.push(...sub.skipped);
    } else {
      if (fs.existsSync(destPath) && !force) {
        skipped.push(destPath);
        continue;
      }
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
      created.push(destPath);
    }
  }
  return { created, skipped };
}

function main() {
  console.log(`Initializing workspace at: ${targetDir}`);
  if (force) console.log("(--force: overwriting existing files)");

  const { created, skipped } = copyRecursive(templateDir, targetDir);

  if (created.length) {
    console.log("Created:");
    created.forEach((p) => console.log("  ", path.relative(process.cwd(), p)));
  }
  if (skipped.length) {
    console.log("Skipped (already exist; use --force to overwrite):");
    skipped.forEach((p) => console.log("  ", path.relative(process.cwd(), p)));
  }
  console.log("\nNext: configure .env (BACKEND_URL, AGENT_JWT_SECRET, LLM keys) and run npm run dev");
}

main();
