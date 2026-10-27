import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyRefund } from "../src/classifyRefund.ts";
import {
  scoreCase,
  summarize,
  validateDataset,
  type EvaluationCase,
  type EvaluationDataset,
  type EvaluationResult,
  type RecordedCase,
  type RecordedFile,
} from "../src/evaluation.ts";
import { buildJevRequest, JEV_MODEL, jevQuestions } from "../src/jevConfig.ts";
import type { DecisionTransport } from "../src/jevClient.ts";
import { createHttpTransport } from "../src/jevClient.ts";
import { KNOWLEDGE_RECORDS, retrievePolicy } from "../src/retrieval.ts";
import type { FallbackReason, RiskDecision } from "../src/types.ts";
import { validateRefundRequest } from "../src/validate.ts";
import { DECISIONS } from "../src/types.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DATASET_PATH = join(ROOT, "eval-cases.json");
const LOGS_DIR = join(ROOT, "logs");
const PAYLOADS_DIR = join(ROOT, "eval", "payloads");
const RECORDED_DIR = join(ROOT, "eval", "recorded");

type Version = "baseline" | "grounded";

interface CliOptions {
  version: Version | null;
  validateOnly: boolean;
  printState: boolean;
  live: boolean;
  record: boolean;
  runs: number;
}

async function main(): Promise<void> {
  const options = parseArgs();
  const dataset = loadDataset();

  if (options.validateOnly) {
    validateOnly(dataset);
    return;
  }

  if (!options.version) {
    fail("Missing --version baseline|grounded");
  }

  if (options.printState) {
    printState(dataset, options.version);
    return;
  }

  const results = options.live
    ? await runLive(dataset, options)
    : await runReplay(dataset, options.version);

  const summary = summarize({
    version: options.version,
    results,
    gitSha: gitSha(),
    configSha: configSha(options.version),
  });

  mkdirSync(LOGS_DIR, { recursive: true });
  const outPath = join(LOGS_DIR, `eval-${options.version}.json`);
  writeJson(outPath, summary);
  printSummary(summary, outPath);
}

