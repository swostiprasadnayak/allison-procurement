"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  DataTable,
  Input,
  Pill,
  Tabs,
  type DataTableColumn,
  type TabItem,
} from "@navanta-ai/design-system";
import {
  ArrowsLeftRight,
  ChartBar,
  CheckCircle,
  MagnifyingGlass,
  Stack,
  Target,
  TrendUp,
  WarningCircle,
  type Icon,
} from "@phosphor-icons/react";
import { CellText } from "@/components/ui/CellText";
import type {
  EngineParameter,
  EngineParameters,
  ParamValue,
  ParameterEdit,
  ParameterGroup,
} from "@/lib/cdm";
import { fmtCompact } from "@/lib/format";

/* ─── per-section accent (colored like the rest of the app) ────────────── */

interface SectionStyle {
  accent: string;
  tint: string;
  icon: Icon;
}

const DEFAULT_STYLE: SectionStyle = { accent: "#52525C", tint: "#F4F4F5", icon: Target };

/** Accent keyed by the section's Appendix number (A.3 … A.9). */
const SECTION_STYLES: Record<number, SectionStyle> = {
  3: { accent: "#4F46E5", tint: "#EEF0FE", icon: MagnifyingGlass }, // Scan scoring
  4: { accent: "#0D9488", tint: "#E4F5F2", icon: Stack }, // Vendor tiers
  5: { accent: "#7C3AED", tint: "#F1E9FE", icon: Target }, // Opportunity generation
  6: { accent: "#059669", tint: "#E7F6EE", icon: TrendUp }, // Savings rates
  7: { accent: "#D97706", tint: "#FDF1E1", icon: ChartBar }, // Benchmark
  8: { accent: "#E11D48", tint: "#FCE7EC", icon: ArrowsLeftRight }, // Maverick & tail
};

function styleForSection(category: string): SectionStyle {
  const m = category.match(/A\.(\d+)/);
  return (m && SECTION_STYLES[Number(m[1])]) || DEFAULT_STYLE;
}

/** Client-facing section name — drop the internal "(A.x)" spec reference. */
function sectionDisplayName(category: string): string {
  return category.replace(/\s*\(A\.[\d\s/.]+\)\s*$/, "").trim();
}

/* ─── editability + validation ─────────────────────────────────────────── */

const EDITABLE_SINGLE = new Set(["rate", "share", "usd", "count", "weight", "exponent", "factor"]);

type EditKind = "single" | "range" | "none";

function editKind(unit: string | null): EditKind {
  if (unit && EDITABLE_SINGLE.has(unit)) return "single";
  if (unit === "rate_range") return "range";
  return "none";
}

function validateSingle(raw: string, unit: string | null): string | undefined {
  if (raw.trim() === "") return "Required";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "Not a number";
  if (n < 0) return "Must be ≥ 0";
  if ((unit === "rate" || unit === "share") && n > 1) return "Must be 0–1";
  if ((unit === "count" || unit === "exponent") && !Number.isInteger(n)) return "Whole number";
  return undefined;
}

function validateRange(lo: string, hi: string): string | undefined {
  if (lo.trim() === "" || hi.trim() === "") return "Required";
  const a = Number(lo);
  const b = Number(hi);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "Not a number";
  if (a < 0 || b < 0) return "Must be ≥ 0";
  if (a > 1 || b > 1) return "Must be 0–1";
  if (a > b) return "Low ≤ high";
  return undefined;
}

function unitHint(unit: string | null): string {
  switch (unit) {
    case "rate":
    case "share":
    case "rate_range":
      return "fraction 0–1";
    case "usd":
      return "USD";
    default:
      return unit ?? "";
  }
}

function formatValue(value: ParamValue, unit: string | null): string {
  if (value == null) return "—";
  if (Array.isArray(value)) {
    if (unit === "rate_range" && value.length === 2 && value.every((n) => typeof n === "number")) {
      const [lo, hi] = value as number[];
      return `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`;
    }
    return value.map(String).join(", ");
  }
  if (typeof value === "number") {
    switch (unit) {
      case "rate":
      case "share": {
        const p = value * 100;
        return `${Number.isInteger(p) ? p : Number(p.toFixed(1))}%`;
      }
      case "usd":
        return fmtCompact(value);
      default:
        return String(value);
    }
  }
  return String(value);
}

/* ─── row model (draft embedded so DataTable re-renders on edit) ────────── */

type Row = EngineParameter & {
  singleDraft?: string;
  rangeDraft?: { lo: string; hi: string };
};

function singleStored(p: EngineParameter): string {
  return typeof p.value === "number" ? String(p.value) : "";
}
function rangeStored(p: EngineParameter): { lo: string; hi: string } {
  const v = Array.isArray(p.value) ? (p.value as number[]) : [0, 0];
  return { lo: String(v[0] ?? ""), hi: String(v[1] ?? "") };
}

