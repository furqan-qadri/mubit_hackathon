import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { MODEL, REQUEST_SETTINGS } from "../../dialect/task.mjs";

if (existsSync(".env")) loadEnvFile(".env");
if (!process.env.MUBIT_API_KEY) throw new Error("MUBIT_API_KEY is not set.");

const systemPrompt = "Explain products clearly and concisely using only the supplied information.";
// Use only the complete sentences supplied by the user, excluding the truncated ending.
const context = [
  "Mubit calibrates agentic runtimes using execution traces and verified outcomes.",
  "Point your model calls at Mubit. It calibrates every call at runtime, then builds and refreshes a dedicated model for each task your agents repeat, switching over only when it does better. Your frontier models stay. You own what's built.",
  "It connects reusable memory, prompt and skill improvements, and task-specific model behavior in a learning loop around your existing agent workflow.",
].join("\n");
const questions = JSON.parse(readFileSync(new URL("./questions.json", import.meta.url), "utf8"));
if (questions.length !== 5) throw new Error("Expected exactly five questions.");
const client = new OpenAI({
  baseURL: "https://api.mubit.ai/openai/v1",
  apiKey: process.env.MUBIT_API_KEY,
  maxRetries: 0,
  timeout: 60_000,
});
const directory = new URL("./results/", import.meta.url);
mkdirSync(directory, { recursive: true });
for (const question of questions) {
  const request = {
    model: MODEL,
    ...REQUEST_SETTINGS,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `${question.question}\n\n${context}` },
    ],
  };
  const output = new URL(`${question.id}.json`, directory);
  if (existsSync(output)) {
    const previous = JSON.parse(readFileSync(output, "utf8"));
    if (previous.status === "completed") {
      if (JSON.stringify(previous.request) !== JSON.stringify(request)) {
        throw new Error(`${question.id}: saved request differs; stopping.`);
      }
      console.log(`${question.id}: already completed; skipped.`);
      continue;
    }
    if (previous.status === "sending") throw new Error(`${question.id}: previous outcome unknown; stopping.`);
  }
  const report = {
    provider: "mubit",
    base_url: client.baseURL,
    local_request_id: `product-summary-${question.id}-${randomUUID()}`,
    question_id: question.id,
    started_at: new Date().toISOString(),
    status: "sending",
    request,
  };
  const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  save();
  const start = performance.now();
  try {
    const { data, response } = await client.chat.completions.create(request).withResponse();
    report.status = "completed";
    report.mubit_request_id = response.headers.get("x-middleware-request-id");
    report.response = data;
    console.log(`${question.id}: completed, ${report.mubit_request_id}`);
    console.log(data.choices[0]?.message.content ?? "No response content.");
  } catch (error) {
    report.status = "failed";
    report.error = { name: error.name, http_status: error.status ?? null, code: error.code ?? null };
    console.error(`${question.id}: failed (${error.name}, HTTP ${error.status ?? "unavailable"}); stopping.`);
    process.exitCode = 1;
  } finally {
    report.latency_ms = Math.round(performance.now() - start);
    report.finished_at = new Date().toISOString();
    save();
  }
  if (report.status !== "completed") break;
}
