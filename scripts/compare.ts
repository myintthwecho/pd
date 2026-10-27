import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { EvaluationSummary } from "../src/evaluation.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const LOGS_DIR = join(ROOT, "logs");

function load(version: "baseline" | "grounded"): EvaluationSummary {
  const path = join(LOGS_DIR, `eval-${version}.json`);
  if (!existsSync(path)) {
    console.error(`Missing ${path}. Run npm run eval:${version} first.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8")) as EvaluationSummary;
}

function accuracy(summary: EvaluationSummary): string {
  const completed =
    summary.accuracy_completed_pct === null
      ? "N/A"
      : `${summary.accuracy_completed_pct}%`;
  const base = `${summary.correct}/${summary.cases_completed} completed (${completed})`;
  if (summary.cases_pending > 0) {
    return `${base}; ${summary.accuracy_total_pct}% of ${summary.cases_total} with ${summary.cases_pending} pending`;
  }
  return `${base}; ${summary.accuracy_total_pct}% of ${summary.cases_total}`;
}

function latency(summary: EvaluationSummary): string {
  if (summary.latency.p95_ms === null) {
    return "N/A";
  }
  return `${summary.latency.p95_ms} ms (n=${summary.latency.samples})`;
}

function change(before: EvaluationSummary, after: EvaluationSummary): string {
  if (before.cases_pending > 0 || after.cases_pending > 0) {
    return "Pending complete runs";
  }
  const delta = Math.round((after.accuracy_total_pct - before.accuracy_total_pct) * 100) / 100;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta} percentage points`;
}

function latencyChange(before: EvaluationSummary, after: EvaluationSummary): string {
  if (before.latency.p95_ms === null || after.latency.p95_ms === null) {
    return "N/A";
  }
  const delta = Math.round((after.latency.p95_ms - before.latency.p95_ms) * 100) / 100;
  const percent =
    Math.round((delta / before.latency.p95_ms) * 1000) / 10;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta} ms (${sign}${percent}%)`;
}

const before = load("baseline");
const after = load("grounded");

const byId = new Map(before.results.map((result) => [result.id, result]));
const improved: string[] = [];
const worsened: string[] = [];
const pending: string[] = [];
const otherChanges: string[] = [];
const caseRows: string[] = [];

for (const afterResult of after.results) {
  const beforeResult = byId.get(afterResult.id);
  if (!beforeResult) {
    continue;
  }

  if (beforeResult.status === "pending" || afterResult.status === "pending") {
    pending.push(afterResult.id);
    caseRows.push(
      `| ${afterResult.id} | ${beforeResult.status} | ${afterResult.status} | Pending |`,
    );
    continue;
  }

  if (beforeResult.status === "fail" && afterResult.status === "pass") {
    improved.push(afterResult.id);
  } else if (beforeResult.status === "pass" && afterResult.status === "fail") {
    worsened.push(afterResult.id);
  } else if (
    beforeResult.actual_decision !== afterResult.actual_decision
  ) {
    otherChanges.push(afterResult.id);
  }

  caseRows.push(
    `| ${afterResult.id} | ${beforeResult.status} (${beforeResult.actual_decision}) | ${afterResult.status} (${afterResult.actual_decision}) | ${
      beforeResult.status === afterResult.status
        ? "Unchanged"
        : "Changed"
    } |`,
  );
}

const markdown = [
  "# A7 before / after comparison",
  "",
  `Generated: ${new Date().toISOString()}`,
  `Baseline run: ${before.generated_at} (config ${before.config_sha}, git ${before.git_sha})`,
  `Grounded run: ${after.generated_at} (config ${after.config_sha}, git ${after.git_sha})`,
  "",
  "| Metric | Before | After | Change |",
  "|---|---|---|---|",
  `| Accuracy | ${accuracy(before)} | ${accuracy(after)} | ${change(before, after)} |`,
  `| p95 Latency | ${latency(before)} | ${latency(after)} | ${latencyChange(before, after)} |`,
  `| Cost per Task | ${before.cost_per_task} | ${after.cost_per_task} | N/A |`,
  "",
  "## Per-case results",
  "",
  "| ID | Before | After | Result |",
  "|---|---|---|---|",
  ...caseRows,
  "",
  "## Summary",
  "",
  `- Improved: ${improved.length > 0 ? improved.join(", ") : "none"}`,
  `- Worsened: ${worsened.length > 0 ? worsened.join(", ") : "none"}`,
  `- Other decision changes: ${otherChanges.length > 0 ? otherChanges.join(", ") : "none"}`,
  `- Pending: ${pending.length > 0 ? pending.join(", ") : "none"}`,
  "",
  "A pending case has no actual recorded model response yet and is not counted as a pass or fail.",
  "",
].join("\n");

const outPath = join(LOGS_DIR, "eval-comparison.md");
writeFileSync(outPath, markdown, "utf8");
console.log(markdown);
console.log(`Wrote ${outPath}`);
