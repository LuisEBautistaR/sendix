import { useRef, useState } from "react";
import { looksLikeCurl, parseCurl } from "@shared/curl";
import { useStore, type EditableTab } from "../state/store";
import { segments } from "../lib/vars";

/**
 * URL field that colours {{variables}} (defined, secret or missing) by drawing the
 * same text in a layer behind a transparent input. Pasting a cURL command turns it
 * into the whole request.
 */
export function UrlInput({ tab }: { tab: EditableTab }) {
  const variables = useStore((s) => s.variables);
  const { setUrl, setRealtimeDraft, setGrpcDraft, replaceDraft, notify } = useStore.getState();
  const realtime = tab.kind === "realtime";
  const value = tab.kind === "grpc" ? tab.draft.target : tab.draft.url;
  const layer = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const parts = segments(value, variables);

  return (
    <div className={`url-field${focused ? " focused" : ""}`}>
      <div className="url-layer mono" ref={layer} aria-hidden="true">
        {parts.map((p, i) =>
          p.variable ? (
            <span key={i} className={`var${p.variable.defined ? "" : " missing"}${p.variable.secret ? " secret" : ""}`}>
              {p.text}
            </span>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </div>
      <input
        className="url"
        value={value}
        placeholder={
          tab.kind === "grpc"
            ? "localhost:50051  ·  grpcs:// para TLS"
            : tab.kind === "realtime"
            ? tab.draft.protocol === "websocket"
              ? "wss://api.ejemplo.com/socket"
              : "https://api.ejemplo.com  ·  el espacio de nombres va en la ruta"
            : "https://api.ejemplo.com/recurso  ·  o pega un comando curl"
        }
        aria-label="URL"
        data-testid="url"
        spellCheck={false}
        autoFocus
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onScroll={(e) => {
          if (layer.current) layer.current.scrollLeft = e.currentTarget.scrollLeft;
        }}
        onChange={(e) => {
          const url = e.target.value;
          if (tab.kind === "grpc") setGrpcDraft(tab.id, (d) => ({ ...d, target: url }));
          else if (realtime) setRealtimeDraft(tab.id, (d) => ({ ...d, url }));
          else setUrl(tab.id, url);
          if (layer.current) layer.current.scrollLeft = e.target.scrollLeft;
        }}
        onPaste={(e) => {
          if (tab.kind !== "request") return;
          const text = e.clipboardData.getData("text");
          if (!looksLikeCurl(text)) return;
          const parsed = parseCurl(text);
          if (!parsed) return;
          e.preventDefault();
          replaceDraft(tab.id, parsed.request, parsed.notes);
          notify("ok", "Comando curl convertido en petición.");
        }}
      />
    </div>
  );
}
