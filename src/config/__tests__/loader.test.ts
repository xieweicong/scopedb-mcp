import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../loader.js";

const testDir = join(tmpdir(), "scopedb-test-" + Date.now());
const configPath = join(testDir, "scopedb.config.yaml");

const VALID_CONFIG = `
version: 1
database:
  adapter: supabase
  url: "https://test.supabase.co"
  key: "test-key"
tables:
  users:
    description: "Users table"
    columns:
      id:
        type: uuid
      name:
        type: text
        description: "Username"
      email:
        type: text
scopes:
  default:
    description: "Default scope"
    tables:
      users:
        access: read
        columns: [name]
`;

beforeEach(() => {
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  try { unlinkSync(configPath); } catch {}
});

describe("loadConfig", () => {
  it("should load and validate a valid YAML config", () => {
    writeFileSync(configPath, VALID_CONFIG);
    const config = loadConfig(configPath);

    expect(config.version).toBe(1);
    expect(config.database.adapter).toBe("supabase");
    expect(config.tables.users.description).toBe("Users table");
    expect(config.scopes.default.tables.users.columns).toEqual(["name"]);
  });

  it("should expand environment variables", () => {
    process.env.TEST_SCOPEDB_URL = "https://env.supabase.co";
    process.env.TEST_SCOPEDB_KEY = "env-key";

    const configWithEnv = VALID_CONFIG
      .replace('"https://test.supabase.co"', '${TEST_SCOPEDB_URL}')
      .replace('"test-key"', '${TEST_SCOPEDB_KEY}');

    writeFileSync(configPath, configWithEnv);
    const config = loadConfig(configPath);

    expect(config.database.url).toBe("https://env.supabase.co");
    expect(config.database.key).toBe("env-key");

    delete process.env.TEST_SCOPEDB_URL;
    delete process.env.TEST_SCOPEDB_KEY;
  });

  it("should throw on missing env var", () => {
    const configWithMissing = VALID_CONFIG
      .replace('"https://test.supabase.co"', '${MISSING_VAR_XXXXX}');
    writeFileSync(configPath, configWithMissing);

    expect(() => loadConfig(configPath)).toThrow("MISSING_VAR_XXXXX");
  });

  it("should throw on invalid config (missing tables)", () => {
    const invalid = `
version: 1
database:
  adapter: supabase
  url: "https://test.supabase.co"
  key: "test-key"
scopes:
  default:
    tables:
      users:
        access: read
        columns: [name]
`;
    writeFileSync(configPath, invalid);
    expect(() => loadConfig(configPath)).toThrow();
  });
});
