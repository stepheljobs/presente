# User Stories — Presente v1
**Atomic backlog · every story sized ≤ 2 hours of delivery work**

Version 0.1 · July 2026 · Companion to PRD v0.1 and User Flows v0.1

---

## How to read this backlog

- **Atomic** = one story, one deliverable, one review. Each story is independently mergeable and testable within a max of 2 hours by a competent developer familiar with the codebase.
- **ID format:** `E{epic}-S{number}`. Stories within an epic are roughly dependency-ordered.
- **Trace** links each story back to its source requirement (FR-x) or flow (Flow x).
- Stories marked **[BE]** backend, **[FE-W]** web dashboard, **[FE-A]** mobile app (Expo/React Native as of 2026-07-11 — PRD §7; originally Kotlin), **[INF]** infrastructure.
- Where a PRD requirement was too large for 2 hours, it has been split; the split is noted in the epic intro.
**Epic index**

| Epic | Name | Stories | Source |
|---|---|---|---|
| E0 | Platform foundations | 10 | (enables all) |
| E1 | Tenant & account setup | 10 | FR-1–3, Flow 1 |
| E2 | Projects & sites | 7 | FR-4–6 |
| E3 | Worker enrollment & consent | 14 | FR-7–11, Flows 2, 9 |
| E4 | Attendance capture (Android) | 21 | FR-12–20, Flows 3, 4 |
| E5 | Offline & sync | 9 | FR-21–22, Flow 5 |
| E6 | Day records & corrections | 8 | FR-23–25, Flow 8 |
| E7 | Gross payroll | 16 | FR-26–31, Flow 7 |
| E8 | Dashboard, exceptions & reports | 16 | FR-32–35, Flows 6, 10 |
| E9 | Notifications | 4 | FR-36 |
| | **Total** | **115** | |

---

## E0 — Platform Foundations

Not user-visible, but without these the "atomic" promise breaks — every later story would hide half a day of plumbing. Do these first.

**E0-S01 · [INF] Multi-tenant schema scaffold with row-level security**
As the platform, I enforce tenant isolation at the database layer so no query can cross tenants.
- AC: `tenants` table exists; RLS policy applied to a sample table; cross-tenant SELECT returns zero rows in test.
- Est: 2h · Deps: none · Trace: PRD §3, NFR-5
**E0-S02 · [BE] Password auth: hash, login endpoint, session token**
- AC: bcrypt/argon2 hashing; `POST /auth/login` returns JWT/session; invalid credentials rejected with generic error.
- Est: 2h · Deps: E0-S01
**E0-S03 · [BE] Role & permission middleware (Owner / Admin / Engineer)**
- AC: role stored per user; middleware rejects requests outside role matrix (PRD §3); unit tests for one allowed + one denied route per role.
- Est: 2h · Deps: E0-S02
**E0-S04 · [INF] Object storage bucket + signed upload URL endpoint**
- AC: per-tenant key prefix; `POST /uploads/sign` returns time-limited signed URL; direct unsigned PUT rejected.
- Est: 1.5h · Deps: E0-S01
**E0-S05 · [BE] Append-only audit log table + write helper**
- AC: `audit_log(actor, action, entity, before, after, reason, ts)`; no UPDATE/DELETE grants; helper used by one sample mutation.
- Est: 1.5h · Deps: E0-S01 · Trace: NFR-6
**E0-S06 · [BE] Idempotent session-ingest API skeleton (upsert by session UUID)**
- AC: `PUT /sessions/{uuid}` creates on first call, no-ops on identical retry; returns same result both times.
- Est: 2h · Deps: E0-S01 · Trace: PRD §7, FR-22
**E0-S07 · [FE-A] Android app shell: navigation scaffold + login screen**
- AC: login screen calls E0-S02; token stored securely (EncryptedSharedPreferences/Keystore); bottom-nav skeleton for Home/Workers/Attendance.
- Est: 2h · Deps: E0-S02
**E0-S08 · [FE-W] Dashboard SPA shell: routing + auth guard**
- AC: login page; authenticated routes redirect to login when token absent/expired; role read from token.
- Est: 2h · Deps: E0-S02
**E0-S09 · [FE-A] Encrypted local database on device**
- AC: SQLCipher (or equivalent) initialized with Keystore-derived key; sample record survives app restart; raw file unreadable.
- Est: 2h · Deps: E0-S07 · Trace: FR-21, Edge case 5
**E0-S10 · [BE] Trusted-time stamping on ingest**
- AC: server receive-time written to every ingested session; device time preserved separately; drift computed and stored.
- Est: 1h · Deps: E0-S06 · Trace: FR-16, PRD §7
---