/* ─── component ─────────────────────────────────────────────────────────── */

export function ParameterRegistry({
  data,
  onSaved,
}: {
  data: EngineParameters | null;
  onSaved: () => void;
}) {
  const [singleEdits, setSingleEdits] = useState<Record<string, string>>({});
  const [rangeEdits, setRangeEdits] = useState<Record<string, { lo: string; hi: string }>>({});
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const setSingle = useCallback((key: string, val: string) => {
    setBanner(null);
    setSingleEdits((prev) => ({ ...prev, [key]: val }));
  }, []);

  const setRangePart = useCallback(
    (key: string, part: "lo" | "hi", val: string, base: { lo: string; hi: string }) => {
      setBanner(null);
      setRangeEdits((prev) => ({ ...prev, [key]: { ...(prev[key] ?? base), [part]: val } }));
    },
    [],
  );

  const allParams = useMemo(() => data?.groups.flatMap((g) => g.params) ?? [], [data]);
  const paramByKey = useMemo(() => new Map(allParams.map((p) => [p.key, p])), [allParams]);

  const { pending, hasInvalid } = useMemo(() => {
    const out: ParameterEdit[] = [];
    let invalid = false;
    for (const [key, raw] of Object.entries(singleEdits)) {
      const p = paramByKey.get(key);
      if (!p) continue;
      if (validateSingle(raw, p.unit)) {
        invalid = true;
        continue;
      }
      const num = Number(raw);
      if (num !== p.value) out.push({ key, valueNumeric: num, valueJson: null });
    }
    for (const [key, { lo, hi }] of Object.entries(rangeEdits)) {
      const p = paramByKey.get(key);
      if (!p) continue;
      if (validateRange(lo, hi)) {
        invalid = true;
        continue;
      }
      const cur = (p.value as number[]) ?? [];
      const a = Number(lo);
      const b = Number(hi);
      if (a !== cur[0] || b !== cur[1]) {
        out.push({ key, valueNumeric: null, valueJson: JSON.stringify([a, b]) });
      }
    }
    return { pending: out, hasInvalid: invalid };
  }, [singleEdits, rangeEdits, paramByKey]);

  const discard = useCallback(() => {
    setSingleEdits({});
    setRangeEdits({});
    setBanner(null);
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setBanner(null);
    try {
      for (const edit of pending) {
        const res = await fetch("/api/parameters", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(edit),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? res.statusText);
        }
      }
      const n = pending.length;
      setSingleEdits({});
      setRangeEdits({});
      onSaved();
      setBanner({
        kind: "ok",
        text: `Saved ${n} parameter change${n === 1 ? "" : "s"}. The engine applies these on its next run.`,
      });
    } catch (e) {
      setBanner({ kind: "err", text: `Save failed: ${String(e)}` });
    } finally {
      setSaving(false);
    }
  }, [pending, onSaved]);

  const columns = useMemo<DataTableColumn<Row>[]>(
    () => [
      {
        key: "param",
        label: "Parameter",
        minWidth: 230,
        cellLayout: "col",
        cell: (r) => <CellText primary={r.label} secondary={r.key} />,
      },
      {
        key: "value",
        label: "Value",
        width: 220,
        cell: (r) => {
          const kind = editKind(r.unit);

          if (kind === "single") {
            const stored = singleStored(r);
            const draft = r.singleDraft ?? stored;
            const err = validateSingle(draft, r.unit);
            const dirty = !err && draft.trim() !== stored;
            const helper = err
              ? undefined
              : dirty
                ? "Unsaved"
                : r.edited
                  ? "Changed from default"
                  : unitHint(r.unit);
            return (
              <div className="w-[190px]">
                <Input
                  size="sm"
                  type="text"
                  inputMode="decimal"
                  value={draft}
                  onChange={(e) => setSingle(r.key, e.target.value)}
                  iconLeft={
                    r.unit === "usd" ? <span style={{ color: "var(--text-secondary)" }}>$</span> : undefined
                  }
                  error={err}
                  helperText={helper}
                />
              </div>
            );
          }

          if (kind === "range") {
            const stored = rangeStored(r);
            const draft = r.rangeDraft ?? stored;
            const err = validateRange(draft.lo, draft.hi);
            const dirty = !err && (draft.lo !== stored.lo || draft.hi !== stored.hi);
            return (
              <div className="w-[200px]">
                <div className="flex items-center gap-1.5">
                  <Input
                    size="sm"
                    type="text"
                    inputMode="decimal"
                    value={draft.lo}
                    onChange={(e) => setRangePart(r.key, "lo", e.target.value, draft)}
                    error={err ? true : undefined}
                  />
                  <span style={{ color: "var(--text-secondary)" }}>–</span>
                  <Input
                    size="sm"
                    type="text"
                    inputMode="decimal"
                    value={draft.hi}
                    onChange={(e) => setRangePart(r.key, "hi", e.target.value, draft)}
                    error={err ? true : undefined}
                  />
                </div>
                <span
                  className="mt-1 block text-xs"
                  style={{ color: err ? "var(--destructive)" : "var(--text-secondary)" }}
                >
                  {err ?? (dirty ? "Unsaved" : r.edited ? "Changed from default" : unitHint(r.unit))}
                </span>
              </div>
            );
          }

          return (
            <div className="flex flex-col gap-1">
              <Pill variant="neutral" size="sm">
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatValue(r.value, r.unit)}</span>
              </Pill>
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                Read-only (structural)
              </span>
            </div>
          );
        },
      },
      {
        key: "desc",
        label: "What it controls",
        minWidth: 280,
        cellLayout: "col",
        cell: (r) => <span style={{ color: "var(--text-secondary)" }}>{r.description ?? "—"}</span>,
      },
    ],
    [setSingle, setRangePart],
  );

  /** One section: colored card (accent border + tinted icon) + its editable table. */
  const renderSection = (g: ParameterGroup) => {
    const s = styleForSection(g.category);
    const SectionIcon = s.icon;
    const changed = g.params.filter((p) => p.edited).length;
    const rows: Row[] = g.params.map((p) => ({
      ...p,
      singleDraft: singleEdits[p.key],
      rangeDraft: rangeEdits[p.key],
    }));
    return (
      <Card className="overflow-hidden" style={{ borderLeft: `3px solid ${s.accent}` }}>
        <CardHeader>
          <div className="flex items-center gap-2.5">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-lg"
              style={{ background: s.tint }}
            >
              <SectionIcon size={18} weight="duotone" style={{ color: s.accent }} />
            </span>
            <div className="flex flex-col">
              <h3 className="text-[15px] font-semibold leading-tight" style={{ color: s.accent }}>
                {sectionDisplayName(g.category)}
              </h3>
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {g.params.length} parameter{g.params.length === 1 ? "" : "s"}
                {changed > 0 ? ` · ${changed} changed` : ""}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable<Row> columns={columns} data={rows} rowKey={(r) => r.key} rowHeight="auto" />
        </CardContent>
      </Card>
    );
  };

  if (!data) {
    return <p style={{ color: "var(--text-secondary)" }}>Loading parameters…</p>;
  }

  const groups = data.groups;
  const active = groups.find((g) => g.category === activeSection) ?? groups[0];
  const sectionTabs: TabItem[] = groups.map((g) => {
    const st = styleForSection(g.category);
    return {
      id: g.category,
      label: sectionDisplayName(g.category),
      icon: st.icon,
      badge: g.params.length,
    };
  });

  return (
    <div className="flex flex-col gap-4 pb-24">
      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        Numeric dials are editable — saved to the parameter store and applied on the engine&apos;s next
        run. Structural parameters (OEM definition, engineered segments, savings-rate policy) are
        read-only.
      </p>

      {banner && (
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px]"
          style={
            banner.kind === "ok"
              ? { background: "#EAF7EF", color: "var(--success)" }
              : { background: "#FDECEC", color: "var(--destructive)" }
          }
        >
          {banner.kind === "ok" ? (
            <CheckCircle size={15} weight="fill" />
          ) : (
            <WarningCircle size={15} weight="fill" />
          )}
          <span>{banner.text}</span>
        </div>
      )}

      <Tabs
        tabs={sectionTabs}
        activeTab={active?.category}
        onChange={setActiveSection}
        variant="underline-pill"
      />

      {active && renderSection(active)}

      {(pending.length > 0 || hasInvalid) && (
        <div
          className="fixed bottom-0 left-0 right-0 z-20 flex items-center justify-between gap-4 border-t bg-white px-6 py-3"
          style={{ borderColor: "var(--border)", boxShadow: "0 -2px 12px rgba(0,0,0,0.06)" }}
        >
          <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {hasInvalid ? (
              <span style={{ color: "var(--destructive)" }}>Fix invalid values to save.</span>
            ) : (
              <>
                <strong style={{ color: "var(--text-primary)" }}>{pending.length}</strong> unsaved
                change{pending.length === 1 ? "" : "s"} — applied on the engine&apos;s next run.
              </>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={discard} disabled={saving}>
              Discard
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={save}
              disabled={saving || hasInvalid || pending.length === 0}
            >
              {saving ? "Saving…" : `Save ${pending.length} change${pending.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
