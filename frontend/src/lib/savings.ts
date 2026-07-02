import type { Opportunity, OppUserInput } from "@/types/opportunity";

/**
 * Savings resolution — the single derivation the savings waterfall, the
 * summary "Savings" tile and the commit action all read from, so the number a
 * user commits always traces back to their own input rather than the workbook
 * baseline.
 *
 * The workbook seeds an addressable base and a conservative–stretch savings
 * band (savingsLow/savingsHigh). A user can override the addressable dollars
 * and/or the conservative savings rate in the "Your Input" card. The stretch
 * rate tracks the override by preserving the workbook's modeled spread in
 * percentage points (e.g. a 3pt conservative→stretch band), so one override
 * field still produces an honest range.
 */
export interface SavingsResolution {
  /** Resolved addressable base (override if set, else workbook). */
  addressable: number;
  /** Applied conservative rate, %. */
  lowPct: number;
  /** Applied stretch rate, %. */
  highPct: number;
  /** Conservative dollar outcome. */
  low: number;
  /** Stretch dollar outcome. */
  high: number;
  overrodeAddressable: boolean;
  overrodeSavingsPct: boolean;
  /** "override" the moment either figure is overridden, else "workbook". */
  basis: "workbook" | "override";
  // Workbook baseline, kept for side-by-side "was" display in the waterfall.
  baseAddressable: number;
  baseLowPct: number;
  baseHighPct: number;
  baseLow: number;
  baseHigh: number;
}

function pctOf(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/**
 * Pure resolver — callable from a live draft (before save) as well as from a
 * persisted opportunity, so the input card can preview the effect of an
 * override without writing to the store.
 */
export function resolveSavingsValues(
  baseAddressable: number,
  baseLow: number,
  baseHigh: number,
  overrideAddressable: number | null | undefined,
  overrideSavingsPct: number | null | undefined,
): SavingsResolution {
  const baseLowPct = pctOf(baseLow, baseAddressable);
  const baseHighPct = pctOf(baseHigh, baseAddressable);
  const spreadPct = Math.max(0, baseHighPct - baseLowPct);

  const overrodeAddressable =
    overrideAddressable != null && Number.isFinite(overrideAddressable) && overrideAddressable > 0;
  const overrodeSavingsPct =
    overrideSavingsPct != null && Number.isFinite(overrideSavingsPct) && overrideSavingsPct > 0;

  const addressable = overrodeAddressable ? (overrideAddressable as number) : baseAddressable;
  const lowPct = overrodeSavingsPct ? (overrideSavingsPct as number) : baseLowPct;
  const highPct = overrodeSavingsPct ? lowPct + spreadPct : baseHighPct;

  // With no overrides, return the seed dollars verbatim so the waterfall lands
  // exactly on the workbook figures (no rounding drift off the % round-trip).
  const overridden = overrodeAddressable || overrodeSavingsPct;
  const low = overridden ? Math.round((addressable * lowPct) / 100) : baseLow;
  const high = overridden ? Math.round((addressable * highPct) / 100) : baseHigh;

  return {
    addressable,
    lowPct,
    highPct,
    low,
    high,
    overrodeAddressable,
    overrodeSavingsPct,
    basis: overridden ? "override" : "workbook",
    baseAddressable,
    baseLowPct,
    baseHighPct,
    baseLow,
    baseHigh,
  };
}

/** Resolve an opportunity's savings against its saved user input. */
export function resolveSavings(opp: Opportunity): SavingsResolution {
  const ui = opp.userInput;
  // "Addressable" everywhere in the UI = engine movable_value (contestable spend);
  // the fact-level addressable_value is intentionally not surfaced. Keep the savings
  // base on movable so the override math ties to the displayed Addressable figure.
  return resolveSavingsValues(
    opp.movableValue ?? opp.addressableSpend,
    opp.savingsLow,
    opp.savingsHigh,
    ui?.overrideAddressable ?? null,
    ui?.overrideSavingsPct ?? null,
  );
}

/** Resolve straight from a (possibly unsaved) input draft. */
export function resolveSavingsFromInput(
  opp: Opportunity,
  input: Pick<OppUserInput, "overrideAddressable" | "overrideSavingsPct">,
): SavingsResolution {
  return resolveSavingsValues(
    opp.movableValue ?? opp.addressableSpend,
    opp.savingsLow,
    opp.savingsHigh,
    input.overrideAddressable ?? null,
    input.overrideSavingsPct ?? null,
  );
}

export interface ParsedOverride {
  overrideAddressable: number | null;
  overrideSavingsPct: number | null;
  addressableValid: boolean;
  savingsPctValid: boolean;
}

/** Parse + validate the two override text fields. Blank → null (workbook). */
export function parseOverrideDraft(addressableText: string, savingsPctText: string): ParsedOverride {
  const addr = addressableText.trim();
  const addrNum = Number(addr);
  const addressableValid = addr === "" || (Number.isFinite(addrNum) && addrNum >= 0);

  const rate = savingsPctText.trim();
  const rateNum = Number(rate);
  const savingsPctValid = rate === "" || (Number.isFinite(rateNum) && rateNum >= 0 && rateNum <= 100);

  return {
    overrideAddressable: addr === "" ? null : Math.round(addrNum),
    overrideSavingsPct: rate === "" ? null : rateNum,
    addressableValid,
    savingsPctValid,
  };
}
