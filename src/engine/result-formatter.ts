// scopedb-mcp — Result formatter: query result → compact/full format

import type { ScopedSettings } from "../config/types.js";

interface RawResult {
  data: Record<string, unknown>[];
  total: number;
}

export interface CompactResult {
  cols: string[];
  rows: unknown[][];
  total: number;
  ms: number;
}

export interface FullResult {
  data: Record<string, unknown>[];
  total: number;
  ms: number;
}

export type FormattedResult = CompactResult | FullResult;

export function formatResult(
  raw: RawResult,
  format: ScopedSettings["result_format"],
  elapsedMs: number,
): FormattedResult {
  if (format === "compact") {
    return formatCompact(raw, elapsedMs);
  }
  return formatFull(raw, elapsedMs);
}

function formatCompact(raw: RawResult, ms: number): CompactResult {
  if (raw.data.length === 0) {
    return { cols: [], rows: [], total: 0, ms };
  }

  // Pass 1: identify which keys are nested objects in at least one row
  const nestedKeys = new Set<string>();
  for (const row of raw.data) {
    collectNestedKeys(row, "", nestedKeys);
  }

  // Pass 2: collect leaf keys, skipping null entries for known nested keys
  const colSet = new Set<string>();
  for (const row of raw.data) {
    collectLeafKeys(row, "", colSet, nestedKeys);
  }
  const cols = [...colSet];

  // Extract values for each row, using null for missing keys
  const rows = raw.data.map((row) => {
    const flat = flattenRow(row, "");
    return cols.map((col) => flat.has(col) ? flat.get(col) : null);
  });

  return { cols, rows, total: raw.total, ms };
}

function formatFull(raw: RawResult, ms: number): FullResult {
  return { data: raw.data, total: raw.total, ms };
}

/**
 * Pass 1: identify keys that are nested objects in at least one row.
 */
function collectNestedKeys(obj: Record<string, unknown>, prefix: string, nested: Set<string>): void {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)) {
      nested.add(fullKey);
      collectNestedKeys(value as Record<string, unknown>, fullKey, nested);
    }
  }
}

/**
 * Pass 2: collect leaf keys from a row.
 * If a key is null/undefined but known to be a nested object (from other rows), skip it.
 */
function collectLeafKeys(
  obj: Record<string, unknown>,
  prefix: string,
  keys: Set<string>,
  nestedKeys: Set<string>,
): void {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)) {
      collectLeafKeys(value as Record<string, unknown>, fullKey, keys, nestedKeys);
    } else if (nestedKeys.has(fullKey)) {
      // This is null/undefined for a key that's a nested object in other rows → skip
    } else {
      keys.add(fullKey);
    }
  }
}

/**
 * Flatten a row into a Map of "dotted.key" → value.
 * Handles null nested objects by not recursing into them.
 */
function flattenRow(obj: Record<string, unknown>, prefix: string): Map<string, unknown> {
  const result = new Map<string, unknown>();
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of flattenRow(value as Record<string, unknown>, fullKey)) {
        result.set(k, v);
      }
    } else {
      result.set(fullKey, value);
    }
  }
  return result;
}