## E1 — Tenant & Account Setup (FR-1–3, Flow 1)

**E1-S01 · [FE-W] Company sign-up form**
- AC: fields company name, email, phone with validation; submit calls sign-up API; error states rendered.
- Est: 1.5h · Deps: E0-S08 · Trace: FR-1
**E1-S02 · [BE] Sign-up API: create tenant + provisional Owner**
- AC: creates tenant row + owner user in `unverified` state; duplicate email returns friendly conflict.
- Est: 1.5h · Deps: E0-S01 · Trace: FR-1
**E1-S03 · [BE] OTP generation + email/SMS dispatch**
- AC: 6-digit OTP, 10-min expiry, rate-limited to 3 sends/hour; dispatch via provider abstraction (swap-able SMS/email gateway).
- Est: 2h · Deps: E1-S02 · Trace: FR-1
**E1-S04 · [FE-W + BE] OTP verification screen + activation endpoint**
- AC: correct OTP activates Owner and starts session; wrong OTP ≤5 attempts then lockout; expired OTP offers resend.
- Est: 2h · Deps: E1-S03 · Trace: FR-1
**E1-S05 · [BE] Invite model + email invite dispatch (Admin)**
- AC: invite record with role, token, 7-day expiry; email contains accept link; revocable by Owner.
- Est: 1.5h · Deps: E0-S03 · Trace: FR-2
**E1-S06 · [BE] SMS invite dispatch (Engineer)**
- AC: same invite model, SMS channel; link resolves on mobile; delivery failure surfaced to inviter.
- Est: 1h · Deps: E1-S05 · Trace: FR-2, Flow 1
**E1-S07 · [FE-W/FE-A] Invite acceptance: set password, land by role**
- AC: token validated; password set; Admin lands on dashboard, Engineer lands on app home with assigned sites; used token cannot be reused.
- Est: 2h · Deps: E1-S05, E0-S07, E0-S08 · Trace: FR-2
**E1-S08 · [BE] Company settings model + API**
- AC: work week, standard workday (default 8h), OT multiplier (default 125%), late grace (default 15 min), halfday rule, payroll week boundary; Owner-only write per role matrix.
- Est: 2h · Deps: E0-S03 · Trace: FR-3
**E1-S09 · [FE-W] Company settings form**
- AC: renders all E1-S08 fields with defaults pre-filled; validation (e.g., OT multiplier ≥ 100%); save + toast.
- Est: 2h · Deps: E1-S08 · Trace: FR-3
**E1-S10 · [FE-W] Setup wizard shell (4 steps, skippable)**
- AC: stepper wiring Settings → First site → Invites → CSV import; each step reuses its existing screen; progress persisted so wizard resumes.
- Est: 2h · Deps: E1-S09, E2-S02, E1-S05, E3-S13 · Trace: Flow 1
---

## E2 — Projects & Sites (FR-4–6)

**E2-S01 · [BE] Site model + CRUD API**
- AC: name, client, address, lat/lng, radius (50–1,000 m, default 150); tenant-scoped; archive flag.
- Est: 1.5h · Deps: E0-S03 · Trace: FR-4
**E2-S02 · [FE-W] Create/edit site with map pin + radius control**
- AC: draggable pin; radius slider clamped 50–1,000 m with circle preview; save calls E2-S01.
- Est: 2h · Deps: E2-S01 · Trace: FR-4, Flow 1
**E2-S03 · [BE+FE-W] Assign engineers to a site**
- AC: multi-select of tenant engineers; engineer sees only assigned sites in app (API filter proven by test).
- Est: 1.5h · Deps: E2-S01 · Trace: FR-5
**E2-S04 · [BE+FE-W] Assign worker roster to a site**
- AC: worker can belong to multiple rosters; roster list paginates ≥ 200 workers; add/remove audited.
- Est: 2h · Deps: E2-S01, E3-S01 · Trace: FR-5
**E2-S05 · [BE+FE-W] Archive site**
- AC: archived site hidden from capture pickers; historical records remain queryable in reports; unarchive supported.
- Est: 1h · Deps: E2-S01 · Trace: FR-6
**E2-S06 · [BE] Nearest-assigned-site resolver**
- AC: given device GPS, returns engineer's assigned sites sorted by distance; used by capture flow default.
- Est: 1h · Deps: E2-S03 · Trace: FR-12
**E2-S07 · [BE] Geofence evaluation function**
- AC: pure function (point, site) → pass/fail + distance; unit tests at boundary radius; reused by capture + exceptions.
- Est: 1h · Deps: E2-S01 · Trace: FR-16, FR-17
---

