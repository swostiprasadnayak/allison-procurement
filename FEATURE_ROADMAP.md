# Navanta Lens — Feature Feedback & Implementation Roadmap

**Status**: Feedback collected from design audit + UX prototyping (July 2026)  
**Owner**: Product  
**Target**: Next deployment cycle  

---

## Overview

This document consolidates all UX feedback, validated issues, and feature gaps identified during the User Experience Audit and Prototype development. Each feature includes:
- **What**: The problem or gap
- **Why**: Operational impact / persona need
- **How**: Implementation approach
- **Where**: Code location(s) to modify
- **Priority**: P0 (blocks workflow) / P1 (improves efficiency) / P2 (polish)

---

## 🔴 P0 — Workflow Blockers

### 1. New Supplier / New BU Notification System

**What**  
CM has no way to know when a new supplier is added to their category or when a new BU is added to their scope. They discover it only by accident when scanning the Feed.

**Operational Impact (J1: Daily Triage)**  
"Triage new opportunities" use case (daily) requires knowing *why* each row is new — is it a new supplier, a price signal, or just an engine re-run? Without this, the CM spends time chasing false positives.

**Where It Lives**  
- Feed page: `frontend/src/app/(portal)/opportunities/page.tsx`
- Opportunity columns: `frontend/src/app/(portal)/opportunities/_components/opportunityColumns.tsx`
- Opportunity type: `frontend/src/types/opportunity.ts`

**Implementation**

1. **Add signal metadata to Opportunity type**
   ```typescript
   // frontend/src/types/opportunity.ts
   
   export type SignalKind =
     | "new-supplier"      // vendor added to category
     | "new-bu"            // BU added to CM's scope
     | "engine-rerun"      // re-run with same parameters
     | "drift"             // data changed on existing opp
     | "price-alert"       // supplier terms/pricing changed
     | "other";
   
   export interface OpportunitySignal {
     kind: SignalKind;
     label: string;        // "Supplier added", "BU scope expanded"
     detail: string;       // "VEN-1847 (MRO distributor, India) now in Industrial Supplies"
     vendorId?: string;    // if kind = new-supplier
     vendorName?: string;
     vendorType?: VendorType;
     buName?: string;      // if kind = new-bu
     newVendorCount?: number;  // total vendors added if kind = new-supplier
   }
   
   export interface Opportunity {
     // ... existing fields ...
     signal?: OpportunitySignal;
     isNew?: boolean;  // true if signal.kind is new-supplier, new-bu, or recent "surfaced" event
   }
   ```

2. **Add "Scope Update" alert banner**
   ```typescript
   // frontend/src/app/(portal)/opportunities/page.tsx → top of layout
   
   const scopeUpdates = opportunities
     .filter(o => o.signal?.kind === 'new-bu')
     .reduce((acc, o) => {
       const bu = o.signal!.buName!;
       if (!acc[bu]) acc[bu] = { newSuppliers: 0, newOpps: 0 };
       acc[bu].newOpps++;
       if (o.signal.vendorId) acc[bu].newSuppliers++;
       return acc;
     }, {} as Record<string, {newSuppliers: number, newOpps: number}>);
   
   if (Object.keys(scopeUpdates).length > 0) {
     return <AlertBanner variant="info">
       Scope update: {Object.entries(scopeUpdates)
         .map(([bu, counts]) => 
           `"${bu}" added (${counts.newSuppliers} suppliers, ${counts.newOpps} opps)`)
         .join('; ')}
       <Button variant="outline" size="sm">Review</Button>
     </AlertBanner>
   }
   ```

3. **Update Feed columns to show signal**
   ```typescript
   // frontend/src/app/(portal)/opportunities/_components/opportunityColumns.tsx
   
   // Add new column after the "Opportunity" name column
   {
     key: "signal",
     label: "Signal",
     width: 140,
     sortable: true,
     cell: (o) => {
       if (!o.signal) return null;
       const variantMap = {
         "new-supplier": "blue",
         "new-bu": "green",
         "engine-rerun": "gray",
         "drift": "amber",
         "price-alert": "red"
       };
       return (
         <Pill 
           variant={variantMap[o.signal.kind] as any}
           size="sm"
         >
           {o.signal.label}
         </Pill>
       );
     }
   }
   ```

