import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
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

const pilotQuestions = JSON.parse(
  readFileSync(new URL("./dialect/data/pilot-questions.json", import.meta.url), "utf8"),
);
const question = process.argv.slice(2).join(" ").trim() || pilotQuestions[0].question;
const questionId = pilotQuestions.find(item => item.question === question)?.id ?? "manual";
const sessionId = `dialect-${questionId}-${randomUUID()}`;
const request = {
  model: MODEL,
  ...REQUEST_SETTINGS,
  response_format: RESPONSE_FORMAT,
  // The gateway requires storage when attaching the session metadata.
  store: true,
  metadata: { session_id: sessionId },
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
const outputFile = new URL(`mubit-${sessionId}.json`, outputDirectory);
const report = {
  provider: "mubit",
  base_url: client.baseURL,
  session_id: sessionId,
  question_id: questionId,
  task_signature: TASK_SIGNATURE,
  started_at: new Date().toISOString(),
  status: "sending",
  request,
};
mkdirSync(outputDirectory, { recursive: true });
const save = () => writeFileSync(outputFile, JSON.stringify(report, null, 2) + "\n");
save();
console.log(`Sending one question through Mubit (${MODEL}).`);
console.log(`Session ID: ${sessionId}`);
const start = performance.now();
try {
  const { data, response } = await client.chat.completions.create(request).withResponse();
  report.status = "completed";
  report.latency_ms = Math.round(performance.now() - start);
  report.mubit_request_id = response.headers.get("x-middleware-request-id");
  report.response = data;
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
