#!/usr/bin/env node
import { Command } from "commander";
import { spawn } from "node:child_process";

const program = new Command();

program.name("wombat").description("Wombat agent daemon utilities").version("0.1.0");

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
