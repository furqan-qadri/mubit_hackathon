import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { assertTaskLock, MODEL, TASK_SIGNATURE } from "./task.mjs";

assertTaskLock();
const { values } = parseArgs({
  options: {
    source: { type: "string", default: "questions/review-001.json" },
    from: { type: "string" },
    count: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
  allowPositionals: false,
});
const source = values.source;
const questions = JSON.parse(readFileSync(new URL(`./${source}`, import.meta.url), "utf8"));
const start = questions.findIndex(question => question.id === values.from);
const count = Number(values.count);
if (start < 0 || !Number.isSafeInteger(count) || count < 1 || start + count > questions.length) {
  throw new Error("Specify a valid range, e.g. --from q_002 --count 50.");
}
const selected = questions.slice(start, start + count);
if (new Set(selected.map(question => question.id)).size !== count) {
  throw new Error("Selected question IDs must be unique.");
}
const directory = new URL("./results/", import.meta.url);
const completed = new Map();
for (const filename of readdirSync(directory)) {
  if (!filename.startsWith("mubit-") || !filename.endsWith(".json")) continue;
  const record = JSON.parse(readFileSync(new URL(filename, directory), "utf8"));
  if (
    record.provider === "mubit" &&
    record.status === "completed" &&
    JSON.stringify(record.task_signature) === JSON.stringify(TASK_SIGNATURE)
  ) {
    completed.set(record.question_id, record);
  }
}
const pending = selected.filter(question => {
  const record = completed.get(question.id);
  return !record || record.request.messages.find(message => message.role === "user")?.content !== question.question;
});
console.log(JSON.stringify({
  model: MODEL,
  questions_source: source,
  selected: selected.length,
  already_logged: selected.length - pending.length,
  pending_ids: pending.map(question => question.id),
  dry_run: values["dry-run"],
}));
if (!values["dry-run"]) {
  let saved = 0;
  for (const question of pending) {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL("./index.mjs", import.meta.url)), "--source", source, question.id], {
      cwd: fileURLToPath(new URL("./", import.meta.url)),
      encoding: "utf8",
      timeout: 75_000,
    });
    if (child.status !== 0 || child.error) {
      console.error(`${question.id}: stopped; no further requests sent.`);
      console.error(child.stdout ?? "");
      console.error(child.stderr ?? "");
      process.exitCode = 1;
      break;
    }
    const filename = child.stdout.match(/^Log: (.+)$/m)?.[1];
    if (!filename) throw new Error(`Missing result log for ${question.id}; stopping.`);
    const record = JSON.parse(readFileSync(filename, "utf8"));
    if (record.status !== "completed" || record.question_id !== question.id) {
      throw new Error(`Unexpected result log for ${question.id}; stopping.`);
    }
    saved++;
    console.log(`${question.id}: saved (${record.latency_ms} ms), ${record.mubit_request_id}`);
  }
  console.log(`Saved ${saved}/${pending.length} new responses. Evaluation was not run.`);
}
