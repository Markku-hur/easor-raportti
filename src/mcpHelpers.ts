/** Wraps a value as the standard JSON-text tool result shape used by every tool. */
export function jsonContent(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
