// The one loud thing on screen (§7.1). Generated, never an asset file (§1).
import type { CSSProperties } from "react";

import { glyphPath, isBroken, polar, RING_RADIUS, ringPath, ringPeriod, sigilGeometry, type Order, type SigilState } from "./sigil-geometry";

const ORDER_VAR: Record<Order, string> = {
  quill: "var(--order-quill)",
  lantern: "var(--order-lantern)",
  crucible: "var(--order-crucible)",
  compass: "var(--order-compass)",
  ledger: "var(--order-ledger)",
};

export interface SigilProps {
  name: string;
  order: Order;
  state?: SigilState;
  size?: number;
  /** Rendered as the accessible name; omit inside a labelled control. */
  title?: string;
  className?: string;
}

export function Sigil({ name, order, state = "idle", size = 18, title, className }: SigilProps) {
  const geo = sigilGeometry(name);
  const broken = isBroken(state);
  const colour = broken ? "var(--oxblood)" : ORDER_VAR[order];
  const dormant = state === "dormant";
  const [tickX, tickY] = polar(0, RING_RADIUS);

  const period = ringPeriod(state);
  // `transform-box: view-box` is the obvious choice here and is what Chromium honours, but
  // WebKit — the engine Tauri actually ships on macOS — falls back to the border box when it
  // does not recognise the value, which resolves `center` in CSS pixels and flings the ring
  // clean out of its row. Seen for real under WebKitGTK, never in the Chromium test run.
  // `fill-box` has been supported everywhere for far longer, and PIN below makes the group's
  // bounding box exactly the viewBox, so its centre is exactly the user-space origin in
  // either engine. Do not "simplify" this back to view-box without rendering it in WebKit.
  const ringStyle: CSSProperties = period
    ? { animation: `ring-turn ${period}s linear infinite`, transformOrigin: "center", transformBox: "fill-box" }
    : {};

  return (
    <svg
      viewBox="-50 -50 100 100"
      width={size}
      height={size}
      className={className}
      style={{ opacity: dormant ? 0.4 : 1, overflow: "visible", flex: "0 0 auto" }}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-sigil={name}
      data-state={state}
      data-glyph={geo.glyph}
      data-strokes={geo.strokes.length}
    >
      <g style={ringStyle} data-part="ring">
        {/* PIN: invisible, but it counts towards getBBox, so the group's fill-box is exactly
            the viewBox and `transform-origin: center` lands on the user-space origin. */}
        <rect x="-50" y="-50" width="100" height="100" fill="none" stroke="none" />
        <path
          d={ringPath(geo.ringRadius, broken ? 34 : 0)}
          fill="none"
          stroke={colour}
          strokeWidth={4.5}
          strokeLinecap="round"
        />
        {geo.strokes.map((s, i) => {
          const [x1, y1] = polar(s.angle, s.inner);
          const [x2, y2] = polar(s.angle, s.outer);
          return (
            <line
              key={i}
              x1={x1.toFixed(2)}
              y1={y1.toFixed(2)}
              x2={x2.toFixed(2)}
              y2={y2.toFixed(2)}
              stroke={colour}
              strokeWidth={s.width}
              strokeLinecap="round"
            />
          );
        })}
      </g>

      <path
        d={glyphPath(geo.glyph)}
        fill={geo.glyph === 3 || geo.glyph === 4 || geo.glyph === 7 ? "none" : colour}
        stroke={colour}
        strokeWidth={3.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        data-part="glyph"
      />

      {/* bound: a brass chord drawn across the ring */}
      {state === "bound" && (
        <line
          x1={polar(214, geo.ringRadius)[0]}
          y1={polar(214, geo.ringRadius)[1]}
          x2={polar(34, geo.ringRadius)[0]}
          y2={polar(34, geo.ringRadius)[1]}
          stroke="var(--brass)"
          strokeWidth={4.5}
          strokeLinecap="round"
          data-part="chord"
        />
      )}

      {/* awaiting seal: a brass dot pulsing at 1s */}
      {state === "awaiting-seal" && (
        <circle
          cx={0}
          cy={-geo.ringRadius}
          r={9}
          fill="var(--brass)"
          style={{ animation: "seal-pulse 1s ease-in-out infinite" }}
          data-part="seal-dot"
        />
      )}

      {/* reduced motion replaces the rotation with a static brass tick (§7.4) */}
      {period !== null && (
        <line
          className="sigil-tick"
          x1={tickX}
          y1={tickY}
          x2={tickX}
          y2={tickY - 12}
          stroke="var(--brass)"
          strokeWidth={5}
          strokeLinecap="round"
          data-part="tick"
        />
      )}
    </svg>
  );
}
