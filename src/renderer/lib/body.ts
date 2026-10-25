import type { Header } from "@shared/http";

export type BodyKind = "json" | "xml" | "html" | "text" | "image" | "binary" | "empty";

export interface DecodedBody {
  kind: BodyKind;
  /** Text as received (empty for images and binary). */
  text: string;
  /** Indented JSON when the body parses as JSON. */
  pretty: string | null;
  /** data: URL for images up to 10 MB (the CSP allows data: images only). */
  imageUrl: string | null;
  contentType: string;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function headerValue(headers: readonly Header[], name: string): string {
  return headers.find((h) => h.key.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 1024);
  for (const b of sample) if (b === 0) return true;
  return false;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function decodeBody(bytes: Uint8Array, headers: readonly Header[]): DecodedBody {
  const contentType = headerValue(headers, "content-type").toLowerCase();
  const base = { pretty: null, imageUrl: null, contentType };
  if (bytes.byteLength === 0) return { ...base, kind: "empty", text: "" };

  const mime = contentType.split(";")[0]!.trim();
  if (mime.startsWith("image/") && mime !== "image/svg+xml") {
    return { ...base, kind: "image", text: "", imageUrl: bytes.byteLength <= MAX_IMAGE_BYTES ? `data:${mime};base64,${toBase64(bytes)}` : null };
  }
  if (looksBinary(bytes)) return { ...base, kind: "binary", text: "" };

  const charset = /charset=([^;]+)/.exec(contentType)?.[1]?.trim() ?? "utf-8";
  let text: string;
  try {
    text = new TextDecoder(charset).decode(bytes);
  } catch {
    text = new TextDecoder("utf-8").decode(bytes);
  }

  const trimmed = text.trimStart();
  if (mime.includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return { ...base, kind: "json", text, pretty: JSON.stringify(JSON.parse(text), null, 2) };
    } catch {
      if (mime.includes("json")) return { ...base, kind: "json", text };
    }
  }
  if (mime.includes("html")) return { ...base, kind: "html", text };
  if (mime.includes("xml") || trimmed.startsWith("<?xml")) return { ...base, kind: "xml", text };
  return { ...base, kind: "text", text };
}
