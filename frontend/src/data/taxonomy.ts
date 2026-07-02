/**
 * Navanta indirect taxonomy — the 10 L1 categories from the ALSN spend cube,
 * plus the MRO L2 list (the deepest level the demo drills into).
 */

export const L1_CATEGORIES = [
  "Corporate Services",
  "Facilities Management",
  "CAPEX",
  "MRO",
  "Logistics",
  "IT",
  "Cutting Tools",
  "Packaging",
  "Material Handling",
  "Travel",
] as const;

export type L1Category = (typeof L1_CATEGORIES)[number];

export const MRO_L2 = [
  "Bearings",
  "Chemicals",
  "Cleaning Supplies",
  "Consignment",
  "Electrical & Electronics",
  "Fasteners & Hardware",
  "Filters",
  "First Fill Oils",
  "Industrial Gas",
  "Industrial Supplies",
  "Integrated Supply",
  "Machine/Equipment Repairs Outsourced",
  "Metals & Plastics",
  "Office Supplies",
  "Power Transmission",
] as const;

export type MroL2 = (typeof MRO_L2)[number];
