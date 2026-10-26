import { useEffect, useRef, useState } from "react";
import type { LinkedRequest } from "@shared/links";
import type { HttpRequest, RawLanguage } from "@shared/http";
import { emptyRequest, useStore } from "../state/store";
import { methodClass } from "./RequestPane";

type Link = { id: string; request: LinkedRequest };

const MAX_SHOWN_HEADERS = 8;
const MAX_SHOWN_BODY = 600;

/** The editable request a link turns into: a new, unsaved tab. */
export function draftFromLink(link: LinkedRequest): HttpRequest {
  const base = emptyRequest();
  const contentType = link.headers.find((h) => h.key.toLowerCase() === "content-type")?.value.toLowerCase() ?? "";
  let language: RawLanguage = "text";
  if (link.body !== null) {
    if (contentType.includes("json")) language = "json";
    else if (contentType.includes("xml")) language = "xml";
    else if (contentType.includes("html")) language = "html";
    else {
      try {
        JSON.parse(link.body);
        language = "json";
      } catch {
        language = "text";
      }
    }
  }
  return {
    ...base,
    method: link.method,
    url: link.url,
    headers: link.headers.map((h) => ({ key: h.key, value: h.value, enabled: true })),
    body: link.body === null || link.body === "" ? { mode: "none" } : { mode: "raw", language, raw: link.body },
  };
}

/**
 * Asks before a sendix:// link (Mockix's «Abrir en Sendix», or any other app) opens a request.
 * Opening only creates a tab: nothing is sent until the user presses Enviar.
 */
export function LinkDialog() {
  const [queue, setQueue] = useState<Link[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const current = queue[0];

  useEffect(() => {
    const add = (link: Link) => setQueue((q) => (q.some((l) => l.id === link.id) ? q : [...q, link]));
    const off = window.sendix.links.onRequest(add);
    void window.sendix.links.pending().then((list) => list?.forEach(add));
    return off;
  }, []);

  useEffect(() => {
    if (current && !dialog.current?.open) dialog.current?.showModal();
    if (!current && dialog.current?.open) dialog.current.close();
  }, [current]);

  if (!current) return null;
  const answer = async (open: boolean) => {
    setQueue((q) => q.slice(1));
    const link = await window.sendix.links.decide(current.id);
    if (open && link) useStore.getState().newRequest(draftFromLink(link.request));
  };
  const r = current.request;
  const body = r.body ?? "";

  return (
    <dialog ref={dialog} className="dialog link-dialog" onCancel={(e) => (e.preventDefault(), void answer(false))} aria-labelledby="link-title" data-testid="link-dialog">
      <h2 id="link-title">¿Abrir esta petición?</h2>
      <p className="hint">Un enlace sendix:// (por ejemplo, «Abrir en Sendix» de Mockix) pide abrirla en una pestaña nueva. No se envía nada hasta que pulses Enviar.</p>
      <p className="link-line mono" data-testid="link-request">
        <span className={`meth ${methodClass(r.method)}`}>{r.method}</span> {r.url}
      </p>
      {r.headers.length > 0 && (
        <ul className="link-headers mono">
          {r.headers.slice(0, MAX_SHOWN_HEADERS).map((h) => (
            <li key={h.key}>
              <b>{h.key}:</b> {h.value}
            </li>
          ))}
          {r.headers.length > MAX_SHOWN_HEADERS && <li className="muted">y {r.headers.length - MAX_SHOWN_HEADERS} cabeceras más</li>}
        </ul>
      )}
      {body && (
        <pre className="link-body mono">
          {body.slice(0, MAX_SHOWN_BODY)}
          {body.length > MAX_SHOWN_BODY ? "\n…" : ""}
        </pre>
      )}
      {queue.length > 1 && <p className="hint">Hay {queue.length - 1} enlaces más esperando.</p>}
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={() => void answer(false)} data-testid="link-reject">
          No abrir
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void answer(true)} data-testid="link-accept">
          Abrir en una pestaña nueva
        </button>
      </div>
    </dialog>
  );
}
