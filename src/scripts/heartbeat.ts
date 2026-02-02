import { config, requireEnv } from "../lib/config.js";
import { buildAgentToken } from "../lib/agentAuth.js";

const userId = process.env.USER_ID || "";
const agentRole = process.env.AGENT_ROLE || "jarvis";

async function main() {
  requireEnv("BACKEND_URL", config.backendUrl);
  requireEnv("USER_ID", userId);
  requireEnv("AGENT_JWT_SECRET", config.agentJwtSecret);

  const token = await buildAgentToken(userId, agentRole);
  const resp = await fetch(`${config.backendUrl}/api/mission-control/heartbeat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Token": token
    },
    body: JSON.stringify({ user_id: userId })
  });
  if (!resp.ok) {
    throw new Error(`heartbeat failed ${resp.status}`);
  }
  const payload = await resp.json();
  console.log(JSON.stringify(payload, null, 2));
}

main()
  .then(() => console.log("heartbeat_ok"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
