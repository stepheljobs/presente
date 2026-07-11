# PRD — Presente v1 (MVP)
**Photo-verified attendance → gross payroll for construction subcontractors**

Version 0.1 · July 2026 · Status: Draft

---

## 1. Overview & Goals

Multi-tenant SaaS. An Android app lets a site engineer capture group photos at time-in and time-out; the system auto-tags enrolled workers via face recognition, attaches GPS + timestamp, and consolidates records into a weekly gross-pay computation reviewed and exported from a web dashboard.

**v1 goals**
1. Make padding structurally hard: every paid hour traces to a photo with a face, place, and time.
2. Reduce weekly payroll preparation to under 30 minutes.
3. Work reliably on low-end Android phones at sites with intermittent or no connectivity.

**Non-goals (v1):** statutory deductions and net pay, money movement, iOS, worker self-service app, scheduling/costing, multi-language beyond English + Tagalog UI strings.

## 2. Personas

| Persona | Role | Device | Key needs |
|---|---|---|---|
| **Site Engineer** (field user) | Captures attendance for their assigned site(s) | Android phone, often offline | Fast capture (crew of 20 in <1 min), works without signal, easy fix when a face isn't recognized |
| **Admin / Payroll Officer** (office user) | Manages workers, reviews exceptions, runs payroll | Desktop browser | Trustworthy consolidated data, fast exception handling, clean exports |
| **Owner** | Buys the product, audits | Phone + desktop | Live visibility, proof against padding, cost recovery |
| **Worker** (subject, not a user) | Appears in photos, gets paid | None required | Fair, accurate pay; privacy and consent respected |

## 3. Roles & Permissions

| Capability | Owner | Admin | Engineer |
|---|---|---|---|
| Company settings, billing, OT rules | ✔ | — | — |
| Manage users (invite engineers/admins) | ✔ | ✔ | — |
| Enroll / edit / deactivate workers | ✔ | ✔ | Enroll only (flagged for admin approval) |
| Manage projects/sites & geofences | ✔ | ✔ | — |
| Capture attendance photos | ✔ | ✔ | ✔ (assigned sites only) |
| Edit/override attendance records | ✔ | ✔ (audited) | Request correction only |
| Run, adjust, approve, export payroll | ✔ | ✔ (approve may be Owner-only, configurable) | — |
| View payroll amounts | ✔ | ✔ | ✖ (sees attendance only) |

All tenants are fully isolated (multi-tenant row-level isolation).

## 4. Functional Requirements

### 4.1 Tenant & account setup
- FR-1: Contractor signs up (company name, email, phone); email/OTP verification; creates Owner account.
- FR-2: Owner invites Admins and Engineers by SMS/email link; invitees set password and land in role-appropriate surface.
- FR-3: Company settings: work week definition, standard workday length (default 8h), OT multiplier (default 125%), grace periods (late threshold, default 15 min), halfday cutoff rule, payroll week boundary (e.g., Mon–Sun, paid Saturday).

### 4.2 Projects & sites
- FR-4: Create project/site with name, client, address, and a **geofence** (map pin + radius, default 150 m, adjustable 50–1,000 m).
- FR-5: Assign engineers and a worker roster to each site. A worker can be on multiple rosters; an attendance day binds to exactly one site unless a transfer is recorded (see FR-23).
- FR-6: Archive completed sites; historical records remain queryable.

### 4.3 Worker enrollment
- FR-7: Worker profile: full name, nickname, photo, position/trade, **daily rate**, phone (optional), government ID number (optional, encrypted), start date, assigned site(s).
- FR-8: **Face enrollment**: 3–5 guided photos (front, slight left/right, with hard hat on) captured in-app; system generates and stores a face template. Quality gate rejects blurry/backlit enrollment shots with retake prompts.
- FR-9: **Consent capture**: before enrollment, the app displays a plain-language (English/Tagalog) consent notice covering biometric processing under RA 10173; worker signs on screen or thumbprints a printed form that is photographed and attached. Enrollment is blocked without recorded consent.
- FR-10: Deactivate worker (end date); face template retained for a configurable retention window (default 12 months) then purged; worker or contractor may request earlier deletion.
- FR-11: Bulk import worker names/rates via CSV; face enrollment still done in person per worker.

