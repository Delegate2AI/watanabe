"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  IDENTITY,
  MAX_SCALE,
  MIN_SCALE,
  STEP,
  fitScale,
  panBy,
  wheelFactor,
  zoomAt,
  type ZoomState,
} from "@/lib/markdown/mermaid-zoom";

/**
 * Full-window zoom and pan for a rendered diagram, opened from the expand
 * control on `components/ui/mermaid.tsx`. Modelled on GitHub's mermaid viewer:
 * scroll to zoom at the cursor, drag to pan, a +/reset/- toolbar, and Escape to
 * close.
 *
 * Why a modal rather than zooming the diagram in place: a diagram wide enough to
 * need zooming is wider than the prose column it sits in, so zooming inline
 * would just enlarge it inside the same narrow box. The whole point is to escape
 * that column.
 *
 * The SVG string is re-used verbatim, which means the ids inside it exist twice
 * while this is open. That is deliberate. Mermaid emits a `<style>` block scoped
 * by `#<id>` and refers to its own arrowhead markers by `url(#...)`, so a copy
 * that kept its ids renders identically, whereas rewriting them would have to
 * rewrite the stylesheet and every marker reference in step. Duplicate ids are
 * invalid HTML and browsers resolve both selectors and `url(#...)` against every
 * matching element, which is exactly the behaviour this relies on. Nothing in
 * the app looks a diagram up by id.
 */

/** Pointer position relative to the box CENTRE, which is what `zoomAt` expects. */
function centreRelative(el: HTMLElement, clientX: number, clientY: number) {
  const r = el.getBoundingClientRect();
  return { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) };
}

function ZoomStage({ svg }: { svg: string }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<ZoomState>(IDENTITY);
  /** The opening scale, which is also where the reset control goes back to. */
  const [fit, setFit] = useState(IDENTITY.scale);
  // Held in a ref, not state: a drag updates on every pointermove and the last
  // position is only ever read by the next move, so putting it in state would
  // re-render twice per frame to no visible effect.
  const drag = useRef<{ x: number; y: number } | null>(null);

  /** Zoom about the box centre, for the toolbar and the keyboard. */
  const stepZoom = useCallback((factor: number) => {
    setView((v) => zoomAt(v, factor, { x: 0, y: 0 }));
  }, []);

  const reset = useCallback(() => setView({ scale: fit, x: 0, y: 0 }), [fit]);

  /**
   * Measures on attach rather than in an effect. The diagram's size is only
   * knowable from the laid-out DOM, and a callback ref runs during the commit
   * with the SVG already in place, so the opening scale is applied before the
   * first paint. Setting it from an effect would show one frame at 100% and
   * then jump, and would trip `react-hooks/set-state-in-effect` besides.
   */
  const attach = useCallback((node: HTMLDivElement | null) => {
    boxRef.current = node;
    const diagram = node?.querySelector("svg");
    if (!node || !diagram) return;
    const scale = fitScale(node.getBoundingClientRect(), diagram.getBoundingClientRect());
    setFit(scale);
    setView({ scale, x: 0, y: 0 });
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    // Registered by hand rather than as an `onWheel` prop because React attaches
    // wheel listeners passively, where `preventDefault` is ignored and the page
    // behind the modal scrolls while the diagram zooms.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const point = centreRelative(el, e.clientX, e.clientY);
      setView((v) => zoomAt(v, wheelFactor(e.deltaY), point));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Left button only, so a right-click or a context menu does not start a drag
    // that never ends.
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const from = drag.current;
    if (!from) return;
    drag.current = { x: e.clientX, y: e.clientY };
    setView((v) => panBy(v, e.clientX - from.x, e.clientY - from.y));
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  function onDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    const el = boxRef.current;
    if (!el) return;
    // Toggles rather than always zooming in, so the same gesture that magnifies
    // a node is also the way back out of it.
    if (view.scale > fit) reset();
    else setView((v) => zoomAt(v, 2, centreRelative(el, e.clientX, e.clientY)));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "+" || e.key === "=") stepZoom(STEP);
    else if (e.key === "-" || e.key === "_") stepZoom(1 / STEP);
    else if (e.key === "0") reset();
    else return;
    e.preventDefault();
  }

  const percent = Math.round(view.scale * 100);

  return (
    <>
      <div
        ref={attach}
        role="application"
        aria-label="Diagram, scroll to zoom and drag to pan"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        // The stage is the keyboard target (+ / - / 0 above) and Radix focuses
        // it on open, so it keeps the app's accent focus ring. The offset is
        // pulled INSIDE, though: the ring's default +2px sits on the modal's own
        // edges, where `overflow-hidden` clips three of them and leaves the
        // fourth reading as a stray accent line above the toolbar. Marked
        // important because the ring comes from a global rule of equal
        // specificity (`[data-slot="dialog-content"] :focus-visible` in
        // app/design-tokens.css) that wins on source order. This overrides only
        // where the ring is drawn, never whether it is.
        className="flex min-h-0 flex-1 cursor-grab touch-none select-none items-center justify-center overflow-hidden focus-visible:[outline-offset:-3px]! active:cursor-grabbing"
      >
        <div
          className="md-mermaid-stage"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
          // Safe by mermaid's `securityLevel: "strict"`, which sanitised this
          // string where it was produced (components/ui/mermaid.tsx). This copies
          // that already-sanitised output; it does not widen what may appear.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>

      <div className="flex shrink-0 items-center justify-center gap-1 border-t border-line px-3 py-2">
        <button
          type="button"
          onClick={() => stepZoom(1 / STEP)}
          disabled={view.scale <= MIN_SCALE}
          aria-label="Zoom out"
          className="rounded-control p-1.5 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Minus className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={reset}
          aria-label="Reset zoom"
          className="flex items-center gap-1.5 rounded-control px-2 py-1.5 text-xs tabular-nums text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          {percent}%
        </button>
        <button
          type="button"
          onClick={() => stepZoom(STEP)}
          disabled={view.scale >= MAX_SCALE}
          aria-label="Zoom in"
          className="rounded-control p-1.5 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Plus className="size-4" aria-hidden />
        </button>
      </div>
    </>
  );
}

export function MermaidViewer({
  svg,
  open,
  onOpenChange,
}: {
  svg: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Radix mounts this only while open, so the stage's zoom state is fresh
          on every open without anything having to reset it. */}
      {/* --surface-2, not the dialog's usual --surface: it is the same token
          `.md-mermaid` uses inline and the one the diagram's edge labels were
          drawn against (components/ui/mermaid.tsx), so those label swatches keep
          disappearing into the background here instead of reading as grey chips
          pasted over white. */}
      <DialogContent className="flex h-[92vh] w-[96vw] max-w-none flex-col gap-0 overflow-hidden bg-surface-2 p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Diagram</DialogTitle>
        </DialogHeader>
        <ZoomStage svg={svg} />
      </DialogContent>
    </Dialog>
  );
}
