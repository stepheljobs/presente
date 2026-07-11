# Product Brief — Presente
**Photo-proof attendance. Exact payroll.**
*Photo-verified attendance to payroll for small construction contractors*

Version 0.1 · July 2026 · Draft for review

---

## 1. The Problem

Small construction subcontractors (10–50 workers) lose a significant share of labor cost to **payroll padding**:

- **Ghost workers** — names on the payroll who never show up on site, split between a foreman and the "worker."
- **Buddy punching** — one worker signs the logbook (or taps a card) for absent friends.
- **Inflated hours** — workers logged as full-day when they left at noon; overtime claimed that never happened.
- **Unverifiable records** — paper logbooks and Excel timesheets can be rewritten after the fact, and the owner has no way to audit what actually happened on a site 40km away.

For a subcontractor paying 30 laborers ₱610–₱800/day, even 5–10% padding is tens of thousands of pesos per month — often invisible until the project margin evaporates.

Existing solutions fit poorly: biometric fingerprint terminals are fixed hardware that doesn't move between sites, gets damaged by dust and cement, and fails on worn fingerprints. Enterprise HRIS tools are priced and designed for offices, not muddy job sites with 40 rotating laborers and spotty signal.

## 2. The Solution

A mobile-first SaaS with two surfaces:

**Android app (field)** — The site engineer takes a **group photo** of the crew at time-in and time-out. The app automatically:
1. Recognizes and tags every enrolled worker's face in the photo
2. Stamps the photo with **GPS location** (validated against the project's geofence) and **server-verified time**
3. Works fully **offline** and syncs when signal returns

**Web dashboard (office)** — The admin/payroll officer sees live headcounts per site, reviews exceptions (unrecognized faces, missing time-outs, manual overrides), and at week's end runs a **gross payroll computation** — daily rates, halfdays, and overtime — built directly from the photo-verified attendance records. Export to CSV/PDF for payout via the contractor's existing channel (cash, GCash, bank).

Every attendance record traces back to an actual photograph with a face, a place, and a time. Padding requires faking all three.

## 3. Target Customer

**Primary (launch):** Philippine construction subcontractors and small general contractors with **10–50 field workers** across 1–5 active sites. Buyer is the **owner or operations manager**; daily users are the **site engineer** (capture) and **admin/payroll officer** (dashboard).

**Why this segment:** they feel padding pain most acutely (thin margins, owner personally absorbs losses), have no existing system to displace, and have short sales cycles — the owner can decide alone. Mid-size contractors (50–200) are the natural expansion segment.

## 4. Value Proposition

> "See who actually showed up. Pay only for hours actually worked. Run payroll in minutes, not a weekend."

- **Recover 5–10% of labor cost** by eliminating ghost workers and inflated hours
- **Cut payroll prep from a full day to under an hour** — attendance is already consolidated and computed
- **Audit trail for every peso** — each payslip line links to timestamped, geotagged photos
- **No hardware** — runs on the engineer's existing Android phone

## 5. Differentiation

| Alternative | Why we win |
|---|---|
| Paper logbook / Excel | Tamper-proof photo evidence; zero re-encoding |
| Fingerprint/RFID terminals | No hardware to buy, install, or break; moves between sites instantly |
| Selfie check-in apps (per-worker) | One group photo covers 20 workers in 10 seconds; workers don't need phones or literacy with apps |
| Enterprise HRIS (SAP, Sprout, etc.) | Priced and designed for 10–50-worker crews; field-first, offline-first |

## 6. Business Model

SaaS subscription, priced **per active worker per month** (indicative: ₱50–₱80/worker/month, minimum ~₱1,500/month). An active worker = anyone with at least one attendance record in the billing month, so contractors aren't charged for their inactive worker pool between projects. Payroll depth (statutory deductions, 13th month, payslip distribution) becomes a premium tier later.

## 7. Success Metrics (first 6 months post-launch)

- 20 paying contractors; 600+ active workers under management
- ≥95% of attendance records created via photo (vs. manual entry) — proxy for trust in recognition
- Face recognition auto-tag precision ≥98%, recall ≥90% in field conditions
- Weekly payroll run completed in <30 min median (self-reported)
- Logo churn <5%/month after month 2

## 8. Key Risks

1. **Face recognition in field conditions** — hard hats, backlighting, dust, similar-looking workers. Mitigation: multi-angle enrollment, confidence thresholds with human confirm, continuous model feedback.
2. **Engineer collusion** — the engineer photographs workers who then leave. Mitigation: time-in *and* time-out photos, optional random mid-day check prompts (Phase 2), owner-visible photo audit.
3. **Biometric privacy compliance** — face data is *sensitive personal information* under the PH Data Privacy Act (RA 10173). Mitigation: explicit written worker consent at enrollment, NPC registration, encryption at rest, retention policy, worker right-to-delete.
4. **Connectivity** — remote sites with no signal for days. Mitigation: offline-first architecture; all capture works locally, sync is eventual.
5. **Worker resistance** — perceived surveillance. Mitigation: position as proof of *their* hours (protects workers from being underpaid too); consent-first onboarding.

## 9. Out of Scope (v1)

Statutory deductions (SSS/PhilHealth/Pag-IBIG/tax), 13th-month computation, disbursement/e-wallet payout, iOS app, worker-facing self-service app, project scheduling and costing.

## 10. Open Decisions

- Trademark & domain clearance for "Presente" (IPOPHL search, DTI business name, presente.ph / getpresente.com)
- Pricing validation (willingness-to-pay interviews)
- Face recognition build vs. buy (e.g., AWS Rekognition / on-device model) — see PRD §7
- OT policy defaults vs. per-contractor configuration depth
