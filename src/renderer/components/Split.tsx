import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { SPLIT_DEFAULT, SPLIT_MAX, SPLIT_MIN } from "@shared/prefs";
import { useStore } from "../state/store";

const clamp = (n: number) => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Math.round(n)));

/**
 * Request | response layout with a draggable divider. The width is a share of the screen,
 * saved in Settings when the drag ends, so every tab and the next session use it.
 * Arrow keys move it too; double click puts it back.
 */
export function Split({ left, right }: { left: ReactNode; right: ReactNode }) {
  const saved = useStore((s) => s.prefs.ui.splitPercent);
  const [live, setLive] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const percent = live ?? saved;

  const save = (splitPercent: number) => void useStore.getState().savePrefs((p) => ({ ...p, ui: { ...p.ui, splitPercent } }));
  const fromX = (x: number) => {
    const rect = box.current!.getBoundingClientRect();
    return clamp(((x - rect.left) / rect.width) * 100);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setLive(fromX(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (live !== null) setLive(fromX(e.clientX));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (live === null) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (live !== saved) save(live);
    setLive(null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 2;
    const next = e.key === "ArrowLeft" ? percent - step : e.key === "ArrowRight" ? percent + step : e.key === "Home" ? SPLIT_MIN : e.key === "End" ? SPLIT_MAX : null;
    if (next === null) return;
    e.preventDefault();
    save(clamp(next));
  };

  return (
    <div className={`split${live !== null ? " resizing" : ""}`} ref={box} style={{ "--split": `${percent}%` } as CSSProperties}>
      {left}
      <div
        className="split-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Ancho de la petición y la respuesta"
        aria-valuemin={SPLIT_MIN}
        aria-valuemax={SPLIT_MAX}
        aria-valuenow={percent}
        title="Arrastra para cambiar el ancho; doble clic para volver al original"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setLive(null)}
        onDoubleClick={() => save(SPLIT_DEFAULT)}
        onKeyDown={onKeyDown}
        data-testid="split-handle"
      />
      {right}
    </div>
  );
}