## E3 — Worker Enrollment & Consent (FR-7–11, Flows 2, 9)

Consent is deliberately split from profile and from face capture — each is a separate legal/UX artifact.

**E3-S01 · [BE] Worker profile model + API**
- AC: full name, nickname, photo ref, position, daily rate, phone (opt), gov ID (opt, AES-256 encrypted column), start date, site assignments; rate hidden from Engineer role responses.
- Est: 2h · Deps: E0-S03 · Trace: FR-7, NFR-5
**E3-S02 · [FE-A] Worker profile form (mobile)**
- AC: all FR-7 fields; rate field hidden when engineer lacks permission; draft persists offline.
- Est: 2h · Deps: E3-S01, E0-S09 · Trace: FR-7, Flow 2
**E3-S03 · [FE-A] Consent notice screen (English + Tagalog)**
- AC: plain-language RA 10173 biometric notice, language toggle; scroll-to-end before accept enabled; copy loaded from server config so counsel can revise without release.
- Est: 2h · Deps: E0-S07 · Trace: FR-9
**E3-S04 · [FE-A] On-screen signature capture**
- AC: signature pad; stroke data + rendered PNG stored with consent record; clear/retry.
- Est: 1.5h · Deps: E3-S03 · Trace: FR-9
**E3-S05 · [FE-A] Photographed paper-consent alternative**
- AC: in-app camera captures signed/thumbprinted paper form; attached to consent record; same downstream state as E3-S04.
- Est: 1h · Deps: E3-S03 · Trace: FR-9, Flow 2
**E3-S06 · [BE] Consent record model + enrollment gate**
- AC: consent record (worker, type, artifact ref, ts, engineer); face-enrollment API returns 403 without consent record; gate covered by test.
- Est: 1.5h · Deps: E3-S01 · Trace: FR-9
**E3-S07 · [FE-A] Guided face capture — 4-pose flow**
- AC: sequential prompts front → left → right → hard-hat; progress indicator; captures stored to local queue.
- Est: 2h · Deps: E3-S06, E0-S09 · Trace: FR-8, Flow 2
**E3-S08 · [FE-A] Enrollment-shot quality gate**
- AC: on-device blur + exposure heuristics; failing shot triggers retake prompt with reason ("Too blurry", "Backlit"); thresholds remotely tunable.
- Est: 2h · Deps: E3-S07 · Trace: FR-8
**E3-S09 · [BE] Face template generation on sync (cloud provider)**
- AC: enrollment photos sent to recognition provider; template/face-ID stored encrypted, keyed to worker; provider errors retried with backoff.
- Est: 2h · Deps: E3-S07, E0-S04 · Trace: FR-8, PRD §7
**E3-S10 · [BE+FE-W] Enrollment pending-approval state + admin approval card**
- AC: engineer-initiated enrollments enter `pending`; admin card shows profile + face shots; Approve sets/confirms rate and activates; Reject requires note; both audited.
- Est: 2h · Deps: E3-S09, E8-S04 · Trace: FR-15c/Flow 2, PRD §3
**E3-S11 · [BE+FE-W] Worker deactivation + retention timer**
- AC: end date set; worker leaves active rosters; retention countdown (default 12 months, tenant-configurable) starts for biometric data.
- Est: 1.5h · Deps: E3-S01 · Trace: FR-10, Flow 9
**E3-S12 · [BE+FE-W] Biometric deletion + deletion certificate**
- AC: purges face template + enrollment photos (provider-side delete verified); attendance/payroll rows retained; confirm dialog per Flow 9; certificate entry in audit log.
- Est: 2h · Deps: E3-S11 · Trace: FR-10, Flow 9, NFR-5
**E3-S13 · [BE] Worker CSV import parser + validation**
- AC: accepts name/rate/position columns; row-level error report (line, reason); dry-run mode; ≤ 500 rows.
- Est: 2h · Deps: E3-S01 · Trace: FR-11
**E3-S14 · [FE-W] CSV import UI**
- AC: upload, preview table, error rows highlighted, commit button disabled until zero blocking errors; success summary.
- Est: 1.5h · Deps: E3-S13 · Trace: FR-11, Flow 1
---

## E4 — Attendance Capture, Android (FR-12–20, Flows 3, 4)

The heart of the product. FR-14 and FR-15 are each split into several stories; the tagging screen alone is four.