4. **Add inline explainer row** (below each new-supplier row in the table)
   ```typescript
   // In the Feed component's row rendering
   
   if (o.signal?.kind === 'new-supplier') {
     return <>
       <TableRow>
         {/* existing cells */}
         <TableCell colSpan={1}>{signal badge}</TableCell>
       </TableRow>
       <TableRow className="bg-blue-50 border-l-4 border-blue">
         <TableCell colSpan="all" className="py-2 px-4 text-sm text-ink-3">
           <span className="font-semibold">{o.signal.vendorName}</span> 
           ({o.signal.vendorType}) now supplies this category.
           {o.signal.newVendorCount! > 1 && 
             ` ${o.signal.newVendorCount - 1} other new suppliers in this category.`}
         </TableCell>
       </TableRow>
     </>
   }
   ```

**Backend Work**  
Engine must compute `signal` on each Opportunity:
- Compare this run's vendor list to previous run → detect new suppliers
- Check CM's scope assignments → detect new-bu assignments
- Compare key fields (price, terms, lead-time) → drift detection

**Priority**: **P0** — blocks CM's daily triage; causes missed signals  
**Effort**: ~4–6 hours (type changes, column, banner, logic)

---

### 2. Ask Mercer Panel Repositioning

**What**  
Ask Mercer (AI copilot) is currently positioned at the bottom-right of the Qualify panel. In the J2 skeptic journey ("Prove it to me"), the CM wants to ask "Why a consolidation play?" *before* deciding to Accept/Park/Reject. The button is hard to find and too late in the flow.

**Operational Impact (J2: Trust Loop)**  
"Explain this number" and "Ask the copilot" steps require easy access to Mercer *during* qualification, not after deciding.

**Where It Lives**  
- Qualify modal: `frontend/src/app/(portal)/opportunities/_components/ReviewPanel.tsx` (line 847)
- Ask Mercer component: `frontend/src/components/mercer/AskMercerPanel.tsx`

**Implementation**

1. **Move Ask Mercer to left sidebar of Qualify panel** (above the three decision buttons)
   ```typescript
   // ReviewPanel.tsx — restructure the layout
   
   <div className="modal__footer">
     {/* Left side: Ask Mercer */}
     <div className="mercer-section">
       <AskMercerPanel 
         opportunity={opp}
         compact={true}
         placement="qualify"
       />
     </div>
     
     {/* Right side: Decision buttons */}
     <div className="decision-buttons">
       <Button variant="outline">Park</Button>
       <Button variant="outline" className="negative">Reject</Button>
       <Button variant="primary">Approve</Button>
     </div>
   </div>
   ```

2. **Update Ask Mercer component styling for "compact" placement**
   ```typescript
   // AskMercerPanel.tsx
   
   interface AskMercerPanelProps {
     opportunity: Opportunity;
     compact?: boolean;  // true = vertical stacking for left sidebar
     placement?: 'qualify' | 'act' | 'monitor';  // context hint
   }
   
   const classes = compact 
     ? 'flex flex-col gap-3 max-w-300px'
     : 'flex flex-row gap-4';
   ```

3. **CSS: Adjust modal layout to 3-column grid**
   ```css
   .modal__footer {
     display: grid;
     grid-template-columns: 300px 1fr 200px;
     gap: 20px;
     align-items: end;
   }
   .mercer-section { /* left */ }
   .evidence-section { /* center — existing */ }
   .decision-buttons { /* right */ display: flex; flex-direction: column; }
   ```

**Priority**: **P0** — J2 workflow is currently broken (Mercer is hard to find)  
**Effort**: ~2–3 hours (layout restructure, responsive testing)

---

### 3. Evidence-Analysis Loop in Act Step

**What**  
When the CM adds evidence or documents to the Play (e.g., "Quoted $12.50/unit, vs $18 baseline"), there's no AI-powered analysis. They manually write everything. The "drafts" (RFP, supplier outreach) are fully manual.

**Operational Impact (J1: Act Step 05)**  
"Launch playbook" should be: upload evidence → AI analyzes it → suggests RFP language / supplier outreach → CM edits → saves to versioned drafts. Currently it's: CM writes everything from scratch.

**Where It Lives**  
- Act step: `frontend/src/app/(portal)/opportunities/_components/ActStep.tsx`
- Drafts structure: `frontend/src/types/opportunity.ts` (Play.drafts)
- Evidence block: `frontend/src/app/(portal)/opportunities/_components/EvidenceBlock.tsx`

