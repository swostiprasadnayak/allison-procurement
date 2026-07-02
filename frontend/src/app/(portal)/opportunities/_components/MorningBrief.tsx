"use client";

import { useEffect, useState } from "react";
import { useOpportunityStore } from "@/context/OpportunityStoreContext";
import { MercerStar } from "@/components/mercer";
import { fmtCompact, fmtDate, fmtRange } from "@/lib/format";

/** MRO L2 sub-categories in the estate — the scan-coverage denominator. */
const MRO_CATEGORIES_TOTAL = 15;

interface BriefCard {
  key: string;
  /** Large value on top (Geist Medium 14/22, tabular-nums). */
  value: string;
  /** Card label under the value (Geist Regular 12/18). */
  label: string;
  /** Optional sublabel under the label (Geist Regular 11/16). */
  sublabel?: string;
}

/**
 * A metric card in the Mercer Brief — same visual style as the detail-panel
 * summary tiles (value large on top, label below), so the brief's headline
 * numbers read as proper cards, not one-line pills.
 */
function Card({ card }: { card: BriefCard }) {
  return (
    <div
      className="flex min-w-[140px] flex-[1_1_140px] flex-col gap-1 rounded-[8px] px-3 py-2"
      style={{ background: "#F8F3FF", border: "1px solid #DAC4FF" }}
    >
      <span
        className="whitespace-nowrap text-[14px] font-medium leading-[22px]"
        style={{ color: "#181A1B", fontVariantNumeric: "tabular-nums" }}
      >
        {card.value}
      </span>
      <span className="whitespace-nowrap text-[12px] leading-[18px]" style={{ color: "#1E1E1E" }}>
        {card.label}
      </span>
      {card.sublabel && (
        <span
          className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-[16px]"
          style={{ color: "#1E1E1E" }}
        >
          {card.sublabel}
        </span>
      )}
    </div>
  );
}

/**
 * "Mercer Brief" — the Allison brief card (Figma node 19:459): a header row
 * (AI star + title left, the real scan-run date right), a dynamic narrative
 * summarizing the sweep, and a row of metric cards. Every number is derived
 * from the opportunity store (plus the MRO estate total from /api/cockpit), so
 * the brief can never disagree with the feed or the sidebar badges.
 *
 * `l2` scopes the narrative + cards to a single sub-category when the page's
 * sub-category filter is set; the "Total MRO spend" card always reports the
 * estate total.
 */
export function MorningBrief({ l2 = null }: { l2?: string | null }) {
  const { feed, tracked } = useOpportunityStore();

  // MRO estate total — fetched on mount like the store providers; the card is
  // hidden gracefully if the fetch fails.
  const [mroNetSpend, setMroNetSpend] = useState<number | null>(null);
  useEffect(() => {
    fetch("/api/cockpit")
      .then((r) => r.json())
      .then((data: { kpis?: { mroNetSpend?: number } }) => {
        const v = data?.kpis?.mroNetSpend;
        if (typeof v === "number") setMroNetSpend(v);
      })
      .catch(() => {});
  }, []);

  // Indirect footprint — real figures from ref.category_footprint (the cube's
  // Consol 1). Powers the "scanned X of Y" line so the brief shows the platform's
  // runway without hardcoding numbers. Hidden gracefully if the fetch fails.
  const [footprint, setFootprint] = useState<{
    totalSpend: number;
    scannedSpend: number;
    scannedCount: number;
    totalCount: number;
  } | null>(null);
  useEffect(() => {
    fetch("/api/footprint")
      .then((r) => r.json())
      .then((d) => {
        if (d && typeof d.totalSpend === "number") setFootprint(d);
      })
      .catch(() => {});
  }, []);

  // Survivors = the live feed + everything already tracked; scope to a single
  // sub-category when the page filter is set.
  const survivors = [...feed, ...tracked].filter((o) => !l2 || o.l2 === l2);

  const opportunityCount = survivors.length;
  const addressable = survivors.reduce((sum, o) => sum + (o.movableValue ?? 0), 0);
  const savingsLow = survivors.reduce((sum, o) => sum + o.savingsLow, 0);
  const savingsHigh = survivors.reduce((sum, o) => sum + o.savingsHigh, 0);
  const categoryCount = new Set(survivors.map((o) => o.l2)).size;

  // Real scan-run date — the latest surfaced date across survivors (events[0].at
  // is the scan/surfaced event). Omitted gracefully when there's nothing to date.
  const scanRunDate = survivors.reduce<string | null>((latest, o) => {
    const at = o.events[0]?.at;
    if (!at) return latest;
    return latest === null || at > latest ? at : latest;
  }, null);

  const cards: BriefCard[] = [];
  if (mroNetSpend !== null) {
    cards.push({ key: "mro", value: fmtCompact(mroNetSpend), label: "Total MRO spend" });
  }
  cards.push(
    { key: "addressable", value: fmtCompact(addressable), label: "Addressable", sublabel: "contestable" },
    { key: "savings", value: fmtRange(savingsLow, savingsHigh), label: "Savings Potential" },
    { key: "opportunities", value: String(opportunityCount), label: "Opportunities" },
    {
      key: "categories",
      value: `${categoryCount} of ${MRO_CATEGORIES_TOTAL} scanned`,
      label: "Categories",
    },
  );

  return (
    <section
      aria-label="Mercer Brief"
      className="mercer-fade-up flex flex-col overflow-clip rounded-[12px]"
      style={{
        background: "linear-gradient(180deg, #FAF7FF 0%, #FFFFFF 45.56%)",
        boxShadow: "0px 0px 1px 0px rgba(0,0,0,0.25), 0px 1px 4px 0px rgba(0,0,0,0.06)",
      }}
    >
      <div className="flex w-full flex-col gap-3 p-3">
        {/* Header row + dynamic narrative */}
        <div className="flex w-full flex-col gap-2">
          <div className="flex w-full items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <MercerStar size={16} />
              <h2 className="text-[14px] font-medium leading-[22px]" style={{ color: "#181A1B" }}>
                Mercer Brief
              </h2>
            </div>
            {scanRunDate && (
              <span
                className="whitespace-nowrap text-[12px] leading-[18px]"
                style={{ color: "#181A1B" }}
              >
                Scan run {fmtDate(scanRunDate)}
              </span>
            )}
          </div>
          <p className="w-full text-[14px] leading-[22px]" style={{ color: "#18181B" }}>
            Mercer&apos;s scan covered {categoryCount} MRO{" "}
            {categoryCount === 1 ? "category" : "categories"} and surfaced {opportunityCount}{" "}
            {opportunityCount === 1 ? "opportunity" : "opportunities"} — {fmtCompact(addressable)}{" "}
            addressable, {fmtRange(savingsLow, savingsHigh)} estimated savings. Ranked by evidence
            strength.
          </p>
        </div>

        {/* Metric cards */}
        <div className="flex w-full flex-wrap items-stretch gap-2">
          {cards.map((card) => (
            <Card key={card.key} card={card} />
          ))}
        </div>

        {/* Footprint line — the platform's runway across Allison's indirect estate. */}
        {footprint && (
          <p className="text-[12px] leading-[18px]" style={{ color: "#52525B" }}>
            Scanned <span style={{ fontWeight: 500, color: "#181A1B" }}>MRO</span> —{" "}
            {fmtCompact(footprint.scannedSpend)} of {fmtCompact(footprint.totalSpend)} indirect spend
            {" · "}
            {footprint.scannedCount} of {footprint.totalCount} categories. More categories coming.
          </p>
        )}
      </div>
    </section>
  );
}
