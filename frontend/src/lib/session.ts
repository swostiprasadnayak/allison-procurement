/**
 * The signed-in user — a single source of truth for the operator's identity so
 * decision attribution (committed entries, saved-input events) never hardcodes
 * a name inline. v1 has no auth; this stands in for the session principal and
 * is consumed by the Sidebar profile block and the opportunity store.
 *
 * `name` is typed as the literal the OppEvent / VendorEvent actor unions expect,
 * so it slots straight into audit events.
 */
export const CURRENT_USER = {
  name: "Maria Vance",
  role: "Commodity Manager · MRO",
  initials: "MV",
} as const;

export type CurrentUserName = typeof CURRENT_USER.name;
