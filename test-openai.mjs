import { parseArgs } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { pathToFileURL, fileURLToPath } from "node:url";
import OpenAI from "openai";
import {
  assertTaskLock,
  MODEL,
  RESPONSE_FORMAT,
  SYSTEM_PROMPT,
  TASK_SIGNATURE,
} from "./dialect/task.mjs";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const MODEL_SETTINGS = {
  "gpt-4.1-mini": { max_tokens: 256 },
  "gpt-6-sol": { max_completion_tokens: 2048, reasoning_effort: "medium" },
};

function settingsFor(model) {
  if (!Object.hasOwn(MODEL_SETTINGS, model)) {
    throw new Error(`Supported direct-test models: ${Object.keys(MODEL_SETTINGS).join(", ")}`);
  }
  return { ...MODEL_SETTINGS[model] };
}

export function createDirectClient(apiKey) {
  if (!apiKey?.trim()) {
    throw new Error("Set OPENAI_API_KEY (or OPEN_AI_KEY) in .env or your environment first.");
  }
  if (apiKey.startsWith("mbt_") || apiKey === process.env.MUBIT_API_KEY) {
    throw new Error("OPENAI_API_KEY must be a separate OpenAI key.");
  }
  return new OpenAI({
    apiKey,
    baseURL: OPENAI_BASE_URL,
    maxRetries: 0,
    timeout: 60_000,
  });
}

export async function runPilot(client, questions, onResult = () => {}, { model = MODEL } = {}) {
  const requestSettings = settingsFor(model);
  const results = [];
  for (const { id, question } of questions) {
    const start = performance.now();
    const request = {
      model,
      ...requestSettings,
      response_format: RESPONSE_FORMAT,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: question },
      ],
    };
    const response = await client.chat.completions.create(request);
    const latency_ms = Math.round(performance.now() - start);
    const choice = response.choices[0];
    const raw_response = choice?.message.content ?? null;
    const result = {
      id,
      question,
      request,
      response,
      raw_response,
      finish_reason: choice?.finish_reason ?? null,
      model: response.model,
      request_id: response._request_id ?? null,
      latency_ms,
      usage: response.usage ?? null,
    };
    results.push(result);
    await onResult(result);
  }
  return results;
}

async function main() {
  assertTaskLock();
  const { values: { model, source: questionsSource } } = parseArgs({
    options: {
      model: { type: "string", default: MODEL },
      source: { type: "string", default: "questions/review-001.json" },
    },
    allowPositionals: false,
  });
  const requestSettings = settingsFor(model);
  if (existsSync(".env")) loadEnvFile(".env");
  const client = createDirectClient(
    process.env.OPENAI_API_KEY?.trim() || process.env.OPEN_AI_KEY?.trim(),
  );
  const sourceText = readFileSync(new URL(`./${questionsSource}`, import.meta.url), "utf8");
  const questions = JSON.parse(sourceText);
  if (!Array.isArray(questions) || !questions.length ||
      questions.some(q => typeof q.id !== "string" || typeof q.question !== "string" || !q.question.trim()) ||
      new Set(questions.map(q => q.id)).size !== questions.length) {
    throw new Error("Question source must contain nonempty questions with unique IDs.");
  }
  const runId = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const outputDirectory = new URL("./dialect/results/", import.meta.url);
  const outputFile = new URL(`openai-questions-${model}-${runId}.json`, outputDirectory);
  const report = {
    provider: "openai-direct",
    base_url: OPENAI_BASE_URL,
    requested_model: model,
    request_settings: requestSettings,
    questions_source: questionsSource,
    questions_sha256: createHash("sha256").update(sourceText).digest("hex"),
    task_signature: { ...TASK_SIGNATURE, model, request_settings: requestSettings },
    started_at: new Date().toISOString(),
    status: "running",
    total_questions: questions.length,
    results: [],
  };
  mkdirSync(outputDirectory, { recursive: true });
  const save = () => writeFileSync(outputFile, JSON.stringify(report, null, 2) + "\n");
  save();
  console.log(`Testing ${questions.length} questions directly on OpenAI (${model}).`);
  try {
    await runPilot(client, questions, result => {
      report.results.push(result);
      save();
      console.log(`${result.id}: response received (${result.latency_ms} ms)`);
    }, { model });
    report.status = "completed";
  } catch (error) {
    report.status = "failed";
    report.failed_question_id = questions[report.results.length]?.id ?? null;
    // Avoid writing SDK error objects, headers or credentials to logs/files.
    report.error = {
      name: error.name,
      http_status: error.status ?? null,
      code: error.code ?? null,
    };
    console.error(`Run stopped: ${error.name}; HTTP ${error.status ?? "unavailable"}.`);
    process.exitCode = 1;
  }
  report.finished_at = new Date().toISOString();
  report.summary = {
    answered: report.results.length,
    average_latency_ms: report.results.length
      ? Math.round(report.results.reduce((sum, result) => sum + result.latency_ms, 0) / report.results.length)
      : null,
    prompt_tokens: report.results.reduce((sum, result) => sum + (result.usage?.prompt_tokens ?? 0), 0),
    completion_tokens: report.results.reduce((sum, result) => sum + (result.usage?.completion_tokens ?? 0), 0),
  };
  save();
  console.log(`Saved ${report.results.length}/${questions.length} responses. Evaluation runs separately.`);
  console.log(`Results: ${fileURLToPath(outputFile)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof OpenAI.APIError ? "OpenAI request failed." : error.message);
    process.exitCode = 1;
  });
}
