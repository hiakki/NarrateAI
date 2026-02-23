export function safeParseLlmJson(raw: string): unknown {
  let text = raw.trim();

  // Strip markdown code fences if present
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  // First attempt: direct parse
  try {
    return JSON.parse(text);
  } catch {
    // continue to repair
  }

  // Remove trailing commas before } or ]
  let repaired = text.replace(/,\s*([\]}])/g, "$1");

  // Fix unescaped newlines inside string values
  repaired = repaired.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match) => {
    return match.replace(/(?<!\\)\n/g, "\\n").replace(/(?<!\\)\r/g, "\\r").replace(/(?<!\\)\t/g, "\\t");
  });

  try {
    return JSON.parse(repaired);
  } catch {
    // continue
  }

  // Truncated JSON: try closing open braces/brackets
  let balanced = repaired;
  const opens = (balanced.match(/{/g) || []).length;
  const closes = (balanced.match(/}/g) || []).length;
  const openBrackets = (balanced.match(/\[/g) || []).length;
  const closeBrackets = (balanced.match(/]/g) || []).length;

  // Trim to last complete value (look for last `}` or `"`)
  const lastComplete = Math.max(balanced.lastIndexOf("}"), balanced.lastIndexOf('"'));
  if (lastComplete > 0) {
    balanced = balanced.slice(0, lastComplete + 1);
  }

  // Re-count after trim
  const o2 = (balanced.match(/{/g) || []).length;
  const c2 = (balanced.match(/}/g) || []).length;
  const ob2 = (balanced.match(/\[/g) || []).length;
  const cb2 = (balanced.match(/]/g) || []).length;

  balanced += "]".repeat(Math.max(0, ob2 - cb2));
  balanced += "}".repeat(Math.max(0, o2 - c2));

  // Remove trailing commas again after surgery
  balanced = balanced.replace(/,\s*([\]}])/g, "$1");

  try {
    return JSON.parse(balanced);
  } catch {
    // nothing worked
  }

  throw new Error(
    `Failed to parse LLM JSON (len=${raw.length}). ` +
    `First 200 chars: ${raw.slice(0, 200)}... Last 200 chars: ...${raw.slice(-200)}`
  );
}
