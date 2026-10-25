/**
 * Recognises what a file is and turns it into something a workspace stores:
 * Postman collections (v2.0/v2.1) and environments are taken as they are,
 * HAR captures become a collection, OpenAPI/Swagger is converted by the engine.
 * Runs in main with no Electron imports so it can be unit tested.
 */
import { COLLECTION_SCHEMA_V21, type Json } from "@shared/collection";

export type Detected =
  | { kind: "collection"; json: Json }
  | { kind: "environment"; json: Json }
  | { kind: "har"; json: Json }
  | { kind: "openapi"; text: string }
  | { kind: "unknown"; reason: string };

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

export function detectImport(text: string): Detected {
  const trimmed = text.replace(/^﻿/, "").trim();
  let json: unknown = null;
  try {
    json = JSON.parse(trimmed);
  } catch {
    // YAML is only expected for OpenAPI/Swagger.
    if (/^(openapi|swagger)\s*:/m.test(trimmed)) return { kind: "openapi", text: trimmed };
    return { kind: "unknown", reason: "El archivo no es JSON válido ni una definición OpenAPI en YAML." };
  }
  if (!isObject(json)) return { kind: "unknown", reason: "El archivo no contiene un objeto JSON." };
  if (typeof json["openapi"] === "string" || typeof json["swagger"] === "string") return { kind: "openapi", text: trimmed };
  if (isObject(json["info"]) && Array.isArray(json["item"])) return { kind: "collection", json };
  if (Array.isArray(json["requests"]) && Array.isArray(json["order"])) {
    return { kind: "unknown", reason: "Es una colección v1, un formato antiguo. Expórtala de nuevo como v2.1." };
  }
  if (Array.isArray(json["values"]) && (json["_postman_variable_scope"] === "environment" || typeof json["name"] === "string")) {
    return { kind: "environment", json };
  }
  if (Array.isArray(json["collections"]) || Array.isArray(json["environments"])) {
    return { kind: "unknown", reason: "Es un volcado completo de datos. Exporta cada colección o entorno por separado." };
  }
  if (isObject(json["log"]) && Array.isArray(json["log"]["entries"])) return { kind: "har", json };
  return { kind: "unknown", reason: "No se reconoce el formato: se admiten colecciones y entornos de Postman, OpenAPI/Swagger y HAR." };
}

/** v2.0 stores auth parameters as objects; v2.1 as key/value arrays. Converts in place and marks the file v2.1. */
export function normalizeCollection(json: Json): Json {
  const fixAuth = (auth: unknown) => {
    if (!isObject(auth) || typeof auth["type"] !== "string") return;
    const params = auth[auth["type"]];
    if (isObject(params)) {
      auth[auth["type"]] = Object.entries(params).map(([key, value]) => ({ key, value, type: typeof value === "string" ? "string" : "any" }));
    }
  };
  const walk = (node: Json) => {
    fixAuth(node["auth"]);
    if (isObject(node["request"])) fixAuth(node["request"]["auth"]);
    if (Array.isArray(node["item"])) node["item"].filter(isObject).forEach(walk);
  };
  walk(json);
  if (!isObject(json["info"])) json["info"] = { name: "Colección importada" };
  (json["info"] as Json)["schema"] = COLLECTION_SCHEMA_V21;
  return json;
}

/** Credentials a browser capture carries; they must not end up in a shared folder. */
const DROPPED_HEADERS = new Set(["cookie", "authorization", "proxy-authorization"]);

export function harToCollection(har: Json, name: string): { collection: Json; count: number; notes: string[] } {
  const entries = ((har["log"] as Json)["entries"] as unknown[]).filter(isObject);
  const folders = new Map<string, Json[]>();
  let dropped = 0;
  for (const entry of entries) {
    const req = isObject(entry["request"]) ? entry["request"] : null;
    if (!req || typeof req["url"] !== "string") continue;
    let host = "otros";
    let label = req["url"];
    try {
      const u = new URL(req["url"]);
      host = u.host;
      label = u.pathname || "/";
    } catch {
      /* keep raw */
    }
    const headers = (Array.isArray(req["headers"]) ? req["headers"] : []).filter(isObject).filter((h) => {
      const key = String(h["name"] ?? "");
      if (key.startsWith(":")) return false;
      if (DROPPED_HEADERS.has(key.toLowerCase())) {
        dropped++;
        return false;
      }
      return true;
    });
    const request: Json = {
      method: String(req["method"] ?? "GET").toUpperCase(),
      url: req["url"],
      header: headers.map((h) => ({ key: String(h["name"]), value: String(h["value"] ?? "") })),
    };
    const post = isObject(req["postData"]) ? req["postData"] : null;
    if (post) {
      const mime = String(post["mimeType"] ?? "");
      if (mime.includes("x-www-form-urlencoded") && Array.isArray(post["params"])) {
        request["body"] = {
          mode: "urlencoded",
          urlencoded: post["params"].filter(isObject).map((p) => ({ key: String(p["name"]), value: String(p["value"] ?? "") })),
        };
      } else if (typeof post["text"] === "string") {
        const language = mime.includes("json") ? "json" : mime.includes("xml") ? "xml" : "text";
        request["body"] = { mode: "raw", raw: post["text"], options: { raw: { language } } };
      }
    }
    const list = folders.get(host) ?? [];
    list.push({ name: `${request["method"]} ${label}`, request, response: [] });
    folders.set(host, list);
  }
  const count = [...folders.values()].reduce((n, l) => n + l.length, 0);
  const notes = dropped ? [`Se quitaron ${dropped} cabeceras con credenciales (Cookie, Authorization). Añádelas como variables secretas si las necesitas.`] : [];
  return {
    collection: {
      info: { name, schema: COLLECTION_SCHEMA_V21 },
      item: [...folders.entries()].map(([host, item]) => ({ name: host, item })),
    },
    count,
    notes,
  };
}

export function countRequests(node: Json): number {
  const items = Array.isArray(node["item"]) ? node["item"].filter(isObject) : [];
  return items.reduce((n, item) => n + (Array.isArray(item["item"]) ? countRequests(item) : 1), 0);
}
