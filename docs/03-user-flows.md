# User Flows — Presente v1

Version 0.1 · July 2026 · Companion to PRD v0.1

Notation: `[Screen]` = a screen/state · `(decision?)` = branch · `→` = transition · **bold** = user action

---

## Flow 1 — Contractor Onboarding (Owner, web)

```
[Landing page] → **Sign up** → [Company form: name, email, phone]
→ [OTP verification] → [Owner account created]
→ [Setup wizard]
   Step 1: Company settings (work week, standard hours=8, OT rate=125%, payroll week Mon–Sun)
   Step 2: Create first project/site → **drop map pin** → set geofence radius (default 150m)
   Step 3: Invite users → **add Engineer (SMS link)**, **add Admin (email link)**
   Step 4: (optional) **Upload worker CSV** (names, rates, positions)
→ [Dashboard — empty state: "Enroll your workers to start capturing attendance"]
```

Engineer receives SMS → installs Android app → **opens invite link** → sets PIN/password → `[Engineer home: assigned sites listed]`.

---

## Flow 2 — Worker Enrollment (Engineer on site, Android; Admin approves)

```
[Engineer home] → **Workers** → **+ Enroll worker**
→ [Consent screen — Tagalog/English biometric notice]
   → **Worker signs on screen** (or engineer photographs signed paper form)
   (consent given?) ─ no → [Enrollment blocked; option: register as manual-attendance worker]
                    └ yes ↓
→ [Profile form: name, nickname, position, daily rate*, site assignment]
   (*rate field hidden if engineer lacks permission → admin fills later)
→ [Guided face capture: front → left → right → with hard hat]
   (quality check per shot: blur/backlight?) ─ fail → **Retake** prompt
→ [Review & submit] → status: **Pending admin approval**
→ (sync) → Admin sees approval card in [Exceptions queue] → **Approve** (sets/confirms rate)
→ Worker active on roster; face template live
```

---

## Flow 3 — Morning Time-In (Engineer, Android — works offline)

```
[Engineer home] → **Time In**
→ [Site select — nearest assigned site pre-selected via GPS] → **Confirm site**
→ [Camera — live overlay: "14 faces detected"] → **Capture**
   (crew > one frame?) ─ yes → **Capture more photos** (repeat)
→ [Tagging screen]
   ▸ Auto-tagged (high confidence): green chips "Juan D. ✓  Pedro S. ✓ …"
   ▸ Confirm band: card "Is this **Ramon T.**?" → **Yes / No / Pick other**
   ▸ Unrecognized faces: red boxes
       → per face: **Tag from roster** (flagged manual_tag)
                  | **Mark visitor**
                  | **Quick-enroll new hire** (→ Flow 2 short path)
→ [Session summary: 16 tagged, 1 manual, 1 visitor · GPS ✓ inside geofence · 7:02 AM]
→ **Save session**
   (online?) ─ yes → synced ✓; recognition finalized server-side
             └ no  → [Queued: "1 session pending sync"] → auto-sync later
```

Late arrival: `[Engineer home] → **Time In** → same flow → additional session; system keeps earliest in-time per worker.`

GPS outside geofence: banner "You appear 900m from site — session will be flagged" → capture still allowed → admin exception created.

---

## Flow 4 — Time-Out (Engineer, Android)

```
[Engineer home] → **Time Out** → [Site confirm] → [Capture photos] → [Tagging screen]
→ [Session summary + reconciliation strip]:
   "⚠ 2 workers timed-in this morning are not in these photos: Ben R., Carlo M."
   → per worker: **They're here — capture again** | **Left early (note)** | **Leave as exception**
→ **Save session** → day records computed (in − out = hours; > standard hours & site OT-eligible → OT candidate)
```

---

## Flow 5 — Offline Sync & Conflicts (system + Engineer)

```
[Any screen] status pill: "3 pending" → connectivity returns → background upload
→ per session: photos (compressed) → server recognition pass (if deferred) → trusted-time stamp
→ (server finds admin already edited same worker-day?) → admin version kept;
   engineer session stored to audit log; no silent overwrite
→ (device clock drift > 10 min?) → all device sessions flagged → admin exception
→ notification to engineer: "All sessions synced ✓ / 1 needs attention"
```