**Implementation**

1. **Extend Play.drafts to version support**
   ```typescript
   // frontend/src/types/opportunity.ts
   
   export interface DraftVersion {
     v: number;                // version 1, 2, 3...
     createdBy: string;        // 'Mercer' | 'CM-name'
     createdAt: string;        // ISO date
     text: string;             // the RFP / outreach body
     basis: string;            // which evidence triggered this version
     status: 'draft' | 'sent' | 'archived';
   }
   
   export interface PlayDrafts {
     rfp?: DraftVersion[];
     outreach?: DraftVersion[];  // supplier outreach
     statement_of_work?: DraftVersion[];
     activeVersion: Record<'rfp'|'outreach'|'statement_of_work', number>;  // current v to edit
   }
   
   export interface Play {
     // ... existing fields ...
     drafts: PlayDrafts;
     evidence: Array<{
       id: string;
       type: 'quote' | 'email' | 'doc' | 'note';  
       title: string;
       content: string;
       addedAt: string;
       analyzedAt?: string;
       mercer_insights?: string[];  // array of insights from analysis
     }>;
   }
   ```

2. **Add "Analyze & fold into drafts" button to Evidence Block**
   ```typescript
   // EvidenceBlock.tsx
   
   const [analyzing, setAnalyzing] = useState(false);
   
   const analyzeEvidence = async () => {
     setAnalyzing(true);
     try {
       // Call Mercer API to analyze this evidence
       const insights = await fetch('/api/opportunities/analyze-evidence', {
         method: 'POST',
         body: JSON.stringify({
           opportunityId: opp.id,
           evidence: newEvidence,  // the thing just added
           playId: play.id
         })
       }).then(r => r.json());
       
       // insights = {
       //   unit_price: "$12.50/unit sits below $18 blended baseline...",
       //   terms: "Net 45 is tighter than current Net 60 benchmark...",
       //   rfp_draft: "Supplier A can supply up to...",
       //   outreach_draft: "Given your recent quote...",
       // }
       
       // Create new draft versions
       const rfpV = pushDraftVersion(play, 'rfp', 'Mercer', 
         `Based on: ${newEvidence.title}`,
         insights.rfp_draft);
       const outV = pushDraftVersion(play, 'outreach', 'Mercer',
         `Based on: ${newEvidence.title}`,
         insights.outreach_draft);
       
       // Update the Play in state
       setPlay(prev => ({
         ...prev,
         evidence: [...prev.evidence, {...newEvidence, mercer_insights: insights}]
       }));
     } finally {
       setAnalyzing(false);
     }
   };
   
   return <div className="evidence-block">
     {/* evidence items */}
     <textarea 
       placeholder="Paste evidence here..."
       value={newEvNote}
       onChange={(e) => setNewEvNote(e.target.value)}
       data-in="act-docnote"
     />
     <Button
       onClick={analyzeEvidence}
       loading={analyzing}
       variant="christy"
     >
       {analyzing ? 'Analyzing...' : 'Analyze & fold into drafts'}
     </Button>
   </div>
   ```

3. **Add Draft Versions UI**
   ```typescript
   // In ActStep or a new DraftsPanel component
   
   <div className="drafts-panel">
     <Tabs defaultValue="rfp">
       <TabsList>
         <TabsTrigger value="rfp">RFP</TabsTrigger>
         <TabsTrigger value="outreach">Supplier Outreach</TabsTrigger>
       </TabsList>
       
       <TabsContent value="rfp">
         {/* Version selector */}
         <div className="version-selector">
           {play.drafts.rfp?.map(v => (
             <Button
               key={v.v}
               variant={play.drafts.activeVersion.rfp === v.v ? 'primary' : 'outline'}
               onClick={() => setActiveRfpV(v.v)}
               size="sm"
             >
               v{v.v} · {v.createdBy}
             </Button>
           ))}
         </div>
         
         {/* Active draft editor */}
         <textarea 
           value={activeDraft.text}
           onChange={handleEditDraft}
           data-in="draft-text"
         />
         <div className="actions">
           <Button variant="outline">Save as new version</Button>
           <Button variant="primary">Send / commit</Button>
         </div>
       </TabsContent>
     </Tabs>
   </div>
   ```

