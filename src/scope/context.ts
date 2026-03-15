// scopedb-mcp — Runtime context parameter resolution

/**
 * Resolve :variable placeholders in a row_filter string.
 * Uses parameterized replacement (not string concat) to prevent injection.
 */
export function resolveContextParams(
  rowFilter: string,
  context: Record<string, string>,
): string {
  return rowFilter.replace(/:(\w+)/g, (match, paramName) => {
    const value = context[paramName];
    if (value === undefined) {
      throw new Error(`Context parameter :${paramName} is required but not provided`);
    }
    // Escape single quotes to prevent SQL injection
    const escaped = value.replace(/'/g, "''");
    return `'${escaped}'`;
  });
}