**E4-S01 · [FE-A] Session start: site select with GPS pre-selection**
- AC: nearest assigned site pre-selected via E2-S06; manual override list; offline falls back to last-used site with "GPS unavailable" note.
- Est: 2h · Deps: E2-S06, E0-S09 · Trace: FR-12, Flow 3
**E4-S02 · [FE-A] Session type selection (Time In / Time Out)**
- AC: two-action home entry points; session object created locally with type, site, engineer, device ID.
- Est: 1h · Deps: E4-S01 · Trace: FR-12
**E4-S03 · [FE-A] In-app camera with live face-count overlay**
- AC: camera preview with on-device face detection count ("14 faces detected"); shutter disabled at 0 faces; gallery import impossible (no picker path).
- Est: 2h · Deps: E4-S02 · Trace: FR-13, FR-18
**E4-S04 · [FE-A] Multi-photo capture per session**
- AC: "Capture more" loop; thumbnails strip; per-photo delete before save; N photos bound to one session UUID.
- Est: 1.5h · Deps: E4-S03 · Trace: FR-13
**E4-S05 · [FE-A] GPS fix capture + geofence evaluation at capture**
- AC: best-effort GPS fix attached to session; pass/fail computed locally against cached site geofence; no-fix state recorded explicitly.
- Est: 2h · Deps: E4-S03, E2-S07 · Trace: FR-16
**E4-S06 · [FE-A] Geofence violation banner (non-blocking)**
- AC: out-of-radius shows distance banner ("You appear 900 m from site — session will be flagged"); capture proceeds; flag persisted on session.
- Est: 1h · Deps: E4-S05 · Trace: FR-17, Flow 3
**E4-S07 · [FE-A] Mock-location detection**
- AC: `isMockProvider` / dev-settings checks; positive result flags session (never blocks); flag survives sync.
- Est: 1.5h · Deps: E4-S05 · Trace: FR-18
**E4-S08 · [FE-A] Photo hashing at capture**
- AC: SHA-256 computed at write time, stored in session metadata; hash re-verified server-side on upload (mismatch → tamper flag).
- Est: 1.5h · Deps: E4-S04 · Trace: FR-18, NFR-4
**E4-S09 · [BE] Cloud recognition pass on synced photos**
- AC: each synced photo run against site roster templates, company roster fallback; per-face result {worker, confidence} persisted; provider failure leaves photo in `pending recognition` for retry.
- Est: 2h · Deps: E3-S09, E0-S06 · Trace: FR-14, PRD §7
**E4-S10 · [BE] Confidence banding logic**
- AC: results classified high / confirm-band / unrecognized via tenant-tunable thresholds; band drives downstream state; unit tests at both boundaries.
- Est: 1.5h · Deps: E4-S09 · Trace: FR-14, NFR-3
**E4-S11 · [FE-A] Tagging screen: auto-tagged chips**
- AC: high-confidence matches render as green confirmed chips with name + face crop; list scrolls for 20+ workers.
- Est: 2h · Deps: E4-S10 (or local pending state), E4-S04 · Trace: FR-14, Flow 3
**E4-S12 · [FE-A] Tagging screen: confirm-band cards**
- AC: "Is this Ramon T.?" card with photo crop vs enrollment photo; Yes / No / Pick other; answer recorded with band metadata.
- Est: 2h · Deps: E4-S11 · Trace: FR-14, Flow 3
**E4-S13 · [FE-A] Manual tag from roster (unrecognized face)**
- AC: red-boxed face opens roster search; selection creates record flagged `manual_tag`; works fully offline against cached roster.
- Est: 2h · Deps: E4-S11, E0-S09 · Trace: FR-15
**E4-S14 · [FE-A] Mark face as visitor / non-worker**
- AC: visitor mark stores face crop but no worker link; excluded from payroll; visible in session summary count.
- Est: 1h · Deps: E4-S11 · Trace: FR-15
**E4-S15 · [FE-A] Quick-enroll entry point from tagging screen**
- AC: launches Flow 2 short path pre-attached to current session; new hire lands in `pending admin approval`; session tag resolves once approved.
- Est: 1.5h · Deps: E4-S13, E3-S10 · Trace: FR-15, Flow 3
**E4-S16 · [FE-A] Session summary + save**
- AC: summary line (tagged / manual / visitor counts, geofence status, time); Save persists session to encrypted queue; sync state shown.
- Est: 1.5h · Deps: E4-S13, E4-S05 · Trace: Flow 3
**E4-S17 · [BE] Duplicate time-in protection**
- AC: second time-in tag for same worker/day/site ignored with notice metadata; earliest in-time retained; test with two sessions same morning.
- Est: 1.5h · Deps: E6-S01 · Trace: FR-20, Edge case 2 ⚠ see Open Notes
**E4-S18 · [FE-A] Time-out reconciliation strip**
- AC: on time-out tagging, list of workers timed-in but absent from photos; per worker: Capture again / Left early (note) / Leave as exception.
- Est: 2h · Deps: E4-S16, E6-S01 · Trace: FR-19, Flow 4
**E4-S19 · [BE] Missing time-out / time-in exception generation**
- AC: nightly + on-sync job creates exceptions per FR-19; deduplicates against engineer's "left early" notes; visible in queue.
- Est: 2h · Deps: E6-S01, E8-S04 · Trace: FR-19
**E4-S20 · [FE-A] Additional time-in session (late arrivals)**
- AC: repeat Time In flow creates a second session; per-worker earliest-in retained; all photos kept and linked.
- Est: 1h · Deps: E4-S17 · Trace: Edge case 2, Flow 3
**E4-S21 · [BE] Lookalike-pair marking**
- AC: admin can mark two workers as a lookalike pair; recognition results between them are forced to confirm-band permanently; audited.
- Est: 1.5h · Deps: E4-S10 · Trace: Edge case 4
---

