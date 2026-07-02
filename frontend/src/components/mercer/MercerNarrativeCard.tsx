import Link from "next/link";
import { MercerStar } from "./MercerStar";

interface NarrativeChip {
  label: string;
  href: string;
}

interface MercerNarrativeCardProps {
  /** Card heading, e.g. "Mercer estate synthesis". */
  title: string;
  /** Dense Mercer narrative — mid-dot separators, concrete numbers. */
  paragraph: string;
  /** Focus chips linking into the app, rendered as small tiles. */
  chips?: NarrativeChip[];
}

/**
 * The Mercer narrative card — a lavender-wash gradient panel that leads the
 * dashboard. MercerStar 24px header, a dense synthesis paragraph, and a row
 * of focus-chip links styled as tiles.
 */
export function MercerNarrativeCard({ title, paragraph, chips }: MercerNarrativeCardProps) {
  return (
    <div
      className="mercer-fade-up flex flex-col gap-3 rounded-xl p-5"
      style={{
        background: "linear-gradient(147.68deg, #F5F0FF 4.74%, #FFFFFF 39.12%)",
        border: "1px solid var(--border-light)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <div className="flex items-center gap-2.5">
        <MercerStar size={24} />
        <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
          {title}
        </h2>
      </div>

      <p
        className="text-sm leading-relaxed"
        style={{ color: "var(--text-primary)" }}
      >
        {paragraph}
      </p>

      {chips && chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {chips.map((chip) => (
            <Link
              key={chip.href + chip.label}
              href={chip.href}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors hover:brightness-[0.98]"
              style={{
                background: "#F5EFFF",
                border: "1px solid #E3D2FF",
                color: "#59349C",
              }}
            >
              <MercerStar size={12} />
              {chip.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
