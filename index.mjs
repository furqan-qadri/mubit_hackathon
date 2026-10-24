import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import OpenAI from "openai";
import {
  assertTaskLock,
  MODEL,
  RESPONSE_FORMAT,
  REQUEST_SETTINGS,
  SYSTEM_PROMPT,
  TASK_SIGNATURE,
} from "./dialect/task.mjs";

assertTaskLock();
if (existsSync(".env")) loadEnvFile(".env");

const apiKey = process.env.MUBIT_API_KEY;
if (!apiKey)
  throw new Error(
    "MUBIT_API_KEY is not set. Add it to .env or your environment.",
  );

const client = new OpenAI({
  baseURL: "https://api.mubit.ai/openai/v1",
  apiKey,
  maxRetries: 0,
  timeout: 60_000,
});

const { values, positionals } = parseArgs({
  options: {
    source: { type: "string", default: "questions/review-001.json" },
  },
  allowPositionals: true,
});
const questionsSource = values.source;
const questions = JSON.parse(
  readFileSync(new URL(`./${questionsSource}`, import.meta.url), "utf8"),
);
const selection = positionals.join(" ").trim();
const selected = selection
  ? questions.find(item => item.id === selection || item.question === selection)
  : questions[0];
if (!selected) {
  throw new Error(`Choose a question ID or exact question from ${questionsSource}.`);
}
const { id: questionId, question } = selected;
const localRequestId = `dialect-${questionId}-${randomUUID()}`;
const request = {
  model: MODEL,
  ...REQUEST_SETTINGS,
  response_format: RESPONSE_FORMAT,
  // On starter credit, omit provider storage and metadata. Mubit derives a
  // session from the fixed instructions and this question automatically.
  messages: [
    {
      role: "system",
      content: SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: question,
    },
  ],
};

const outputDirectory = new URL("./dialect/results/", import.meta.url);
const outputFile = new URL(`mubit-${localRequestId}.json`, outputDirectory);
const report = {
  provider: "mubit",
  base_url: client.baseURL,
  local_request_id: localRequestId,
  session_tracking: "Mubit derives the session from the instructions and first user message.",
  question_id: questionId,
  questions_source: questionsSource,
  task_signature: TASK_SIGNATURE,
  started_at: new Date().toISOString(),
  status: "sending",
  request,
};
mkdirSync(outputDirectory, { recursive: true });
const save = () => writeFileSync(outputFile, JSON.stringify(report, null, 2) + "\n");
save();
console.log(`Sending one question through Mubit (${MODEL}).`);
console.log(`Local request ID: ${localRequestId}`);
const start = performance.now();
try {
  const { data, response } = await client.chat.completions.create(request).withResponse();
  report.status = "completed";
  report.latency_ms = Math.round(performance.now() - start);
  report.mubit_request_id = response.headers.get("x-middleware-request-id");
  report.response = data;
  console.log(`Mubit request ID: ${report.mubit_request_id ?? "not supplied"}`);
  console.log(data.choices[0]?.message.content ?? "No response content.");
} catch (error) {
  report.status = "failed";
  report.latency_ms = Math.round(performance.now() - start);
  let message = String(error.message ?? "Unknown request error");
  for (const [name, value] of Object.entries(process.env)) {
    if (/key|token|secret|password/i.test(name) && value && value.length >= 8) {
      message = message.replaceAll(value, "[REDACTED]");
    }
  }
  message = message.replace(/\b(?:sk|mbt)[-_][A-Za-z0-9_-]+\b/g, "[REDACTED]");
  report.error = { name: error.name, http_status: error.status ?? null, code: error.code ?? null, message };
  console.error(`Request failed: ${error.name}; HTTP ${error.status ?? "unavailable"}. ${message}`);
  process.exitCode = 1;
} finally {
  report.finished_at = new Date().toISOString();
  save();
  console.log(`Log: ${fileURLToPath(outputFile)}`);
}
