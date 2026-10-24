import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import {
  assertTaskLock,
  MODEL,
  RESPONSE_FORMAT,
  SYSTEM_PROMPT,
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

const response = await client.chat.completions.create({
  model: MODEL,
  max_tokens: 256,
  response_format: RESPONSE_FORMAT,
  metadata: { session_id: `dialect-${randomUUID()}` },
  messages: [
    {
      role: "system",
      content: SYSTEM_PROMPT,
    },
    {
      role: "user",
      content:
        process.argv.slice(2).join(" ").trim() ||
        "How many customers are still paying us?",
    },
  ],
});

console.log(response.choices[0].message.content);
