import { SignJWT } from "jose";
import { config } from "./config.js";

export function parseSessionKey(sessionKey: string): { userId: string; role: string } {
  const parts = sessionKey.split(":");
  if (parts.length < 3 || parts[0] !== "user") {
    throw new Error("Invalid session_key format. Expected user:{userId}:{role}");
  }
  return { userId: parts[1], role: parts[2] };
}

export async function buildAgentToken(userId: string, role: string): Promise<string> {
  if (!config.agentJwtSecret) {
    throw new Error("AGENT_JWT_SECRET is required to mint agent tokens.");
  }
  const encoder = new TextEncoder();
  const secret = encoder.encode(config.agentJwtSecret);
  return await new SignJWT({
    type: "agent",
    user_id: userId,
    agent_role: role,
    sub: `wombat:${role}`
  })
    .setProtectedHeader({ alg: config.agentJwtAlgorithm })
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);
}