**Backend Work**  
Mercer API endpoint `/api/opportunities/analyze-evidence`:
- Extract evidence text
- Identify keywords (price, terms, lead-time, volume, capability)
- Generate RFP language + supplier outreach
- Return insights array

**Priority**: **P0** — J1 Act step 05; saves hours of manual RFP writing  
**Effort**: ~6–8 hours (types, UI, API integration, draft versioning)

---

### 4. Park → Direct-Decide Flow

**What**  
If a CM parks an opportunity but later changes their mind (before the next engine run), they must re-open it in Qualify and re-review everything. Should be able to go directly from Parked state to Accept/Reject.

**Operational Impact (Use Case: Respond to drift)**  
"Respond to drift on in-flight work" — if a parked play suddenly becomes attractive (supplier exits, price drops), the CM should approve it with one click, not re-qualify.

**Where It Lives**  
- Feed (parked rows): `frontend/src/app/(portal)/opportunities/page.tsx`
- Park dialog: `frontend/src/app/(portal)/opportunities/_components/ParkDialog.tsx`
- Parked view (if exists): check status filter in Feed

**Implementation**

1. **Add "quick action" buttons to parked rows in Feed**
   ```typescript
   // opportunityColumns.tsx or a new "rowActions" handler in Feed
   
   if (o.status === 'parked') {
     return <div className="quick-actions">
       <Button 
         variant="outline" 
         size="sm"
         onClick={() => handleQuickDecide(o.id, 'accept')}
       >
         Approve
       </Button>
       <Button 
         variant="outline" 
         size="sm"
         onClick={() => handleQuickDecide(o.id, 'reject')}
         className="negative"
       >
         Reject
       </Button>
     </div>
   }
   ```

2. **Implement quick-decide handler**
   ```typescript
   // page.tsx
   
   const handleQuickDecide = async (oppId: string, decision: 'accept' | 'reject') => {
     const opp = opportunities.find(o => o.id === oppId);
     if (!opp) return;
     
     // Show a lean confirmation dialog (not full re-qualify)
     const confirmed = await ConfirmDialog({
       title: `${decision === 'accept' ? 'Approve' : 'Reject'} parked opportunity?`,
       subtitle: opp.l3,
       message: `Park reason: ${opp.parkReason}\n\nYou can still override if evidence has changed.`,
       actions: [
         { label: 'Cancel', variant: 'outline' },
         { label: decision === 'accept' ? 'Approve' : 'Reject', variant: decision === 'accept' ? 'primary' : 'negative' }
       ]
     });
     
     if (!confirmed) return;
     
     // If accept, optionally show a "add override reason" textarea
     let reason = '';
     if (decision === 'accept') {
       reason = await PromptDialog({
         title: 'Why approve now? (optional)',
         placeholder: 'e.g., supplier terms improved, or new demand signal'
       });
     }
     
     // Fire the decision
     await updateOpportunityStatus({
       opportunityId: oppId,
       status: decision === 'accept' ? 'accepted' : 'rejected',
       reason: reason || opp.parkReason,
       override: true
     });
     
     // Refresh
     refetchOpportunities();
   };
   ```

3. **Update the Parked row styling**
   ```css
   .feed-row[data-status="parked"] {
     opacity: 0.85;  /* subtle visual dim */
   }
   .feed-row[data-status="parked"]:hover {
     opacity: 1;  /* brighten on hover */
     background: var(--bg-2);
   }
   .feed-row[data-status="parked"] .quick-actions {
     display: none;
   }
   .feed-row[data-status="parked"]:hover .quick-actions {
     display: flex;  /* show on hover */
     gap: 6px;
   }
   ```

**Priority**: **P0** — enables J1 "Respond to drift" use case  
**Effort**: ~2–3 hours (confirmation dialog, handler, styling)

---

### 5. Feed Decluttering & Grouping

**What**  
Feed is a flat list of all opportunities. CMs see 40+ rows and don't know where to start. No grouping by status, lever, or category.

**Operational Impact (J1: Daily Triage)**  
"Triage new opportunities" needs quick filtering/grouping to narrow the 40 items to "5 real ones I care about today."

**Where It Lives**  
- Feed table: `frontend/src/app/(portal)/opportunities/page.tsx`
- Table component: uses DataTable from DS

**Implementation**

