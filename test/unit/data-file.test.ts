import { describe, expect, it } from "vitest";
import { DataFileError, csvRecords, parseDataFile } from "@shared/data-file";
import { requestOrder } from "../../src/main/runner";

describe("runner data files", () => {
  it("reads CSV with quotes, escaped quotes, newlines in quotes, CRLF and a BOM", () => {
    const file = parseDataFile('﻿usuario,nota\r\nana,"hola, mundo"\r\nluis,"dijo ""sí""\nya"\r\n', "datos.csv");
    expect(file.format).toBe("csv");
    expect(file.columns).toEqual(["usuario", "nota"]);
    expect(file.rows).toEqual([
      { usuario: "ana", nota: "hola, mundo" },
      { usuario: "luis", nota: 'dijo "sí"\nya' },
    ]);
  });

  it("fills missing CSV cells with empty strings and skips blank lines", () => {
    expect(parseDataFile("a,b\n1\n\n2,3\n", "x.csv").rows).toEqual([{ a: "1", b: "" }, { a: "2", b: "3" }]);
    expect(csvRecords("")).toEqual([]);
  });

  it("rejects broken CSV", () => {
    expect(() => parseDataFile('a,b\n"1,2\n', "x.csv")).toThrow(DataFileError);
    expect(() => parseDataFile(",b\n1,2", "x.csv")).toThrow(/sin nombre/);
    expect(() => parseDataFile("", "x.csv")).toThrow(/vacío/);
  });

  it("reads a JSON array of objects, keeping primitive types", () => {
    const file = parseDataFile('[{"id": 1, "activo": true, "extra": {"a": 1}}, {"id": 2, "nombre": null}]', "datos.json");
    expect(file.format).toBe("json");
    expect(file.columns).toEqual(["id", "activo", "extra", "nombre"]);
    expect(file.rows[0]).toEqual({ id: 1, activo: true, extra: '{"a":1}' });
  });

  it("rejects JSON that is not a list of objects", () => {
    expect(() => parseDataFile('{"a": 1}', "x.json")).toThrow(/lista/);
    expect(() => parseDataFile("[1, 2]", "x.json")).toThrow(/no es un objeto/);
    expect(() => parseDataFile("[", "x.json")).toThrow(/no es válido/);
  });

  it("orders requests depth first, as they appear in the collection", () => {
    expect(
      requestOrder([
        { id: "a", name: "a", kind: "request" },
        { id: "f", name: "f", kind: "folder", children: [{ id: "b", name: "b", kind: "request" }, { id: "g", name: "g", kind: "folder", children: [{ id: "c", name: "c", kind: "request" }] }] },
        { id: "d", name: "d", kind: "request" },
      ]),
    ).toEqual(["a", "b", "c", "d"]);
  });
});
