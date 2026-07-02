"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@navanta-ai/design-system";
import { Function as FunctionIcon } from "@phosphor-icons/react";

/** One step in the scan → opportunity pipeline: the formula/rule, the plain-English
 *  read, and the parameter(s) that tune it (which map to the editable dials below). */
interface Step {
  n: number;
  title: string;
  formula: string;
  plain: string;
  tunedBy: string[];
}

const STEPS: Step[] = [
  {
    n: 1,
    title: "Rank the categories (scan)",
    formula: "score = Prize × Feasibility × Provability²",
    plain:
      "Every sub-category is scored on size (Prize), how actionable it is (Feasibility), and how defensible the savings are (Provability). Provability is squared so it dominates — we only chase savings we can prove. The top-ranked sub-categories go to deep-dive.",
    tunedBy: ["prov_exponent", "feas_frag_weight", "feas_xbu_weight", "scan_deep_dive_top_n"],
  },
  {
    n: 2,
    title: "Define the pocket",
    formula: "pocket = L3 category × country",
    plain:
      "A pocket is the unit we actually source — one L3 commodity in one country. A pocket must clear a minimum spend and vendor count to be worth acting on.",
    tunedBy: ["play_min_spend", "play_min_vendors"],
  },
  {
    n: 3,
    title: "Segment gate (engineered carve-out)",
    formula: "engineered → OEM carve-out (no consolidation)",
    plain:
      "Engineered items (e.g. 'Machine parts') are tied to their OEM and can't be competitively re-sourced, so they're carved out of the consolidation logic rather than forced into a play.",
    tunedBy: ["engineered_segments"],
  },
  {
    n: 4,
    title: "Find the winner + route the play",
    formula: "winner_share = top non-OEM vendor ÷ pocket spend   →   ≥ 50% Consolidate · else RFP",
    plain:
      "The winner is the largest non-OEM supplier in the pocket. If they already hold at least half the spend, we fold the tail to them (Consolidate to incumbent). If it's fragmented, we contest the whole base (Competitive RFP).",
    tunedBy: ["winner_share_consolidate"],
  },
  {
    n: 5,
    title: "Compute movable spend",
    formula: "Consolidate → pocket − winner − OEM     RFP → pocket − OEM",
    plain:
      "Movable spend is what we can realistically move: the incumbent's own spend and OEM/sole-source spend are removed. This is the base the savings rate applies to — not the headline spend.",
    tunedBy: ["engineered_segments"],
  },
  {
    n: 6,
    title: "Apply lever-tiered savings",
    formula: "savings = movable × rate   (consolidate 4–7% · RFP 5–8% · fragmented tail 6–10% · services 5–8%)",
    plain:
      "The savings rate depends on the lever — consolidation to an incumbent yields less than competing a fragmented base. Rates are conservative ranges, not point estimates.",
    tunedBy: [
      "savings_rate.consolidate_incumbent",
      "savings_rate.competitive_rfp",
      "savings_rate.fragmented_tail",
      "savings_rate.services_ratecard",
    ],
  },
];

export function MethodologyExplainer() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FunctionIcon size={18} weight="duotone" />
          How the engine calculates
        </CardTitle>
        <CardDescription>
          The scan → opportunity pipeline, end to end. Each step is driven by the parameters in the
          registry below — change a dial and you change that step&apos;s behaviour on the next run.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-4">
          {STEPS.map((s) => (
            <li key={s.n} className="flex gap-3">
              <span
                className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
                style={{ background: "var(--muted,#f4f4f5)", color: "var(--text-primary)" }}
              >
                {s.n}
              </span>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  {s.title}
                </span>
                <code
                  className="w-fit rounded-md px-2 py-1 text-[12px]"
                  style={{
                    background: "var(--muted,#f4f4f5)",
                    color: "var(--text-primary)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {s.formula}
                </code>
                <span className="text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {s.plain}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                  <span>Tuned by:</span>
                  {s.tunedBy.map((k) => (
                    <code
                      key={k}
                      className="rounded px-1.5 py-0.5"
                      style={{ background: "var(--muted,#f0f0f2)", color: "var(--text-secondary)" }}
                    >
                      {k}
                    </code>
                  ))}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