1. **Add grouping controls to Feed header**
   ```typescript
   // page.tsx
   
   const [groupBy, setGroupBy] = useState<'status' | 'lever' | 'category' | 'none'>('status');
   
   const groupedOpps = useMemo(() => {
     if (groupBy === 'none') return [{ key: 'all', label: 'All', items: opportunities }];
     
     return Object.entries(
       opportunities.reduce((acc, o) => {
         const key = groupBy === 'status' ? o.status
                   : groupBy === 'lever' ? o.playRoute
                   : o.l1;
         if (!acc[key]) acc[key] = [];
         acc[key].push(o);
         return acc;
       }, {} as Record<string, Opportunity[]>)
     ).map(([key, items]) => ({ key, label: key, items }));
   }, [opportunities, groupBy]);
   
   return <>
     <div className="feed-controls">
       <div className="group-by">
         <label>Group by:</label>
         <Select value={groupBy} onChange={e => setGroupBy(e.target.value as any)}>
           <option value="none">None</option>
           <option value="status">Status</option>
           <option value="lever">Lever</option>
           <option value="category">Category (L1)</option>
         </Select>
       </div>
     </div>
     
     {/* Render grouped sections */}
     {groupedOpps.map(group => (
       <div key={group.key} className="feed-group">
         <div className="group-header">
           <h3>{group.label}</h3>
           <span className="count">{group.items.length}</span>
         </div>
         <DataTable columns={cols} data={group.items} />
       </div>
     ))}
   </>
   ```

2. **Add filter + bulk-action controls**
   ```typescript
   // Below the group-by selector
   
   const [filterLever, setFilterLever] = useState<string[]>([]);  // multi-select
   const [filterStatus, setFilterStatus] = useState<string[]>(['surfaced', 'qualified']);
   
   const filteredOpps = opportunities.filter(o => {
     if (filterStatus.length && !filterStatus.includes(o.status)) return false;
     if (filterLever.length && !filterLever.includes(o.playRoute)) return false;
     return true;
   });
   
   return <>
     <div className="feed-controls">
       <CheckboxGroup label="Status">
         {['surfaced', 'qualified', 'parked', 'accepted', 'rejected'].map(s => (
           <Checkbox
             key={s}
             checked={filterStatus.includes(s)}
             onChange={e => setFilterStatus(
               e.target.checked 
                 ? [...filterStatus, s]
                 : filterStatus.filter(x => x !== s)
             )}
           >
             {s}
           </Checkbox>
         ))}
       </CheckboxGroup>
       
       <CheckboxGroup label="Lever">
         {['Consolidate', 'Competitive RFP', 'Operating Model'].map(l => (
           <Checkbox
             key={l}
             checked={filterLever.includes(l)}
             onChange={e => setFilterLever(
               e.target.checked 
                 ? [...filterLever, l]
                 : filterLever.filter(x => x !== l)
             )}
           >
             {l}
           </Checkbox>
         ))}
       </CheckboxGroup>
       
       {/* Clear button */}
       {(filterStatus.length > 0 || filterLever.length > 0) && (
         <Button 
           variant="outline" 
           onClick={() => {
             setFilterStatus(['surfaced', 'qualified']);
             setFilterLever([]);
           }}
         >
           Clear filters
         </Button>
       )}
     </div>
   </>
   ```

3. **Bulk triage actions** (select multiple, then act)
   ```typescript
   const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
   
   const handleBulkAction = async (action: 'park' | 'dismiss' | 'read') => {
     const ids = Array.from(selectedIds);
     
     // If park/dismiss, ask for reason
     let reason = '';
     if (action !== 'read') {
       reason = await PromptDialog({
         title: `${action === 'park' ? 'Park' : 'Dismiss'} ${ids.length} opportunities`,
         label: 'Reason'
       });
       if (!reason) return;
     }
     
     // Batch update
     await updateOpportunitiesBatch({
       ids,
       status: action === 'park' ? 'parked' : action === 'dismiss' ? 'rejected' : 'qualified',
       reason
     });
     
     setSelectedIds(new Set());
     refetchOpportunities();
   };
   
   return <>
     {selectedIds.size > 0 && (
       <div className="bulk-actions-bar">
         <span>{selectedIds.size} selected</span>
         <Button variant="outline" onClick={() => handleBulkAction('read')}>Mark read</Button>
         <Button variant="outline" onClick={() => handleBulkAction('park')}>Park</Button>
         <Button variant="outline" negative onClick={() => handleBulkAction('dismiss')}>Dismiss</Button>
       </div>
     )}
   </>
   ```

