@AGENTS.md

## UI — always use the design system

All UI is built on `@navanta-ai/design-system` (the `navanta-app-design` skill is the source of truth). **Never hand-roll a `<button>` for an action/CTA — always use the DS `Button`.** Pick the variant by role:

- **Primary CTA** → `variant="primary"` (dark). AI / Mercer action → `variant="christy"`.
- **Secondary / Cancel / Dismiss / Back** → `variant="outline"`. This is the Navanta **SecondaryButton** (white background + border). Do **not** use `variant="secondary"` for this — that variant is a solid grey fill and is *not* the design-system secondary button.
- Icon-only → `IconButton`.

Same rule for every other element: reach for the DS component (`Pill`, `TableShell`, `DataTable`, `Tabs`, `Modal`/`ModalShell`, inputs, etc.) before writing custom markup. Custom JSX is only for genuinely non-DS pieces (e.g. selectable cards, toggles) — and even then, use DS tokens, never ad-hoc hex.
