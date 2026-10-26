import { describe, expect, it } from "vitest";
import { filterJson } from "../../src/renderer/lib/filter-json";

const body = JSON.stringify({ productos: [{ id: "prd_1", nombre: "Café de Veracruz", precio: 189 }, { id: "prd_2", nombre: "Té verde", precio: 95 }] });

describe("filterJson", () => {
  it("returns the matches as a JSON array", () => {
    expect(filterJson(body, "$.productos[*].nombre")).toEqual({ ok: true, count: 2, text: JSON.stringify(["Café de Veracruz", "Té verde"], null, 2) });
  });

  it("evaluates filter expressions without eval", () => {
    const r = filterJson(body, "$.productos[?(@.precio < 100)].id");
    expect(r).toMatchObject({ ok: true, count: 1 });
  });

  it("explains invalid JSON and invalid expressions", () => {
    expect(filterJson("<html>", "$")).toEqual({ ok: false, error: "La respuesta no es JSON válido." });
    expect(filterJson(body, "$.productos[?(@.precio >)]")).toMatchObject({ ok: false });
  });

  it("an expression that matches nothing gives an empty list", () => {
    expect(filterJson(body, "$.clientes")).toEqual({ ok: true, count: 0, text: "[]" });
  });
});