---

## Flow 6 — Admin Daily Exception Review (Admin, web)

```
[Dashboard — Today] → sees: Site A 18/20 in · Site B 9/12 in · 4 exceptions
→ **Exceptions queue** (sorted by severity)
   1. Missing time-out — Ben R., Site A
      → open → view time-in photo + engineer note "left early"
      → **Set halfday** | **Set actual out-time (reason req.)** | **Mark absent PM**
   2. Manual tag pending — worker tagged without recognition
      → view photo crop side-by-side with enrollment photos → **Approve** | **Reject (mark absent)**
   3. Geofence violation — session 900m from Site B
      → view map + photo → **Accept (reason: site extension)** | **Reject session**
   4. Recognition disagreement — cloud result ≠ engineer's manual tag
      → side-by-side: photo crop · engineer's tag · recognition match
      → **Keep engineer tag** | **Use recognition match** | **Mark absent** (reason req.)
   5. Enrollment approval → (Flow 2 tail)
→ every action → immutable audit log entry (who/what/when/before/after/reason)

Admin manual tagging (any time, any photo):
[Today view or worker-day drill-down] → **open session photo**
→ [Tagging workspace: face boxes on photo + roster search sidebar]
→ **tag unrecognized face** | **retag wrong match** | **untag** → reason note → save
→ record marked manual_tag_admin → audit log
```

---

## Flow 7 — Weekly Payroll Run (Admin → Owner, web)

```
[Payroll] → **Start run** (period auto = last payroll week) → status: DRAFT
→ [Review grid: workers × days]
   cell states: ✓ full · ◐ halfday · ✗ absent · OT+2h · ⚠ exception
   → **click any cell** → drill-down: photos, times, geofence, audit trail
→ (blocking exceptions remain?) ─ yes → banner "3 unresolved days" → resolve inline (Flow 6 actions)
→ [Adjustments column]: **add cash-advance deduction / allowance** per worker (note required)
→ **Mark Reviewed** → totals card: 34 workers · 187 man-days · 41 OT hrs · Gross ₱ 412,350
→ (approval policy: Owner-only?) ─ yes → Owner notified → Owner **Approve** on phone/web
                                  └ no → Admin **Approve**
→ status: APPROVED (immutable)
→ **Export**: Payroll register (XLSX/CSV) · Signature sheet (PDF) · Payslips (PDF batch)
→ post-approval correction discovered → **Create adjustment** → lands in next run, cross-referenced
```

---

## Flow 8 — Correction Request (Engineer → Admin)

```
[Engineer app] → **Attendance** → select worker-day → **Request correction**
→ [Form: proposed change + reason + optional photo] → submit (queues offline)
→ Admin [Exceptions queue] → review request vs. photos → **Approve (applies edit)** | **Reject (note)**
→ Engineer notified; audit log updated
```

---

## Flow 9 — Worker Offboarding & Data Deletion (Admin, web)

```
[Workers] → select worker → **Deactivate** (end date)
→ retention timer starts (default 12 months)
→ (worker/contractor requests deletion?) → **Delete biometric data**
   → confirm dialog: "Face template & enrollment photos purged; attendance and payroll records
     retained without biometrics (legal/financial record)" → **Confirm**
→ deletion certificate logged (RA 10173 compliance)
```

---

## Flow 10 — Owner Padding Audit (Owner, web/phone)

```
[Reports] → **Padding indicators**
→ cards: "Workers most often manually tagged" · "Sessions with geofence flags by engineer"
        · "Perfect-attendance anomalies" · "OT concentration by engineer"
→ drill into any worker/engineer → full photo trail
→ (suspicion confirmed?) → export evidence pack (photos + audit log PDF)
```

---

## Cross-flow states to design

- **Empty states:** no workers enrolled, no sessions today, first payroll run
- **Pending recognition** chip (cloud path, offline capture)
- **Sync status** pill on every engineer screen
- **Permission-denied** views (engineer opening payroll URLs)
- **Consent-declined worker** badge throughout admin surfaces