## E5 — Offline & Sync (FR-21–22, Flow 5)

**E5-S01 · [FE-A] Encrypted offline session queue**
- AC: sessions + photos persist through kill/reboot; 14 days of typical volume within 500 MB budget (compression per E5-S04); queue survives app update.
- Est: 2h · Deps: E0-S09, E4-S16 · Trace: FR-21, NFR-1, NFR-4
**E5-S02 · [FE-A] Sync status pill (global)**
- AC: persistent pill on all engineer screens ("3 sessions pending sync"); tap opens queue detail; states: pending / uploading / synced / needs attention.
- Est: 1.5h · Deps: E5-S01 · Trace: FR-22, Flow 5
**E5-S03 · [FE-A] Background auto-sync on connectivity**
- AC: WorkManager job triggers on network regain; retries with exponential backoff; respects battery/doze constraints.
- Est: 2h · Deps: E5-S01, E0-S06 · Trace: FR-22
**E5-S04 · [FE-A] Compressed, resumable photo upload**
- AC: images compressed to ~200–400 KB; chunked/resumable over poor links; server verifies hash against E4-S08 value.
- Est: 2h · Deps: E5-S03, E0-S04 · Trace: NFR-4
**E5-S05 · [BE] Conflict rule: admin edits win, duplicates preserved**
- AC: late-arriving session touching an admin-edited worker-day keeps admin version; engineer version written to audit log; no silent overwrite (test proves both preserved).
- Est: 2h · Deps: E0-S06, E6-S04 · Trace: FR-22, Flow 5
**E5-S06 · [BE] Device clock-drift flagging**
- AC: drift > 10 min between device time and server receive-time flags all sessions from that device; admin exception created.
- Est: 1.5h · Deps: E0-S10, E8-S04 · Trace: PRD §7, Edge case 6
**E5-S07 · [FE-A] Pending-recognition state**
- AC: offline-captured faces show "pending recognition" chip until cloud pass completes; state clears on sync without user action.
- Est: 1h · Deps: E4-S09, E5-S03 · Trace: FR-14, PRD §7
**E5-S08 · [BE] Recognition-vs-manual-tag reconciliation**
- AC: cloud result agreeing with engineer/admin manual tag auto-confirms it; disagreement raises a review exception; never overwrites; both outcomes tested.
- Est: 2h · Deps: E4-S09, E4-S13 · Trace: FR-15b, Flow 6 item 4
**E5-S09 · [FE-A] Sync completion notification**
- AC: local notification "All sessions synced ✓" or "1 needs attention" deep-linking to the affected session.
- Est: 1h · Deps: E5-S03 · Trace: Flow 5
---

## E6 — Day Records & Corrections (FR-23–25, Flow 8)

