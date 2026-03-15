import { describe, it, expect } from "vitest";
import { compressColumns, compressTableOverview } from "../description-compress.js";
import type { ScopedColumn, ScopedTable } from "../../config/types.js";

describe("compressColumns", () => {
  it("should omit id columns", () => {
    const columns: ScopedColumn[] = [
      { name: "id", type: "uuid" },
      { name: "name", type: "text", description: "Name" },
    ];
    expect(compressColumns(columns)).toBe("name(Name)");
  });

  it("should omit description when it matches column name", () => {
    const columns: ScopedColumn[] = [
      { name: "name", type: "text", description: "name" },
    ];
    expect(compressColumns(columns)).toBe("name");
  });

  it("should include description when it differs from column name", () => {
    const columns: ScopedColumn[] = [
      { name: "name", type: "text", description: "Full name" },
      { name: "department", type: "text", description: "Department name" },
    ];
    expect(compressColumns(columns)).toBe("name(Full name), department(Department name)");
  });

  it("should show reference with arrow notation", () => {
    const columns: ScopedColumn[] = [
      { name: "user_id", type: "uuid", references: "users.id" },
    ];
    expect(compressColumns(columns)).toBe("user_id→users");
  });

  it("should combine description and reference", () => {
    const columns: ScopedColumn[] = [
      { name: "user_id", type: "uuid", description: "Owner", references: "users.id" },
    ];
    expect(compressColumns(columns)).toBe("user_id(Owner)→users");
  });

  it("should handle columns with no description or reference", () => {
    const columns: ScopedColumn[] = [
      { name: "created_at", type: "timestamp" },
    ];
    expect(compressColumns(columns)).toBe("created_at");
  });

  it("should handle empty column list", () => {
    expect(compressColumns([])).toBe("");
  });
});

describe("compressTableOverview", () => {
  it("should return compressed overview", () => {
    const table: ScopedTable = {
      name: "users",
      description: "Employee directory",
      access: ["read"],
      columns: [
        { name: "id", type: "uuid" },
        { name: "name", type: "text", description: "Full name" },
        { name: "department", type: "text", description: "Department name" },
      ],
    };
    const result = compressTableOverview(table);

    expect(result.description).toBe("Employee directory");
    expect(result.access).toBe("read");
    expect(result.columns).toBe("name(Full name), department(Department name)");
  });

  it("should handle read+write access", () => {
    const table: ScopedTable = {
      name: "orders",
      access: ["read", "write"],
      columns: [{ name: "status", type: "text" }],
    };
    const result = compressTableOverview(table);
    expect(result.access).toBe("read,write");
  });

  it("should default description to empty string", () => {
    const table: ScopedTable = {
      name: "orders",
      access: ["read"],
      columns: [],
    };
    const result = compressTableOverview(table);
    expect(result.description).toBe("");
  });
});
