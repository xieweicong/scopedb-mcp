import { describe, expect, it } from "vitest";
import { getServeOptionsFromEnv, parseContextEnv } from "../mcp.js";

describe("parseContextEnv", () => {
  it("should parse JSON object values into string context", () => {
    expect(
      parseContextEnv('{"current_user_id":"user-123","tenant_id":42,"active":true}'),
    ).toEqual({
      current_user_id: "user-123",
      tenant_id: "42",
      active: "true",
    });
  });

  it("should return undefined when context env is missing", () => {
    expect(parseContextEnv(undefined)).toBeUndefined();
  });

  it("should reject invalid JSON", () => {
    expect(() => parseContextEnv("{bad json}")).toThrow(
      "SCOPEDB_CONTEXT must be valid JSON",
    );
  });

  it("should reject non-object JSON values", () => {
    expect(() => parseContextEnv('["user-123"]')).toThrow(
      "SCOPEDB_CONTEXT must be a JSON object",
    );
  });
});

describe("getServeOptionsFromEnv", () => {
  it("should read SCOPEDB_* env vars", () => {
    expect(
      getServeOptionsFromEnv({
        SCOPEDB_CONFIG: "/tmp/scopedb.config.yaml",
        SCOPEDB_SCOPE: "support",
        SCOPEDB_CONTEXT: '{"current_user_id":"user-123"}',
      }),
    ).toEqual({
      configPath: "/tmp/scopedb.config.yaml",
      scopeName: "support",
      context: {
        current_user_id: "user-123",
      },
    });
  });

  it("should fall back to the default config path", () => {
    expect(getServeOptionsFromEnv({})).toEqual({
      configPath: "./scopedb.config.yaml",
      scopeName: undefined,
      context: undefined,
    });
  });
});
