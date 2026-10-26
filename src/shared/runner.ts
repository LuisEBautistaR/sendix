/** Collection runner: what the renderer asks for and the events main streams back. */
import { z } from "zod";
import type { ConsoleEntry, ScriptReport, TestResult } from "./http";

const id = z.string().min(1).max(128);

/** One cell of a data file. CSV cells are strings; JSON keeps numbers, booleans and null. */
export const dataValueSchema = z.union([z.string().max(100_000), z.number(), z.boolean(), z.null()]);
export const dataRowSchema = z.record(z.string().max(1_024), dataValueSchema);
export type DataRow = z.infer<typeof dataRowSchema>;

export const MAX_ITERATIONS = 1_000;
export const MAX_DATA_ROWS = 10_000;

export const runOptionsSchema = z.object({
  /** Stop at the first request that fails: no response, a failed test or a script error. */
  stopOnError: z.boolean(),
  /** Keep console.log output of scripts in the results. */
  logs: z.boolean(),
  /** Keep each response's headers and body (up to 256 KB) to look at them while the app is open. */
  keepResponses: z.boolean(),
  /** At the end, write what scripts set into the environment and collection files. */
  persistVariables: z.boolean(),
  /** shared: the cookies Sendix already has; isolated: start the run with an empty jar. */
  cookies: z.enum(["shared", "isolated"]),
  /** isolated only: add the run's cookies to the shared jar when it ends. */
  saveCookies: z.boolean(),
});
export type RunOptions = z.infer<typeof runOptionsSchema>;

export const DEFAULT_RUN_OPTIONS: RunOptions = { stopOnError: false, logs: true, keepResponses: false, persistVariables: false, cookies: "shared", saveCookies: false };

export const runConfigSchema = z.object({
  collectionId: id,
  /** Run only this folder's requests; null runs the whole collection. */
  folderId: id.nullable(),
  /** Requests to run, in this order; null runs them all in collection order. */
  itemIds: z.array(id).min(1).max(5_000).nullable(),
  iterations: z.number().int().min(1).max(MAX_ITERATIONS),
  delayMs: z.number().int().min(0).max(60_000),
  /** Iteration data: row i feeds iteration i; the last row repeats when there are more iterations. */
  data: z.array(dataRowSchema).max(MAX_DATA_ROWS).nullable(),
  /** Name of the data file, to show it again in the run history. */
  dataName: z.string().max(260).nullable(),
  options: runOptionsSchema,
});
export type RunConfig = z.infer<typeof runConfigSchema>;

/** Response kept for a run row when "keepResponses" is on. */
export interface KeptResponse {
  headers: Array<{ key: string; value: string }>;
  body: string;
  truncated: boolean;
}

export interface RunItemResult {
  /** 1-based. */
  iteration: number;
  /** Position in the whole run, 0-based. */
  sequence: number;
  itemId: string;
  name: string;
  path: string[];
  method: string;
  url: string;
  status: number | null;
  statusText: string | null;
  /** Error code when there was no response. */
  error: string | null;
  message: string | null;
  durationMs: number;
  sizeBytes: number;
  tests: TestResult[];
  errors: ScriptReport["errors"];
  console: ConsoleEntry[];
  response?: KeptResponse;
}

export type RunEvent =
  | { type: "started"; runId: string; requests: number; iterations: number }
  | { type: "item"; runId: string; result: RunItemResult }
  | {
      type: "finished";
      runId: string;
      stopped: boolean;
      error: string | null;
      /** It stopped early because of stopOnError. */
      stoppedOnError: boolean;
      /** Variables written to files with persistVariables (null when not asked). */
      persisted: number | null;
      /** Id of the run in the run history (null if it could not be saved). */
      recordId: number | null;
    };

/** One past run as listed in the run history. */
export interface RunSummary {
  id: number;
  startedAt: number;
  finishedAt: number;
  collectionId: string;
  collectionName: string;
  folderName: string | null;
  iterations: number;
  requests: number;
  /** Rows that failed (no response, failed test or script error). */
  failed: number;
  testsPassed: number;
  testsFailed: number;
  state: "finished" | "stopped" | "error";
}

/** A past run with what is needed to look at it again, repeat it or export it. */
export interface RunRecord extends RunSummary {
  config: RunConfig;
  results: RunItemResult[];
  /** Results beyond what the history keeps were dropped. */
  truncated: boolean;
}

/** A row counts as failed when there was no response, a test failed or a script threw. */
export const resultFailed = (r: RunItemResult) => r.status === null || r.tests.some((t) => !t.passed && !t.skipped) || r.errors.length > 0;