**E6-S01 · [BE] Day-record computation job**
- AC: per worker/date/site: earliest-in, latest-out, computed hours, status (Present/Halfday/Absent/OT candidate), source, photo links; recomputes idempotently when a session arrives late.
- Est: 2h · Deps: E0-S06, E4-S09 · Trace: FR-23
**E6-S02 · [BE] Mid-day site transfer split**
- AC: worker captured at second site same day splits the day across sites; both segments visible; admin notified via exception-level visibility.
- Est: 2h · Deps: E6-S01 · Trace: FR-23, Edge case 9
**E6-S03 · [FE-W] Worker-day drill-down view**
- AC: shows times, photos, geofence result, source, audit trail for one worker-day; entry point from any grid cell.
- Est: 2h · Deps: E6-S01, E0-S08 · Trace: FR-23, Flow 7
**E6-S04 · [BE+FE-W] Admin record edit with mandatory reason**
- AC: change times / mark halfday / excuse absence; save blocked without reason note; before/after written to audit log.
- Est: 2h · Deps: E6-S03, E0-S05 · Trace: FR-24
**E6-S05 · [FE-A] Correction request form (engineer)**
- AC: select worker-day → proposed change + reason + optional photo; queues offline; shows submitted state.
- Est: 2h · Deps: E6-S01, E5-S01 · Trace: FR-25, Flow 8
**E6-S06 · [BE+FE-W] Correction review: approve / reject**
- AC: admin sees request beside source photos; Approve applies the edit via E6-S04 path (audited); Reject requires note.
- Est: 1.5h · Deps: E6-S05, E6-S04 · Trace: FR-25, Flow 8
**E6-S07 · [FE-A] Engineer notified of correction decision**
- AC: push/local notification with outcome + note; deep-link to the worker-day.
- Est: 1h · Deps: E6-S06, E9-S01 · Trace: Flow 8
**E6-S08 · [BE] Manual-attendance worker path (consent declined)**
- AC: worker registrable without biometrics; engineer marks present (untagged photo optional); records carry permanent `no_biometric_consent` marker; weekly exception generated.
- Est: 2h · Deps: E3-S01, E6-S01 · Trace: Edge case 7, Flow 2
---

## E7 — Gross Payroll (FR-26–31, Flow 7)

The computation engine (E7-S02) is pure logic, isolated from UI so it can be unit-tested exhaustively in its 2-hour box.

**E7-S01 · [BE] Payroll run model + state machine**
- AC: run scoped to tenant payroll week; states Draft → Reviewed → Approved → Exported with legal-transition enforcement; illegal transition rejected with test.
- Est: 2h · Deps: E1-S08 · Trace: FR-28
**E7-S02 · [BE] Gross pay computation engine**
- AC: pure function implementing `days × rate + halfdays × 0.5 × rate + OT_hrs × (rate/std_hrs) × multiplier`; rounding + late-deduction rules from settings; table-driven unit tests including halfday and OT cases.
- Est: 2h · Deps: E6-S01, E1-S08 · Trace: FR-26
**E7-S03 · [BE] OT eligibility gating**
- AC: OT hours counted only when site or worker OT toggle is on; ineligible overage recorded but zero-paid; toggle changes audited.
- Est: 1.5h · Deps: E7-S02 · Trace: FR-27
**E7-S04 · [BE+FE-W] Manual OT adjustment (audited)**
- AC: admin can add/reduce OT hours per worker-day with reason; audit entry; recompute reflects change immediately.
- Est: 1.5h · Deps: E7-S03, E6-S04 · Trace: FR-27
**E7-S05 · [BE] Blocking-exception check on approval**
- AC: approval blocked while unresolved blocking exceptions exist (missing time-out on paid day, unapproved manual tags); per-exception resolve-or-waive with note unblocks; waives audited.
- Est: 2h · Deps: E7-S01, E8-S04 · Trace: FR-28
**E7-S06 · [FE-W] Payroll run list + Start run**
- AC: run list with status chips + export history link; Start run auto-selects last payroll week; prevents overlapping runs for same period.
- Est: 1.5h · Deps: E7-S01 · Trace: Flow 7
**E7-S07 · [FE-W] Review grid: worker × day matrix**
- AC: cell states ✓ / ◐ / ✗ / OT+n / ⚠; virtualized for 50 workers × 7 days; cell click opens E6-S03 drill-down.
- Est: 2h · Deps: E7-S02, E6-S03 · Trace: FR-35, Flow 7
**E7-S08 · [FE-W] Unresolved-exceptions banner + inline resolve**
- AC: banner counts blocking exceptions on the run; click opens the exception inline (Flow 6 actions); count live-updates on resolution.
- Est: 1.5h · Deps: E7-S05, E8-S05 · Trace: Flow 7
**E7-S09 · [BE+FE-W] Adjustments line per worker**
- AC: free-form positive (allowance) or negative (cash advance) line with mandatory note; included in gross total; audited.
- Est: 1.5h · Deps: E7-S02 · Trace: FR-29
**E7-S10 · [FE-W] Mark Reviewed + totals card**
- AC: totals card (workers, man-days, OT hours, gross ₱, peso-formatted); Reviewed state set; further edits drop run back to Draft.
- Est: 1.5h · Deps: E7-S07 · Trace: Flow 7
**E7-S11 · [BE+FE-W] Approval action + Owner-only policy toggle**
- AC: tenant setting `approve_role` (default Admin, switchable Owner-only); Owner notified when policy requires them; approval sets immutable state.
- Est: 2h · Deps: E7-S05, E9-S01 · Trace: FR-28, Open Q1
**E7-S12 · [BE] Approved-run immutability enforcement**
- AC: all mutation endpoints reject changes to Approved/Exported runs; test attempts each mutation path.
- Est: 1h · Deps: E7-S11 · Trace: FR-31
**E7-S13 · [BE+FE-W] Post-approval correction → next-run adjustment**
- AC: correction on an approved period creates a cross-referenced adjustment entry in the next Draft run; both sides link to each other.
- Est: 2h · Deps: E7-S12, E7-S09 · Trace: FR-31, Flow 7
**E7-S14 · [BE] Payroll register export (CSV + XLSX)**
- AC: one row per worker: days, halfdays, OT hrs, adjustments, gross; XLSX opens clean in Excel; export event logged with file hash.
- Est: 2h · Deps: E7-S11 · Trace: FR-30
**E7-S15 · [BE] Signature-sheet PDF export**
- AC: printable A4 sheet per site: worker, days, gross, signature column; peso formatting; paginated for 50 workers.
- Est: 2h · Deps: E7-S11 · Trace: FR-30
**E7-S16 · [BE] Per-worker payslip PDF batch**
- AC: payslip per worker (gross, days, OT, adjustments); batch zip download; each line traceable in-app to source day records.
- Est: 2h · Deps: E7-S14 · Trace: FR-30
---

