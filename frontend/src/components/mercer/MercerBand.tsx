"use client";

import { useState, type ReactNode } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { MercerStar } from "./MercerStar";

interface MercerBandProps {
  /** Caption row text, e.g. "Mercer recommends · Confidence 80%". */
  caption: string;
  /** The recommended action headline, e.g. "Consolidate 18 vendors onto Fuchs · RFQ by Jul 10". */
  headline: string;
  /** Rationale bullets rendered as a compact secondary list. */
  bullets?: string[];
  /** Action buttons, right-aligned below the content. */
  actions?: ReactNode;
  /** When true, the rationale bullets collapse behind a "Why?" toggle (default
   *  collapsed) so the band stays compact; default renders them inline. */
  collapsibleBullets?: boolean;
  /** When true, lays the recommendation out as a row — caption + headline on the
   *  left, actions right-aligned and vertically centred (Figma node 22:299) —
   *  instead of the default vertical stack with actions below. */
  horizontal?: boolean;
  /** When true, drops the band's own rounding so it sits flush as a full-width
   *  footer inside a parent card (Figma node 22:299). */
  flush?: boolean;
}

/**
 * The lavender Mercer recommendation band — the signature AI surface. Every
 * Mercer suggestion in the app renders inside this gradient. Purple = Mercer
 * only; on commit the caller swaps this band for <CommittedBand /> wrapped in
 * `.mercer-commit-success`.
 */
export function MercerBand({
  caption,
  headline,
  bullets,
  actions,
  collapsibleBullets = false,
  horizontal = false,
  flush = false,
}: MercerBandProps) {
  const [showWhy, setShowWhy] = useState(false);
  const hasBullets = Boolean(bullets && bullets.length > 0);
  const bulletsVisible = hasBullets && (!collapsibleBullets || showWhy);

  const captionEl = (
    <div className="flex items-center gap-1.5">
      <MercerStar size={12} />
      <span className="text-xs font-semibold" style={{ color: "#59349C" }}>
        {caption}
      </span>
    </div>
  );

  const headlineEl = (
    <p className="text-sm font-medium leading-snug" style={{ color: "#181A1B" }}>
      {headline}
    </p>
  );

  const whyToggle =
    hasBullets && collapsibleBullets ? (
      <button
        type="button"
        onClick={() => setShowWhy((v) => !v)}
        className="flex items-center gap-1 self-start text-xs font-medium"
        style={{ color: "#59349C" }}
        aria-expanded={showWhy}
      >
        <CaretDown
          size={12}
          weight="bold"
          style={{
            transform: showWhy ? "rotate(0deg)" : "rotate(-90deg)",
            transition: "transform 150ms ease",
          }}
        />
        {showWhy ? "Hide reasoning" : `Why? · ${bullets!.length} signals`}
      </button>
    ) : null;

  const bulletsList = bulletsVisible ? (
    <ul className="flex flex-col gap-1 pl-4">
      {bullets!.map((bullet, i) => (
        <li
          key={i}
          className="list-disc text-xs leading-relaxed"
          style={{ color: "var(--text-secondary)" }}
        >
          {bullet}
        </li>
      ))}
    </ul>
  ) : null;

  return (
    <div
      className={`flex flex-col gap-2 p-3 ${flush ? "rounded-none" : "rounded-lg"}`}
      style={{
        background: "linear-gradient(to right, #EBDFFF 72%, #F3ECFE 100%)",
      }}
    >
      {horizontal ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            {/* Caption + the Why? toggle share one row (Why sits to the right of
                the confidence text); the headline drops below. */}
            <div className="flex flex-wrap items-center gap-3">
              {captionEl}
              {whyToggle}
            </div>
            {headlineEl}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      ) : (
        <>
          {captionEl}
          {headlineEl}
          {whyToggle}
        </>
      )}

      {bulletsList}

      {!horizontal && actions && (
        <div className="flex items-center justify-end gap-2 pt-1">{actions}</div>
      )}
    </div>
  );
}
