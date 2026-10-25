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

export const runConfigSchema = z.object({
  collectionId: id,
  /** Run only this folder's requests; null runs the whole collection. */
  folderId: id.nullable(),
  iterations: z.number().int().min(1).max(MAX_ITERATIONS),
  delayMs: z.number().int().min(0).max(60_000),
  /** Iteration data: row i feeds iteration i; the last row repeats when there are more iterations. */
  data: z.array(dataRowSchema).max(MAX_DATA_ROWS).nullable(),
});
export type RunConfig = z.infer<typeof runConfigSchema>;

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
}

export type RunEvent =
  | { type: "started"; runId: string; requests: number; iterations: number }
  | { type: "item"; runId: string; result: RunItemResult }
  | { type: "finished"; runId: string; stopped: boolean; error: string | null };