## E8 — Dashboard, Exceptions & Reports (FR-32–35, Flows 6, 10)

**E8-S01 · [FE-W] Today view: per-site headcount cards**
- AC: tagged-in vs roster per site ("18/20 in"); auto-refresh; empty state for no sessions today.
- Est: 2h · Deps: E6-S01, E0-S08 · Trace: FR-32
**E8-S02 · [FE-W] Live photo feed**
- AC: reverse-chronological session photos across sites; lazy-loaded thumbnails; click opens tagging workspace (E8-S10).
- Est: 1.5h · Deps: E8-S01 · Trace: FR-32
**E8-S03 · [FE-W] Sync status per engineer device**
- AC: last-sync time + pending count per device; stale device (>24 h) highlighted.
- Est: 1.5h · Deps: E5-S03 · Trace: FR-32
**E8-S04 · [BE] Exception model + queue API**
- AC: single exceptions table typed (missing in/out, manual tag, recognition disagreement, geofence, mock-location, clock drift, enrollment approval, correction request); severity ordering; resolve endpoint writes audit entry.
- Est: 2h · Deps: E0-S05 · Trace: FR-33
**E8-S05 · [FE-W] Exceptions queue list UI**
- AC: severity-sorted list with type badges + counts; filter by site/type/date; each row opens its resolver.
- Est: 2h · Deps: E8-S04 · Trace: FR-33, Flow 6
**E8-S06 · [FE-W] Resolver: missing time-out**
- AC: shows time-in photo + engineer note; actions Set halfday / Set actual out-time (reason) / Mark absent PM; default-pay-halfday rule applied pending resolution.
- Est: 2h · Deps: E8-S05, E6-S04 · Trace: Flow 6, Edge case 1
**E8-S07 · [FE-W] Resolver: manual tag approval**
- AC: photo crop side-by-side with enrollment photos; Approve / Reject (mark absent, note); resolution audited.
- Est: 1.5h · Deps: E8-S05 · Trace: Flow 6
**E8-S08 · [FE-W] Resolver: geofence violation**
- AC: map with pin, geofence circle, session location + photo; Accept (reason) / Reject session.
- Est: 1.5h · Deps: E8-S05, E2-S07 · Trace: FR-17, Flow 6
**E8-S09 · [FE-W] Resolver: recognition disagreement**
- AC: three-way side-by-side (photo crop / engineer tag / recognition match); Keep engineer tag / Use recognition / Mark absent (reason).
- Est: 1.5h · Deps: E8-S05, E5-S08 · Trace: Flow 6
**E8-S10 · [FE-W] Photo tagging workspace: face boxes + roster sidebar**
- AC: session photo with detected-face bounding boxes; roster search sidebar; layout mirrors mobile tagging pattern; opens from any session photo.
- Est: 2h · Deps: E4-S09, E8-S02 · Trace: FR-33b, FR-15b
**E8-S11 · [FE-W+BE] Admin tag / retag / untag with reason**
- AC: each action requires reason note; record marked `manual_tag_admin`; audit entry with before/after; later recognition pass reconciles per E5-S08.
- Est: 2h · Deps: E8-S10, E0-S05 · Trace: FR-15b
**E8-S12 · [FE-W] Report: attendance summary**
- AC: by worker / site / date range; totals row; CSV download.
- Est: 2h · Deps: E6-S01 · Trace: FR-34
**E8-S13 · [FE-W] Report: OT report**
- AC: OT hours by worker and site over range; flags manual OT adjustments distinctly.
- Est: 1.5h · Deps: E7-S03 · Trace: FR-34
**E8-S14 · [FE-W] Report: exception trends**
- AC: exception counts by type over time; resolution-time median; per-engineer breakdown.
- Est: 1.5h · Deps: E8-S04 · Trace: FR-34
**E8-S15 · [FE-W] Padding indicators cards**
- AC: four cards per Flow 10 (most manually tagged workers, geofence flags by engineer, perfect-attendance anomalies, OT concentration by engineer); drill-through to photo trail.
- Est: 2h · Deps: E8-S12, E8-S14 · Trace: FR-34, Flow 10
**E8-S16 · [BE] Evidence pack export**
- AC: per worker/engineer selection → PDF bundling photos + relevant audit-log entries; export event itself audited.
- Est: 2h · Deps: E8-S15, E0-S05 · Trace: Flow 10
---

