import { describe, expect, it } from "vitest";
import { parseSessionKey } from "./agentAuth.js";

describe("parseSessionKey", () => {
  it("parses user and role", () => {
    const result = parseSessionKey("user:abc123:jarvis");
    expect(result.userId).toBe("abc123");
    expect(result.role).toBe("jarvis");
  });

  it("throws on invalid format", () => {
    expect(() => parseSessionKey("bad:key")).toThrow("Invalid session_key format");
  });
});