**Priority**: **P0** — daily workflow bottleneck  
**Effort**: ~4–5 hours (grouping logic, filters, bulk handlers)

---

## 🟡 P1 — Efficiency Improvements

### 6. Opportunity Dashboard Card Clarity

**What**  
Dashboard shows "5 Top Opportunities" and other KPI cards, but it's unclear what "5" means and what information each card represents.

**Operational Impact**  
CM logs in, sees the Cockpit, and doesn't immediately understand the hierarchy or what action those cards demand.

**Where It Lives**  
- Cockpit / Dashboard: `frontend/src/app/(portal)/opportunities/_components/MorningBrief.tsx` (or similar)

**Implementation**

1. **Add explicit card titles + subtitles**
   ```typescript
   // MorningBrief.tsx (or Dashboard component)
   
   <Card title="Top 5 Opportunities (by Prize × Feasibility × Provability²)">
     <CardDescription>
       Highest-ranked opportunities from your last engine run, 
       filtered to your scope and category priorities.
     </CardDescription>
     {/* content */}
   </Card>
   
   <Card title="Fragmentation Index by L1 Category">
     <CardDescription>
       Spend concentration: green = consolidated (fewer suppliers), 
       red = fragmented (many suppliers). Wider bars = higher spend.
     </CardDescription>
     {/* bar chart */}
   </Card>
   ```

2. **Add a legend / key at the top of Cockpit**
   ```typescript
   <div className="cockpit-legend">
     <h3>How to read this dashboard</h3>
     <div className="legend-items">
       <div className="item">
         <span className="icon">📊</span>
         <span><b>Top 5 Opportunities</b> = your highest-impact plays, ranked by the engine</span>
       </div>
       <div className="item">
         <span className="icon">📈</span>
         <span><b>Category Momentum</b> = new suppliers, new BUs, price signals</span>
       </div>
       {/* etc */}
     </div>
   </div>
   ```

**Priority**: **P1** — polish, not a blocker  
**Effort**: ~1–2 hours (copy, legend UI)

---

### 7. Bulk Triage with Filter-Clear