### 4.4 Attendance capture (Android app)
- FR-12: Engineer selects site (defaults to nearest assigned site by GPS) and session type: **Time In**, **Time Out**.
- FR-13: **Group photo capture**: engineer takes 1–N photos per session (large crews need multiple frames). Live overlay shows detected-face count before shutter.
- FR-14: On-device or queued-cloud **face matching** against the site roster (and company roster as fallback). Each match ≥ high-confidence threshold is auto-tagged; matches in a medium band are shown to the engineer as "Confirm: is this Juan D.?"; below threshold → unrecognized.
- FR-15: **Manual tagging fallback (mobile)**: for any unrecognized or pending-recognition face, the engineer can (a) manually tag from roster — record is flagged `manual_tag` and surfaces in admin exceptions; (b) mark as visitor/non-worker; (c) trigger quick enrollment for a genuinely new hire (pending admin approval). Manual tagging is always available, including fully offline, so recognition downtime never blocks attendance.
- FR-15b: **Manual tagging fallback (admin dashboard)**: admin can open any synced session photo in the dashboard and (a) tag unrecognized faces from the company roster, (b) correct a wrong auto-tag or engineer tag, (c) untag a face. Each action requires a reason note, is written to the audit log, and marks the resulting record `manual_tag_admin`. When cloud recognition later processes a photo that already carries manual tags, agreements are auto-confirmed and disagreements raise a review exception rather than silently overwriting.
- FR-16: Each session records: photo(s), tagged worker list, device GPS fix, geofence pass/fail, device time **and** trusted time (server time on sync; device-time-only records are flagged), engineer identity, device ID.
- FR-17: **Geofence violation** (photo outside radius) does not block capture — construction reality — but flags the session for admin review.
- FR-18: **Anti-tamper minimums**: photos must come from the in-app camera (no gallery import); EXIF and capture pipeline are controlled; mock-location detection flags the session; photo hash stored server-side.
- FR-19: A worker tagged at time-in but absent from all time-out photos → **missing time-out** exception; a worker in time-out but not time-in → **missing time-in** exception.
- FR-20: Duplicate protection: the same worker cannot be time-in tagged twice on the same day at the same site; second occurrence is ignored with a notice.

### 4.5 Offline behavior
- FR-21: All capture functions (photo, local face match if on-device model is used, tagging, session save) work with **zero connectivity**. Sessions queue locally, encrypted at rest.
- FR-22: Auto-sync on connectivity; visible queue status ("3 sessions pending sync"); conflict rule: server merges by session UUID; admin edits always win over late-arriving duplicates, with both preserved in the audit log.

### 4.6 Attendance records & corrections
- FR-23: Day record per worker per date: site, time-in, time-out, computed hours, status (Present / Halfday / Absent / OT), source (photo / manual / corrected), links to source photos. Mid-day site transfer: engineer at the receiving site captures the worker; system splits the day across sites with admin visibility.
- FR-24: Admin can edit any record (change times, mark halfday, excuse absence) — every edit requires a reason note and is written to an immutable **audit log** (who, what, when, before/after).
- FR-25: Engineer can submit a correction request with note + optional photo; admin approves/rejects.

### 4.7 Gross pay computation
- FR-26: Weekly payroll run per company payroll week. For each worker: `days_present × daily_rate + halfdays × 0.5 × daily_rate + OT_hours × hourly_equivalent × OT_multiplier`, where `hourly_equivalent = daily_rate / standard_hours`. Rules (rounding, late deductions from grace threshold, halfday cutoff) come from company settings.
- FR-27: OT hours = hours beyond standard workday, computed from photo-verified in/out, **only if** the site or worker is OT-eligible (per-site toggle) — prevents accidental OT from an engineer's late time-out photo. Manual OT adjustments allowed, audited.
- FR-28: Payroll run states: **Draft → Reviewed → Approved → Exported**. A run cannot be approved while unresolved blocking exceptions exist (missing time-out on a paid day, unapproved manual tags), unless the admin explicitly resolves or waives each with a note.
- FR-29: Adjustments line per worker (cash advance deduction as a simple negative line, allowance as positive) — free-form, not statutory.
- FR-30: Exports: payroll register **CSV/XLSX**, printable **PDF payroll sheet** with signature column, and per-worker payslip PDF (gross, days, OT, adjustments). Every line links (in-app) to its source day records and photos.
- FR-31: Approved runs are immutable; corrections after approval create a next-period adjustment entry.

### 4.8 Dashboard (web)
- FR-32: **Today view**: per-site headcount (tagged-in vs roster), live photo feed, geofence flags, sync status per engineer device.
- FR-33: **Exceptions queue**: missing time-out/in, manual tags pending approval, recognition-vs-manual-tag disagreements, geofence violations, mock-location flags, enrollment approvals, correction requests — each resolvable inline.
- FR-33b: **Photo tagging workspace**: any session photo opens in a tagging view (face boxes over the photo, roster search sidebar) where the admin exercises FR-15b — the same interaction pattern the engineer sees on mobile, so corrections feel consistent across surfaces.
- FR-34: **Reports**: attendance summary by worker/site/date range, OT report, exception trends, padding indicators (e.g., workers frequently manual-tagged, engineer whose sessions are always exactly on time).
- FR-35: **Payroll workspace**: run list, per-run review grid (worker × day matrix with drill-down to photos), approval, export history.

### 4.9 Notifications
- FR-36: Push/SMS-lite: engineer reminder if no time-in session by a configurable time; admin digest of exceptions; owner weekly summary (headcount, gross payroll total, exception count).

## 5. Non-Functional Requirements

