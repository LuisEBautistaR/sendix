/**
 * Reads runner data files: CSV with a header row (RFC 4180 quoting) or a JSON
 * array of objects. Pure, so the renderer can preview and tests can cover it.
 */
import { MAX_DATA_ROWS, type DataRow } from "./runner";

export interface DataFile {
  format: "csv" | "json";
  columns: string[];
  rows: DataRow[];
}

export class DataFileError extends Error {}

export function parseDataFile(text: string, fileName: string): DataFile {
  const clean = text.replace(/^﻿/, "");
  const looksJson = /\.json$/i.test(fileName) || /^\s*\[/.test(clean);
  return looksJson ? parseJson(clean) : parseCsv(clean);
}

function parseJson(text: string): DataFile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new DataFileError("El JSON no es válido.");
  }
  if (!Array.isArray(value)) throw new DataFileError("El JSON debe ser una lista de objetos.");
  if (value.length > MAX_DATA_ROWS) throw new DataFileError(`El archivo tiene más de ${MAX_DATA_ROWS} filas.`);
  const columns = new Set<string>();
  const rows = value.map((entry, i): DataRow => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new DataFileError(`La fila ${i + 1} no es un objeto.`);
    const row: DataRow = {};
    for (const [key, v] of Object.entries(entry as Record<string, unknown>)) {
      columns.add(key);
      row[key] = v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : JSON.stringify(v);
    }
    return row;
  });
  return { format: "json", columns: [...columns], rows };
}

/** Splits CSV text into records of fields, honouring quotes, escaped quotes and newlines inside quotes. */
export function csvRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += ch;
  }
  if (quoted) throw new DataFileError("Hay comillas sin cerrar en el CSV.");
  if (field !== "" || record.length) {
    record.push(field);
    records.push(record);
  }
  return records.filter((r) => !(r.length === 1 && r[0] === ""));
}

function parseCsv(text: string): DataFile {
  const [header, ...body] = csvRecords(text);
  if (!header) throw new DataFileError("El CSV está vacío.");
  const columns = header.map((h) => h.trim());
  if (columns.some((c) => c === "")) throw new DataFileError("Hay columnas sin nombre en la cabecera del CSV.");
  if (body.length > MAX_DATA_ROWS) throw new DataFileError(`El archivo tiene más de ${MAX_DATA_ROWS} filas.`);
  const rows = body.map((fields) => Object.fromEntries(columns.map((c, i) => [c, fields[i] ?? ""])));
  return { format: "csv", columns, rows };
}
