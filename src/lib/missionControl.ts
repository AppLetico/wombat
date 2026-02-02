import { config } from "./config.js";

export type MissionControlMessage = {
  task_id: string;
  content: string;
  actor_type?: "agent" | "user";
  actor_id?: string;
  agent_role?: string;
  attachments?: Record<string, any> | null;
  idempotency_key?: string;
};

export type MissionControlDocument = {
  title: string;
  content: string;
  doc_type?: string;
  task_id?: string;
  idempotency_key?: string;
};

export type MissionControlTask = {
  id: string;
  title: string;
  status: string;
  description?: string;
};

export async function listTasks(agentToken: string): Promise<MissionControlTask[]> {
  const resp = await fetch(`${config.backendUrl}/api/mission-control/tasks?limit=50`, {
    headers: { "X-Agent-Token": agentToken }
  });
  if (!resp.ok) {
    throw new Error(`Failed to list tasks: ${resp.status}`);
  }
  const payload = await resp.json();
  return payload.items || [];
}

export async function createTask(agentToken: string, payload: {
  title: string;
  description?: string;
  status?: string;
  metadata?: Record<string, any>;
}) {
  const resp = await fetch(`${config.backendUrl}/api/mission-control/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Token": agentToken
    },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    throw new Error(`Failed to create task: ${resp.status}`);
  }
  return resp.json();
}

export async function postMessage(agentToken: string, message: MissionControlMessage) {
  const resp = await fetch(`${config.backendUrl}/api/mission-control/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Token": agentToken
    },
    body: JSON.stringify(message)
  });
  if (!resp.ok) {
    throw new Error(`Failed to post message: ${resp.status}`);
  }
  return resp.json();
}

export async function postDocument(agentToken: string, doc: MissionControlDocument) {
  const resp = await fetch(`${config.backendUrl}/api/mission-control/documents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Token": agentToken
    },
    body: JSON.stringify(doc)
  });
  if (!resp.ok) {
    throw new Error(`Failed to post document: ${resp.status}`);
  }
  return resp.json();
}