**What** (see Feature #5 above)  
Part of Feed decluttering — bulk select, filter, and clear.

**Where It Lives**  
- Feed page: `frontend/src/app/(portal)/opportunities/page.tsx`

**Priority**: **P1** (part of Feed decluttering)  
**Effort**: ~3–4 hours (covered in #5)

---

### 8. Vendor Score Editing

**What**  
In the Vendor view, CMs should be able to override the "Data confidence" score (the composite of how complete our data is) if they know the vendor well.

**Operational Impact**  
CM knows a vendor's actual lead-time is 20 days (not the 14 in the system), and the score drops because of that gap. They should be able to mark "I know better" to elevate the confidence.

**Where It Lives**  
- Vendor detail: `frontend/src/app/(portal)/vendors/_components/` (if exists)
- Vendor store: `frontend/src/context/VendorStoreContext.tsx`

**Implementation**

```typescript
// Add an override field to Vendor type
export interface Vendor {
  // ... existing ...
  scoreOverride?: {
    value: number;  // 0–100
    reason: string;
    overriddenBy: string;
    at: string;
  };
}

// In the vendor detail UI
<div className="data-confidence">
  <div className="metric">
    <span className="label">Data confidence</span>
    <span className="value">{vendor.scoreOverride?.value ?? vendor.score}%</span>
    {vendor.scoreOverride && <Badge>CM override</Badge>}
  </div>
  
  <Button 
    onClick={() => setEditingScore(true)}
    variant="outline"
    size="sm"
  >
    Edit
  </Button>
  
  {editingScore && (
    <Dialog>
      <h3>Override data confidence</h3>
      <Slider min={0} max={100} value={newScore} onChange={setNewScore} />
      <textarea 
        placeholder="Why are you overriding? e.g., 'I work with this vendor daily, lead-time is actually 20d'"
        value={reason}
        onChange={e => setReason(e.target.value)}
      />
      <Button onClick={saveOverride}>Save</Button>
    </Dialog>
  )}
</div>
```

**Priority**: **P1** — improves trust in the system  
**Effort**: ~2–3 hours (field, UI, API)

---

## 🟢 P2 — Polish & Future

### 9. Drift Resolution UX

**What**  
When drift is flagged (price changed, terms shifted), the UI should guide the CM to decide: accept the new data, or override and hold the old assumption.

**Where It Lives**  
- Drift display in Qualify modal
- Monitor view (if drift is surfaced during tracking)

**Implementation** (sketch)
```typescript
// In ReviewPanel or Monitor, if drift is present
{drift && (
  <CalloutBox variant="warn" title={`Drift flagged: ${drift.note}`}>
    <p>Data on this opportunity has changed.</p>
    <div className="drift-options">
      <Button onClick={() => acceptDrift(opp.id)}>
        Accept new data
      </Button>
      <Button variant="outline" onClick={() => overrideDrift(opp.id)}>
        Override (keep old assumption)
      </Button>
    </div>
  </CalloutBox>
)}
```

**Priority**: **P2** — edge case, not daily  
**Effort**: ~2 hours

---

### 10. Methodology Dial Validation

**What**  
Category Lead (P3) can adjust parameters (e.g., `winner_share` threshold 0.50 → 0.55). The UI should validate the new value makes sense and warn if it's an outlier.

**Where It Lives**  
- Methodology page (if it exists): `frontend/src/app/(portal)/methodology/`

**Implementation** (sketch)
```typescript
const validateParameter = (param: string, newValue: number) => {
  const limits = PARAMETER_LIMITS[param];
  if (newValue < limits.min || newValue > limits.max) {
    return { isValid: false, error: `Must be between ${limits.min}–${limits.max}` };
  }
  
  // Check if it's a historical outlier
  const historical = versionHistory
    .filter(v => v.param === param)
    .map(v => v.value)
    .sort();
  
  const percentile = (historical.filter(v => v <= newValue).length / historical.length) * 100;
  
  if (percentile < 5 || percentile > 95) {
    return {
      isValid: true,
      warning: `This value is in the ${percentile}th percentile of historical edits — are you sure?`
    };
  }
  
  return { isValid: true };
};
```

**Priority**: **P2** — prevents accidental parameter drift  
**Effort**: ~2–3 hours

---

## Summary Table

| # | Feature | P | Owner | Effort | Status |
|---|---------|---|-------|--------|--------|
| 1 | New Supplier / BU Notifications | P0 | Backend + FE | 4–6h | Spec'd |
| 2 | Ask Mercer Repositioning | P0 | Frontend | 2–3h | Spec'd |
| 3 | Evidence-Analysis Loop | P0 | Backend + FE | 6–8h | Spec'd |
| 4 | Park → Direct-Decide | P0 | Frontend | 2–3h | Spec'd |
| 5 | Feed Decluttering & Grouping | P0 | Frontend | 4–5h | Spec'd |
| 6 | Dashboard Card Clarity | P1 | Frontend | 1–2h | Spec'd |
| 7 | Bulk Triage (part of #5) | P1 | Frontend | included | Spec'd |
| 8 | Vendor Score Editing | P1 | Backend + FE | 2–3h | Spec'd |
| 9 | Drift Resolution UX | P2 | Frontend | 2h | Sketch |
| 10 | Methodology Parameter Validation | P2 | Frontend | 2–3h | Sketch |

---

## Deployment Checklist

When deploying, follow this order:

1. ✅ **Phase 1 (P0 blockers)** — Consensus required before starting
   - [ ] Feature #1: Notifications (backend + FE)
   - [ ] Feature #2: Ask Mercer repositioning
   - [ ] Feature #3: Evidence-analysis loop
   - [ ] Feature #4: Park → direct-decide
   - [ ] Feature #5: Feed decluttering

2. ✅ **Phase 2 (Efficiency)** — Once P0 is live
   - [ ] Feature #6: Dashboard clarity
   - [ ] Feature #8: Vendor score editing

3. ✅ **Phase 3 (Polish)** — Future cycle
   - [ ] Feature #9: Drift resolution
   - [ ] Feature #10: Methodology validation

---

## Questions for Product / Engineering

- **Backend capacity**: Features #1 & #3 require new API endpoints. What's the resource availability?
- **Design system**: Are there new pill/badge variants needed (new-supplier, new-bu)?
- **Data scope**: For Feature #5 (Feed decluttering), how many opportunities do we expect in a typical CM's view? (Affects performance of grouping/filtering.)

---

**Document version**: 1.0  
**Last updated**: July 2, 2026  
**Next review**: Before Phase 1 deployment
