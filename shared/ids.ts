// Stable content IDs the app depends on (SPEC §7). These are keys, not wording:
// every label and definition for them comes from the content workbook.

export const GOAL_IDS = ['IPS', 'IMM', 'G1', 'G2', 'G3', 'G4', 'G7', 'OTH'] as const;

// Six sections of three, in display order. M1.04 (budget / MoF) was folded into M1.03.
export const READINESS_IDS = [
  'M1.01', 'M1.02', 'M1.03', // Strategy & investment
  'M1.06', 'M1.07', 'M1.08', // Governance
  'M1.14', 'M1.15', 'M1.17', // Legal & policy
  'M1.10', 'M1.11', 'M1.19', // Standards & interoperability
  'M1.12', 'M1.20', 'M1.21', // Terminology & testing
  'M1.22', 'M1.23', 'M1.24', // Capacity & sustainability
] as const;

export const FOUNDATION_IDS = ['CR', 'HFR', 'HWR', 'PR', 'LHR', 'TS', 'LIMR'] as const;
export const BUSINESS_IDS = ['CDSE', 'HMIS', 'PHSP', 'BPR', 'SR'] as const;
export const COMPONENT_IDS = [...FOUNDATION_IDS, ...BUSINESS_IDS] as const;

export const DPI_IDS = ['ID', 'TRUST', 'PAY', 'DX', 'CRVS', 'GEO'] as const;
export const INTEROP_IDS = ['HIE', 'CONS'] as const;
export const MAP_ENABLER_IDS = [...DPI_IDS, ...INTEROP_IDS] as const;

/** The 20 map blocks: 12 components + 8 enablers. */
export const BLOCK_IDS = [...COMPONENT_IDS, ...MAP_ENABLER_IDS] as const;

export const SHEET_ENABLER_IDS = ['EN1', 'EN2', 'EN3', 'EN4', 'EN5', 'EN6'] as const;
export const APP_IDS = ['APP1', 'APP2', 'APP3', 'APP4', 'APP5', 'APP6', 'APP7', 'APP8', 'APP9'] as const;
export const STANDARD_IDS = [
  'FHIR', 'IPS_STD', 'IHE', 'OPENEHR', 'SNOMED', 'ICD', 'LOINC', 'GS1', 'SMART', 'DICOM',
  'CDS_HOOKS', 'SMART_FHIR', 'IDMP_UDI', 'OIDC',
] as const;

// Components step: the reference architecture's Integrated View layers, without the
// goals, stakeholders, capabilities and cross-cutting governance rows. Each layer expands on its own.
export const EXTRA_BUSINESS_IDS = ['AIE', 'SECUSE'] as const;
export const TECH_IDS = ['TECH_CLOUD', 'TECH_AIML', 'TECH_SECOPS', 'TECH_DATA', 'TECH_OBS'] as const;

export interface ArchLayer {
  /** UI_Text key for the layer title (cp.layer.<key>) and its colour token. */
  key: 'apps' | 'business' | 'foundation' | 'interop' | 'dpi' | 'tech';
  color: string;
  /** Rows, optionally under sub-headings (UI_Text cp.group.<group>). */
  groups: { group?: string; ids: readonly string[] }[];
}

// Order agreed with the product lead: shared data first, then business services, then
// point-of-service applications; interoperability, DPI-F and technology after.
export const ARCH_LAYERS: readonly ArchLayer[] = [
  { key: 'foundation', color: 'foundation', groups: [{ ids: FOUNDATION_IDS }] },
  { key: 'business', color: 'business', groups: [{ ids: [...BUSINESS_IDS, ...EXTRA_BUSINESS_IDS] }] },
  { key: 'apps', color: 'apps', groups: [{ ids: APP_IDS }] },
  {
    key: 'interop', color: 'interop', groups: [
      { group: 'mediator', ids: ['HIE'] },
      { group: 'exchange', ids: ['FHIR', 'IHE', 'OPENEHR', 'IPS_STD'] },
      { group: 'terminology', ids: ['SNOMED', 'ICD', 'LOINC'] },
      { group: 'identifiers', ids: ['GS1', 'IDMP_UDI'] },
      { group: 'cds', ids: ['CDS_HOOKS', 'SMART_FHIR'] },
      { group: 'identity', ids: ['OIDC'] },
      { group: 'imaging', ids: ['DICOM'] },
    ],
  },
  { key: 'dpi', color: 'dpi', groups: [{ ids: DPI_IDS }] },
  { key: 'tech', color: 'dpi', groups: [{ ids: TECH_IDS }] },
];