## E9 — Notifications (FR-36)

**E9-S01 · [INF] Push infrastructure (FCM) + notification service abstraction**
- AC: device token registration; send abstraction supporting push + SMS-lite fallback; delivery result logged.
- Est: 2h · Deps: E0-S07 · Trace: FR-36
**E9-S02 · [BE] Engineer no-time-in reminder**
- AC: per-tenant configurable time; fires only if engineer's assigned sites have no time-in session; respects Asia/Manila (tenant-configurable) timezone.
- Est: 1.5h · Deps: E9-S01, E4-S16 · Trace: FR-36, NFR-8
**E9-S03 · [BE] Admin exception digest**
- AC: daily digest of new/unresolved exceptions grouped by type; suppressed when zero; link into queue.
- Est: 1.5h · Deps: E9-S01, E8-S04 · Trace: FR-36
**E9-S04 · [BE] Owner weekly summary**
- AC: headcount, gross payroll total, exception count for the week; sent on payroll-week close.
- Est: 1.5h · Deps: E9-S01, E7-S02 · Trace: FR-36
---

## Suggested delivery sequence (maps to PRD §9 release plan)

**Alpha:** E0 (all) → E1-S01–S08 → E2-S01–S03, S06–S07 → E3-S01–S10 → E4-S01–S16 → E5-S01–S04, S07 → E6-S01, S03 → E7-S01–S02, S14 (CSV export only)

**Beta:** remaining E4, E5 → E6 (all) → E7 (all) → E8-S01–S11 → E3-S11–S14

**GA:** E8-S12–S16 → E9 (all) → E1-S09–S10 polish → billing (not yet storied — pending pricing decision, PRD Open Q5)

---

## Open notes surfaced while writing stories

1. **In-time rule inconsistency (blocking for E4-S17/S20):** PRD Edge case 2 says "latest-in/earliest-out logic per worker" but Flow 3 says the system "keeps earliest in-time per worker." These contradict each other. Earliest-in/latest-out is worker-favorable; latest-in/earliest-out is conservative/anti-padding. Stories above assume **earliest-in, latest-out** (matching Flow 3 and the E6-S01 day-record definition) — confirm and correct whichever document is wrong.
2. **Billing has no stories.** PRD §9 lists billing in GA but pricing (Open Q5) is undecided; storying it now would be waste.
3. **FR-36 SMS-lite** is abstracted in E9-S01 but no SMS provider is chosen; provider selection is a decision, not a story.
4. **Recognition thresholds** (E4-S10) are tenant-tunable per NFR-3, but default values need field calibration during Alpha — treat as configuration work inside the Alpha design-partner engagement, not a story.