- **NFR-1 Devices:** Android 8.0+, works acceptably on 2 GB RAM devices; app + queued data ≤ 500 MB typical.
- **NFR-2 Capture speed:** shutter-to-tagged-list ≤ 5 s for a 20-face photo (cloud path may defer tagging to sync; engineer sees "pending recognition" state).
- **NFR-3 Recognition quality bar (field conditions):** auto-tag precision ≥ 98% (wrong-person tags are the dangerous error), recall ≥ 90%; everything below high confidence routes to human confirm — never silent-wrong.
- **NFR-4 Offline:** 14 days of queued sessions without data loss; sync resumable over 2G-grade connections; images uploaded compressed (~200–400 KB) with originals hash-verified.
- **NFR-5 Privacy & compliance:** RA 10173 (Data Privacy Act) — face templates and ID numbers encrypted at rest (AES-256) and in transit (TLS 1.2+); biometric data processed only for attendance; per-tenant data isolation; NPC registration; data retention and deletion policy; worker consent records retained; no sale or secondary use of biometric data.
- **NFR-6 Auditability:** attendance and payroll mutations are append-only in the audit log; photos immutable with server-side hash.
- **NFR-7 Availability:** dashboard 99.5% monthly; field capture unaffected by backend outages (offline-first).
- **NFR-8 Localization:** UI in English and Tagalog; peso formatting; Asia/Manila timezone default, per-tenant configurable.

## 6. Edge Cases (must handle in v1)

1. Worker present in time-in, leaves early, absent at time-out → missing time-out exception; default pay = halfday pending admin resolution.
2. Worker arrives after time-in session → engineer captures an **additional time-in session**; latest-in/earliest-out logic per worker, all photos retained.
3. Hard hats, masks, backlight, rain → recognition degrades to confirm-band or unrecognized; manual tag path always available and always flagged.
4. Twins / strong lookalikes → recognition confidence collapses to confirm-band; admin can mark a "lookalike pair" requiring manual confirm permanently.
5. Engineer's phone lost/broken with unsynced sessions → engineer can re-capture from another logged-in device; lost sessions reported; local data encrypted so loss ≠ breach.
6. Device clock manipulation → trusted time reconciled at sync; large drift flags all sessions from that device.
7. Worker refuses biometric consent → contractor may keep them on **manual attendance** (engineer marks present with photo of the person optional but untagged); records carry a permanent `no_biometric_consent` marker and appear in exceptions weekly. (Product stance: supported but visibly costly, preserving the padding-proof value.)
8. Two engineers capture the same site/session → sessions merge by worker; duplicates deduplicated per FR-20.
9. Payroll week with a site handover mid-week → per-day site attribution already handles cost allocation.

## 7. Key Technical Decisions (recommendations, to validate)

- **Face recognition (DECIDED):** managed cloud service (e.g., AWS Rekognition or equivalent), with recognition executed at sync time. Offline captures show a "pending recognition" state until synced (FR-14); the engineer can manually tag any face in the meantime, and cloud recognition reconciles on sync (agreement confirms the tag; disagreement raises an exception). On-device model deferred to Phase 2 evaluation.
- **Stack (DECIDED 2026-07-11, supersedes the indicative Kotlin choice):** Mobile app in **Expo / React Native** (dev-client workflow — SQLCipher and camera frame processors need a dev build, not Expo Go); NestJS (TypeScript) API; React + Vite dashboard SPA; multi-tenant Postgres with row-level security; S3-compatible object storage (Hetzner) for photos; queue-based sync API (idempotent by session UUID). Rationale: one TypeScript stack across API/web/mobile; camera face-count overlay via react-native-vision-camera + ML Kit; small native modules accepted where WorkManager-grade background sync or device APIs demand them. Revisit native Kotlin only if low-end (2 GB RAM) device performance proves inadequate in Alpha field testing.
- **Trusted time:** record device time + monotonic clock; stamp server receive-time at sync; flag drift > 10 min.

## 8. Analytics & Success Metrics

Instrument: sessions captured/synced, auto-tag vs confirm vs manual rates, exception volumes and resolution time, payroll run duration (draft→approved), export counts, WAU by role. Targets per Product Brief §7.

## 9. Release Plan

- **Alpha (internal/design partner, ~6 wks):** enrollment, time-in/out capture with cloud recognition at sync, basic day records, CSV export. One design-partner contractor.
- **Beta (3 design partners, ~6 wks):** exceptions queue, payroll computation + approval flow, PDF exports, offline hardening, Tagalog UI.
- **v1 GA:** billing, onboarding self-serve, notifications, reports, NPC compliance package complete.

## 10. Open Questions

0. Brand name DECIDED: **Presente** (formerly Labortrack). Pending: IPOPHL trademark search, DTI business-name check, domain acquisition.
1. Should Approve on payroll be Owner-only by default? (Current: configurable, default Admin.)
2. Halfday rule default — cutoff time vs. hours-worked threshold?
3. Late/undertime deduction in v1 or v1.1? (Currently: grace-threshold late deduction in settings, simple.)
4. Cash advance tracking as a ledger vs. simple per-run negative line? (v1: simple line.)
5. Design-partner pricing and pilot terms.
