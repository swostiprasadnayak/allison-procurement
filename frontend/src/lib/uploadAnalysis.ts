/**
 * Heuristic "Mercer analyzes your upload" pass — client-side text extraction,
 * not a live LLM call. The Act workspace's drafts are already deterministic
 * templates by design (see ActStep's outreachDraft/rfpDraft — "instant, no
 * live model call"); this extends the same philosophy to an uploaded/pasted
 * document: pull out likely requirements, commercial terms, and deadlines by
 * pattern, then (a) fold them into the RFP scaffold, or (b) match them
 * against the task checklist to auto-mark tasks the upload evidences as done.
 *
 * No file parsing beyond plain text (.txt/.md, or a pasted block) — PDFs/DOCX
 * would need a server-side parser, out of scope for this pass.
 */

export interface ExtractedSignals {
  /** Non-empty lines, cleaned of bullet markers — the raw material. */
  lines: string[];
  requirements: string[];
  terms: string[];
  deadlines: string[];
}

const REQUIREMENT_RE = /\b(must|shall|require[sd]?|need[s]?|mandatory|SLA|compliance|certif)/i;
const TERM_RE = /\b(net\s?\d{2}|payment terms|pricing|discount|rebate|rate card|incoterm)/i;
const DEADLINE_RE = /\b(by |due |deadline|no later than|Q[1-4]\s?\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i;

function cleanLine(line: string): string {
  return line.replace(/^[\s>*•\-\d.)]+/, "").trim();
}

/** Break a block of text into distinct clauses — first by line, then each
 *  line by sentence — so a single dense paragraph (no bullets/newlines)
 *  still yields separable signals instead of one giant multi-topic line. */
function toClauses(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .flatMap((line) => line.split(/(?<=[.;])\s+(?=[A-Z])/))
    .map(cleanLine)
    .filter((l) => l.length > 3);
}

export function extractSignals(raw: string): ExtractedSignals {
  const lines = toClauses(raw);

  // Each clause lands in exactly one bucket (deadline > term > requirement,
  // most-specific first) rather than every matching bucket — a clause that
  // happens to mention both "Net 45" and "by Q3" isn't duplicated three times.
  const requirements: string[] = [];
  const terms: string[] = [];
  const deadlines: string[] = [];
  for (const l of lines) {
    if (DEADLINE_RE.test(l)) deadlines.push(l);
    else if (TERM_RE.test(l)) terms.push(l);
    else if (REQUIREMENT_RE.test(l)) requirements.push(l);
  }

  return { lines, requirements, terms, deadlines };
}

/** Word-overlap score between a task label and a line of uploaded text —
 *  simple, explainable, no embeddings/model call. */
function overlapScore(a: string, b: string): number {
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let hits = 0;
  for (const w of wa) if (wb.has(w)) hits++;
  return hits / Math.min(wa.size, wb.size);
}

export interface TaskMatch {
  task: string;
  matchedLine: string;
  score: number;
}

/** Which open tasks the upload's content evidences as done — matched by word
 *  overlap against every line, keeping the strongest match per task. Threshold
 *  tuned to require real overlap (e.g. "Send RFP to shortlisted suppliers" vs.
 *  "RFP sent to all 5 shortlisted suppliers on Monday") without firing on
 *  coincidental single-word hits. */
export function matchTasksFromUpload(openTasks: string[], signals: ExtractedSignals): TaskMatch[] {
  const matches: TaskMatch[] = [];
  for (const task of openTasks) {
    let best: TaskMatch | null = null;
    for (const line of signals.lines) {
      const score = overlapScore(task, line);
      if (score >= 0.5 && (!best || score > best.score)) {
        best = { task, matchedLine: line, score };
      }
    }
    if (best) matches.push(best);
  }
  return matches;
}

/** Fold extracted requirements/terms/deadlines into the RFP scaffold under a
 *  clearly-labeled section — additive, never silently rewrites the base draft. */
export function upgradeRfpDraft(baseDraft: string, signals: ExtractedSignals): string {
  const section = (title: string, items: string[]) =>
    items.length ? `${title}\n${items.map((i) => `- ${i}`).join("\n")}` : null;

  const blocks = [
    section("Additional requirements (from your attachment)", signals.requirements),
    section("Commercial terms noted", signals.terms),
    section("Dates / deadlines flagged", signals.deadlines),
  ].filter((b): b is string => b !== null);

  if (blocks.length === 0) {
    return `${baseDraft}\n\n[Mercer scanned the attachment but found no clear requirements, terms, or deadlines to add — review it manually and add details above.]`;
  }

  return `${baseDraft}\n\n---\nMercer-extracted from your attachment (review before issuing):\n\n${blocks.join("\n\n")}`;
}
