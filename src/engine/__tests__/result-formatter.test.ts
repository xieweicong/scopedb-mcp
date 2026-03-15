import { describe, it, expect } from "vitest";
import { formatResult, type CompactResult } from "../result-formatter.js";

describe("formatResult compact", () => {
  it("should produce aligned cols/rows", () => {
    const result = formatResult(
      {
        data: [
          { name: "Alice", amount: 100 },
          { name: "Bob", amount: 200 },
        ],
        total: 2,
      },
      "compact",
      10,
    ) as CompactResult;

    expect(result.cols).toEqual(["name", "amount"]);
    expect(result.rows).toEqual([
      ["Alice", 100],
      ["Bob", 200],
    ]);
  });

  it("should handle null nested objects (sparse joins)", () => {
    const result = formatResult(
      {
        data: [
          { product: "PC", users: { name: "Alice" } },
          { product: "Mouse", users: null },  // join returns null
        ],
        total: 2,
      },
      "compact",
      5,
    ) as CompactResult;

    expect(result.cols).toEqual(["product", "users.name"]);
    expect(result.rows).toEqual([
      ["PC", "Alice"],
      ["Mouse", null],  // null instead of misaligned
    ]);
  });

  it("should handle rows with different nested shapes", () => {
    const result = formatResult(
      {
        data: [
          { id: 1, meta: null },
          { id: 2, meta: { tag: "vip" } },
        ],
        total: 2,
      },
      "compact",
      3,
    ) as CompactResult;

    // "meta.tag" discovered from row 2, row 1 gets null
    expect(result.cols).toContain("meta.tag");
    expect(result.rows[0]).toEqual([1, null]);
    expect(result.rows[1]).toEqual([2, "vip"]);
  });

  it("should return empty for no data", () => {
    const result = formatResult(
      { data: [], total: 0 },
      "compact",
      0,
    ) as CompactResult;
    expect(result.cols).toEqual([]);
    expect(result.rows).toEqual([]);
  });
});

describe("formatResult full", () => {
  it("should pass data through unchanged", () => {
    const data = [{ name: "Alice" }];
    const result = formatResult({ data, total: 1 }, "full", 10);
    expect(result).toEqual({ data, total: 1, ms: 10 });
  });
});