function parseArgs(): CliOptions {
  const versionArg = argValue("--version");
  if (versionArg !== undefined && versionArg !== "baseline" && versionArg !== "grounded") {
    fail(`Invalid --version: ${versionArg}`);
  }

  const runs = Number(argValue("--runs") ?? "1");
  if (!Number.isInteger(runs) || runs < 1) {
    fail("--runs must be a positive integer");
  }

  return {
    version: versionArg ?? null,
    validateOnly: hasFlag("--validate-only"),
    printState: hasFlag("--print-state"),
    live: hasFlag("--live"),
    record: hasFlag("--record"),
    runs,
  };
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function loadDataset(): EvaluationDataset {
  if (!existsSync(DATASET_PATH)) {
    fail(`Missing dataset: ${DATASET_PATH}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(DATASET_PATH, "utf8")) as unknown;
  } catch (error) {
    fail(`Could not parse eval-cases.json: ${String(error)}`);
  }

  const validation = validateDataset(parsed);
  if (!validation.ok) {
    fail(`Invalid eval-cases.json:\n- ${validation.errors.join("\n- ")}`);
  }

  return validation.value;
}

function validateOnly(dataset: EvaluationDataset): void {
  console.log(`Dataset: ${dataset.cases.length} cases`);
  const counts = new Map<string, number>();
  for (const testCase of dataset.cases) {
    counts.set(testCase.case_type, (counts.get(testCase.case_type) ?? 0) + 1);
  }
  console.log(
    `Types: ${[...counts.entries()].map(([type, count]) => `${type}=${count}`).join(", ")}`,
  );

  for (const version of ["baseline", "grounded"] as const) {
    const recordedPath = join(RECORDED_DIR, `${version}.json`);
    if (!existsSync(recordedPath)) {
      console.warn(`WARN missing recorded file: ${recordedPath}`);
      continue;
    }

    const recorded = loadRecordedFile(recordedPath, version);
    const pending: string[] = [];
    for (const testCase of dataset.cases) {
      if (!testCase.model_required || testCase.fault) {
        continue;
      }
      const entry = recorded.cases[testCase.id];
      if (!entry) {
        pending.push(`${testCase.id}: no entry`);
      } else if (entry.raw === null && entry.final_decision == null) {
        pending.push(`${testCase.id}: awaiting raw Playground response`);
      }
    }

    if (pending.length > 0) {
      console.warn(`WARN ${version}: ${pending.join("; ")}`);
    } else {
      console.log(`${version}: all model cases recorded`);
    }
  }

  console.log("Dataset validation passed.");
}

function printState(dataset: EvaluationDataset, version: Version): void {
  const outputDir = join(PAYLOADS_DIR, version);
  mkdirSync(outputDir, { recursive: true });

  const combined: Record<string, unknown> = {};

  for (const testCase of dataset.cases) {
    if (!testCase.model_required || testCase.fault) {
      continue;
    }

    const validation = validateRefundRequest(testCase.input);
    if (!validation.ok) {
      fail(
        `Case ${testCase.id} has invalid input and cannot be printed: ${validation.errors.join("; ")}`,
      );
    }

    const request = validation.value;
    const grounding =
      version === "grounded" ? retrievePolicy(request) : undefined;
    const payload = buildJevRequest(
      grounding && grounding.length > 0
        ? { ...request, policy_context: grounding }
        : request,
    );

    combined[testCase.id] = payload;
    const casePath = join(outputDir, `${testCase.id}.json`);
    writeJson(casePath, payload);
    console.log(
      `${testCase.id}: ${casePath}${grounding ? ` (policy records: ${grounding.map((record) => record.id).join(", ")})` : ""}`,
    );
  }

  const combinedPath = join(PAYLOADS_DIR, `${version}.json`);
  writeJson(combinedPath, { version, model: JEV_MODEL, cases: combined });
  console.log(`Combined payloads: ${combinedPath}`);
}

async function runReplay(
  dataset: EvaluationDataset,
  version: Version,
): Promise<EvaluationResult[]> {
  const recordedPath = join(RECORDED_DIR, `${version}.json`);
  if (!existsSync(recordedPath)) {
    fail(`Missing recorded file: ${recordedPath}`);
  }
  const recorded = loadRecordedFile(recordedPath, version);

  const results: EvaluationResult[] = [];
  for (const testCase of dataset.cases) {
    if (testCase.fault) {
      results.push(await runFaultCase(testCase, version));
      continue;
    }

    const entry = recorded.cases[testCase.id];
    results.push(await runRecordedCase(testCase, version, entry));
  }

  return results;
}

async function runRecordedCase(
  testCase: EvaluationCase,
  version: Version,
  entry: RecordedCase | undefined,
): Promise<EvaluationResult> {
  const notes: string[] = [];

  if (!entry) {
    return scoreCase(
      testCase,
      null,
      null,
      null,
      null,
      "not_available",
      ["No recorded entry for this case."],
    );
  }

  if (!entry.raw) {
    if (entry.final_decision) {
      return scoreCase(
        testCase,
        entry.final_decision,
        null,
        "recorded_final",
        typeof entry.latency_ms === "number" ? entry.latency_ms : null,
        typeof entry.latency_ms === "number" ? "recorded" : "not_available",
        [
          ...notes,
          entry.notes ?? "Recorded final decision reused; raw response unavailable.",
        ],
      );
    }

    return scoreCase(
      testCase,
      null,
      null,
      null,
      null,
      "not_available",
      ["Awaiting actual Playground response in the recorded file."],
    );
  }

  const hasConfidence = rawConfidence(entry.raw) !== null;
  if (!hasConfidence && entry.final_decision) {
    return scoreCase(
      testCase,
      entry.final_decision,
      null,
      "recorded_final",
      typeof entry.latency_ms === "number" ? entry.latency_ms : null,
      typeof entry.latency_ms === "number" ? "recorded" : "not_available",
      [
        ...notes,
        entry.notes ??
          "Recorded final decision reused because confidence was not captured.",
      ],
    );
  }

  if (!hasConfidence) {
    return scoreCase(
      testCase,
      null,
      null,
      null,
      null,
      "not_available",
      [
        "Recorded response has no confidence value and no final_decision; policy replay is not possible.",
      ],
    );
  }

  const inputValidation = validateRefundRequest(testCase.input);
  if (!inputValidation.ok) {
    return scoreCase(
      testCase,
      null,
      null,
      null,
      null,
      "not_available",
      [`Case input is invalid: ${inputValidation.errors.join("; ")}`],
    );
  }

  const request = inputValidation.value;
  const grounding =
    version === "grounded" ? retrievePolicy(request) : undefined;
  const transport = fixedTransport(entry.raw);

  try {
    const result = await classifyRefund(request, transport, {
      ...(grounding && grounding.length > 0 ? { grounding } : {}),
    });
    return scoreCase(
      testCase,
      result.decision,
      result.fallback_reason,
      "policy_replay",
      typeof entry.latency_ms === "number" ? entry.latency_ms : null,
      typeof entry.latency_ms === "number" ? "recorded" : "local_replay",
      entry.notes ? [...notes, entry.notes] : notes,
    );
  } catch (error) {
    return scoreCase(
      testCase,
      null,
      null,
      null,
      null,
      "not_available",
      [`Replay failed: ${String(error)}`],
    );
  }
}

async function runFaultCase(
  testCase: EvaluationCase,
  version: Version,
): Promise<EvaluationResult> {
  const notes: string[] = [];
  let called = false;

  const invalidTransport: DecisionTransport = {
    decide: async () => {
      called = true;
      return validResponse("INSTANT_AUTO_APPROVE");
    },
  };

  const neverTransport: DecisionTransport = {
    decide: (_request, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
  };

  const unavailableTransport: DecisionTransport = {
    decide: async () => {
      throw new Error("ECONNREFUSED");
    },
  };

  const malformedTransport: DecisionTransport = {
    decide: async () => {
      throw new SyntaxError("Unexpected token < in JSON");
    },
  };

  const transport =
    testCase.fault === "invalid_input"
      ? invalidTransport
      : testCase.fault === "timeout"
        ? neverTransport
        : testCase.fault === "service_unavailable"
          ? unavailableTransport
          : malformedTransport;

  const inputValidation = validateRefundRequest(testCase.input);
  const grounding =
    version === "grounded" && inputValidation.ok
      ? retrievePolicy(inputValidation.value)
      : undefined;

  try {
    const result = await classifyRefund(
      inputValidation.ok ? inputValidation.value : testCase.input,
      transport,
      {
        ...(grounding && grounding.length > 0 ? { grounding } : {}),
        ...(testCase.timeout_ms !== undefined
          ? { timeoutMs: testCase.timeout_ms }
          : {}),
      },
    );

    if (testCase.fault === "invalid_input" && called) {
      notes.push("ERROR: model transport was called for invalid input.");
    }

    return scoreCase(
      testCase,
      result.decision,
      result.fallback_reason,
      "deterministic_fallback",
      null,
      "local_replay",
      notes,
    );
  } catch (error) {
    return scoreCase(
      testCase,
      null,
      null,
      null,
      null,
      "not_available",
      [`Fault case failed unexpectedly: ${String(error)}`],
    );
  }
}

async function runLive(
  dataset: EvaluationDataset,
  options: CliOptions,
): Promise<EvaluationResult[]> {
  const endpoint = process.env.JEV_ENDPOINT;
  const apiKey = process.env.JEV_API_KEY;
  if (!endpoint || !apiKey) {
    fail(
      "Live mode requires JEV_ENDPOINT and JEV_API_KEY. Use replay mode with eval/recorded/*.json for Playground runs.",
    );
  }

  const version = options.version as Version;
  const httpTransport = createHttpTransport({ endpoint, apiKey });
  const recorded: RecordedFile = {
    version,
    model: JEV_MODEL,
    captured_at: new Date().toISOString(),
    notes: `Live API run with ${options.runs} repetition(s) per case.`,
    cases: {},
  };

  const results: EvaluationResult[] = [];

  for (const testCase of dataset.cases) {
    if (testCase.fault) {
      results.push(await runFaultCase(testCase, version));
      continue;
    }

    const inputValidation = validateRefundRequest(testCase.input);
    if (!inputValidation.ok) {
      results.push(
        scoreCase(
          testCase,
          null,
          null,
          null,
          null,
          "not_available",
          [`Case input is invalid: ${inputValidation.errors.join("; ")}`],
        ),
      );
      continue;
    }

    const request = inputValidation.value;
    const grounding =
      version === "grounded" ? retrievePolicy(request) : undefined;

    const rawResponses: unknown[] = [];
    const latencies: number[] = [];
    let lastResult: { decision: RiskDecision; fallbackReason: FallbackReason | null } | null =
      null;

    for (let run = 0; run < options.runs; run += 1) {
      const recordingTransport: DecisionTransport = {
        async decide(req, signal) {
          const raw = await httpTransport.decide(req, signal);
          rawResponses.push(raw);
          return raw;
        },
      };

      const started = performance.now();
      const result = await classifyRefund(request, recordingTransport, {
        ...(grounding && grounding.length > 0 ? { grounding } : {}),
      });
      latencies.push(performance.now() - started);
      lastResult = {
        decision: result.decision,
        fallbackReason: result.fallback_reason,
      };
    }

    const medianLatency = median(latencies);
    const raw = rawResponses[rawResponses.length - 1] ?? null;
    const confidenceCaptured = raw !== null && rawConfidence(raw) !== null;

    recorded.cases[testCase.id] = {
      source: "live API",
      captured_at: new Date().toISOString(),
      raw,
      final_decision: confidenceCaptured
        ? null
        : (lastResult?.decision ?? null),
      confidence_captured: confidenceCaptured,
      latency_ms: medianLatency,
      notes: `${latencies.length} live run(s); latency is the median end-to-end call time.`,
    };

    results.push(
      scoreCase(
        testCase,
        lastResult?.decision ?? null,
        lastResult?.fallbackReason ?? null,
        "policy_replay",
        medianLatency,
        "recorded",
        [`${latencies.length} live run(s).`],
      ),
    );
  }

  if (options.record) {
    mkdirSync(RECORDED_DIR, { recursive: true });
    const recordedPath = join(RECORDED_DIR, `${version}.json`);
    writeJson(recordedPath, recorded);
    console.log(`Recorded responses written to ${recordedPath}`);
  }

  return results;
}

function fixedTransport(raw: unknown): DecisionTransport {
  return { decide: async () => raw };
}

function loadRecordedFile(path: string, version: Version): RecordedFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    fail(`Could not parse ${path}: ${String(error)}`);
  }

  if (!isRecord(parsed) || !isRecord(parsed.cases)) {
    fail(`Invalid recorded file: ${path}`);
  }

  const file = parsed as unknown as RecordedFile;
  if (file.version !== version) {
    fail(
      `Recorded file ${path} has version ${String(file.version)} but expected ${version}`,
    );
  }

  return file;
}

function configSha(version: Version): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version,
        model: JEV_MODEL,
        questions: jevQuestions,
        grounding: version === "grounded",
        knowledge: version === "grounded" ? KNOWLEDGE_RECORDS : [],
      }),
    )
    .digest("hex")
    .slice(0, 16);
}

function gitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

function printSummary(
  summary: ReturnType<typeof summarize>,
  outPath: string,
): void {
  const accuracy =
    summary.accuracy_completed_pct === null
      ? "N/A"
      : `${summary.accuracy_completed_pct}%`;
  console.log("");
  console.log(`A7 evaluation — ${summary.version}`);
  console.log(
    `Cases: ${summary.cases_total} total, ${summary.cases_completed} completed, ${summary.cases_pending} pending`,
  );
  console.log(
    `Correct: ${summary.correct}/${summary.cases_completed} completed (${accuracy} of completed, ${summary.accuracy_total_pct}% of all cases)`,
  );
  console.log(
    `Latency: p50=${summary.latency.p50_ms ?? "N/A"} ms, p95=${summary.latency.p95_ms ?? "N/A"} ms (samples=${summary.latency.samples}, source=${summary.latency.source})`,
  );
  console.log(`Cost per task: ${summary.cost_per_task}`);
  console.log("");
  for (const result of summary.results) {
    const marker =
      result.status === "pass"
        ? "PASS"
        : result.status === "fail"
          ? "FAIL"
          : "PENDING";
    console.log(
      `${result.id.padEnd(4)} ${marker.padEnd(7)} expected=${result.expected_decision} actual=${result.actual_decision ?? "pending"}${
        result.expected_fallback_reason
          ? ` fallback=${result.actual_fallback_reason ?? "pending"}/${result.expected_fallback_reason}`
          : ""
      }`,
    );
  }
  console.log("");
  console.log(`Wrote ${outPath}`);
}

function validResponse(choice: RiskDecision): unknown {
  const remainder = (1 - 0.9) / (DECISIONS.length - 1);
  const probabilities: Record<string, number> = {};
  for (const decision of DECISIONS) {
    probabilities[decision] = decision === choice ? 0.9 : remainder;
  }

  return {
    answers: {
      refund_risk: { choice, probabilities, confidence: 0.9 },
      fraud_signal: { noul: 0.05 },
    },
  };
}

function rawConfidence(raw: unknown): number | null {
  if (!isRecord(raw) || !isRecord(raw.answers) || !isRecord(raw.answers.refund_risk)) {
    return null;
  }
  const confidence = raw.answers.refund_risk.confidence;
  return typeof confidence === "number" ? confidence : null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 100) / 100;
  }
  return Math.round(sorted[middle] * 100) / 100;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
