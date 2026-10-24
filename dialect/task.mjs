import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

function readJson(name) {
  return JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export const COMPANY = deepFreeze(readJson("./company.json"));
export const QUERY_SPEC_SCHEMA = deepFreeze(readJson("./query-spec.schema.json"));

export const SYSTEM_PROMPT = [
  `You interpret analytics questions for ${COMPANY.name}. Apply its definitions exactly.`,
  `Reference date: ${COMPANY.reference_date}. Timezone: ${COMPANY.timezone}. Currency: ${COMPANY.currency}.`,
  ...COMPANY.definitions.map(({ id, rule }) => `${id}: ${rule}`),
  "Reply with one JSON object only: either a query with all six fields (use null for unused optional dimensions), or the error object. No SQL, prose, markdown or extra keys.",
  `JSON Schema: ${JSON.stringify(QUERY_SPEC_SCHEMA)}`,
].join("\n");

// JSON mode supports both query and error objects. The checker will validate
// against QUERY_SPEC_SCHEMA; JSON mode alone does not enforce that schema.
export const MODEL = "gpt-6-sol";
export const RESPONSE_FORMAT = deepFreeze({ type: "json_object" });
export const REQUEST_SETTINGS = deepFreeze({
  max_completion_tokens: 2048,
  reasoning_effort: "medium",
});

export const TASK_SIGNATURE = deepFreeze({
  version: 2,
  company: COMPANY.id,
  company_sha256: sha256(JSON.stringify(COMPANY)),
  system_prompt_sha256: sha256(SYSTEM_PROMPT),
  schema_sha256: sha256(JSON.stringify(QUERY_SPEC_SCHEMA)),
  model: MODEL,
  response_format: RESPONSE_FORMAT,
  request_settings: REQUEST_SETTINGS,
  tools: [],
  tool_choice: null,
});

export function assertTaskLock() {
  const locked = readJson("./task-lock.json");
  if (JSON.stringify(locked) !== JSON.stringify(TASK_SIGNATURE)) {
    throw new Error(
      "Dialect task changed. Restore the locked definitions/schema/prompt/model/output format, or deliberately create a new task version before sending traffic.",
    );
  }
}