/** Everything the Components step asks about (need, status, scope, note). */
export const ASSESS_IDS: readonly string[] = ARCH_LAYERS.flatMap((l) => l.groups.flatMap((g) => g.ids));
export const STATUS_IDS = ['E', 'P', 'A'] as const;
export const SCOPE_IDS = ['subnational', 'national', 'regional'] as const;
export const SUPPORT_IDS = ['TA', 'FUND', 'TRAIN', 'STD', 'POL', 'PEER'] as const;
export const LEAD_IDS = ['SPC', 'AeHIN', 'WHO', 'OTHER'] as const;

export const READINESS_VALUES = ['done', 'in_progress', 'not_yet'] as const;
export const NEED_VALUES = ['yes', 'no'] as const;

// Generic additions from the Bangkok policy-maker canvas (any use case).

/** "What we don't have yet": up to three gaps at the end of each of these steps. */
export const GAP_STEPS = ['readiness', 'components', 'map', 'governance'] as const;
export const GAP_ROWS = ['1', '2', '3'] as const;
export const GAP_URGENCY_IDS = ['GAP_NOW', 'GAP_12MO', 'GAP_WAIT'] as const;
export const GAP_PATTERN_IDS = ['NARROW', 'SHARED', 'BORROWED'] as const;

/** "Who decides": the four decisions, their formal basis, legal basis and levers. */
export const DECISION_IDS = ['DEC_ARCH', 'DEC_STD', 'DEC_CDS', 'DEC_TRUST'] as const;
export const BASIS_IDS = ['BASIS_LAW', 'BASIS_DECREE', 'BASIS_TWG', 'BASIS_NONE'] as const;
export const LEGAL_IDS = ['LEG_DATA', 'LEG_XBORDER', 'LEG_MINORS'] as const;
export const LEGAL_VALUES = ['yes', 'partly', 'no'] as const;
export const LEVER_IDS = ['LEV_PROC', 'LEV_TWG', 'LEV_FIN', 'LEV_REG', 'LEV_CERT'] as const;

/** Pathway: what the action costs, who could fund it, and the gap referred for follow-up. */
export const COST_IDS = ['COST_INTEG', 'COST_DEVICES', 'COST_TRAIN', 'COST_LICENCE', 'COST_RUN', 'COST_NOTONCE'] as const;
export const FUNDING_IDS = ['FUND_DOMESTIC', 'FUND_WB', 'FUND_ADB', 'FUND_DONOR', 'FUND_OTHER'] as const;
export const PARTNER_IDS = ['P_AEHIN', 'P_ADB', 'P_WB', 'P_WHO', 'P_SPC', 'P_OTHER'] as const;

/** Every Items ID the content workbook must contain, by category. */
export const REQUIRED_ITEM_IDS: Record<string, readonly string[]> = {
  goal: GOAL_IDS,
  readiness: READINESS_IDS,
  component: [...COMPONENT_IDS, ...EXTRA_BUSINESS_IDS],
  technology: TECH_IDS,
  enabler: MAP_ENABLER_IDS,
  enabler_sheet: SHEET_ENABLER_IDS,
  app_category: APP_IDS,
  standard: STANDARD_IDS,
  status: STATUS_IDS,
  scope: SCOPE_IDS,
  support: SUPPORT_IDS,
  lead: LEAD_IDS,
  gap_urgency: GAP_URGENCY_IDS,
  gap_pattern: GAP_PATTERN_IDS,
  decision: DECISION_IDS,
  basis: BASIS_IDS,
  legal: LEGAL_IDS,
  lever: LEVER_IDS,
  cost: COST_IDS,
  funding: FUNDING_IDS,
  partner: PARTNER_IDS,
};

// Who decides (governance) comes straight after Readiness, before the component steps.
export const STEP_KEYS = ['team', 'use_case', 'readiness', 'governance', 'components', 'map', 'pathway', 'summary'] as const;
export type StepKey = (typeof STEP_KEYS)[number];
