import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

// AI features are strictly additive: without an API key every entry point
// no-ops and the app runs fully on human-entered data.

export const AI_MODEL = process.env.AI_MODEL || "claude-opus-5";

let client: Anthropic | null = null;

export function aiEnabled(): boolean {
  return env.ANTHROPIC_API_KEY.length > 0;
}

export function getAiClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return client;
}

/** Extract the first JSON object from a model response, defensively. */
export function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
