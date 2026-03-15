// scopedb-mcp — Config loader (YAML + env var expansion)

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { validateConfig } from "./validator.js";
import type { ScopeDBConfig } from "./types.js";

/**
 * Expand ${ENV_VAR} references in a string using process.env.
 */
function expandEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, key) => {
    const envValue = process.env[key];
    if (envValue === undefined) {
      throw new Error(`Environment variable \${${key}} is not set`);
    }
    return envValue;
  });
}

/**
 * Recursively expand env vars in all string values of an object.
 */
function expandDeep(obj: unknown): unknown {
  if (typeof obj === "string") {
    return expandEnvVars(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(expandDeep);
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = expandDeep(value);
    }
    return result;
  }
  return obj;
}

/**
 * Load and validate a scopedb config file.
 */
export function loadConfig(configPath: string): ScopeDBConfig {
  const raw = readFileSync(configPath, "utf-8");
  const parsed = parseYaml(raw);
  const expanded = expandDeep(parsed);
  return validateConfig(expanded) as ScopeDBConfig;
}
