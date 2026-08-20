# Appointment Detail Inline Reschedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align Mini Program `appointment-detail` with design `03` by embedding the real availability picker on the detail page, demoting staff work actions to a secondary region, and turning `appointment-reschedule` into a redirect shell.

**Architecture:** Extract pure slot-window helpers into `miniprogram/utils/appointmentSlotPicker.js`. Host picker UI + sticky cancel/confirm on `appointment-detail`. Replace `appointment-reschedule` with an `onLoad` redirect to detail using an explicit mode-mapping table. **Update staff callers in the same change as the shell** so absent-mode deep links never misclassify staff as customers. Prefer opening detail directly where practical.

**Tech Stack:** WeChat Mini Program (WXML/WXSS/LESS/JS), existing `/appointments/availability` and customer/internal reschedule POSTs, Node `node:test` under `miniprogram/test/`.

**Spec:** `docs/superpowers/specs/2026-08-21-appointment-detail-inline-reschedule-design.md`

---

## File map

| File | Responsibility |
| --- | --- |
| Create `miniprogram/utils/appointmentSlotPicker.js` | Pure helpers: `dateText`, `timeText`, `appointmentDates`, `formatConfirmRescheduleLabel` |
| Create `miniprogram/test/appointment-slot-picker.test.js` | Unit tests for helpers |
| Modify `miniprogram/packages/business/appointment-detail/appointment-detail.{js,wxml,less}` | Inline picker, sticky hierarchy, inline submit |
| Replace `miniprogram/packages/business/appointment-reschedule/appointment-reschedule.{js,wxml,less}` | Compat redirect shell |
| Modify callers: `role-workbench.js`, `customer-service-home.js`, `customer-project.js` | Correct mode / prefer detail |
| Modify tests listed in Tasks 2–5 | Contract coverage |
| Docs: ledgers EN+ZH, ZH page inventory A03/A04, module inventory EN+ZH | Documentation gate |

Do **not** change booking APIs, permission matrices, or `appointment-booking` UI. Commit steps only when the user explicitly asks to commit.

---

### Task 1: Shared slot-picker helpers (TDD)

**Files:**
- Create: `miniprogram/utils/appointmentSlotPicker.js`
- Create: `miniprogram/test/appointment-slot-picker.test.js`

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  dateText,
  timeText,
  appointmentDates,
  formatConfirmRescheduleLabel,
} = require('../utils/appointmentSlotPicker.js');

test('appointmentDates builds a capped 5-day window with today/tomorrow labels', () => {
  const dates = appointmentDates(0, 30);
  assert.equal(dates.length, 5);
  assert.equal(dates[0].label, '今天');
  assert.equal(dates[1].label, '明天');
  assert.match(dates[0].key, /^\d{4}-\d{2}-\d{2}$/);
});

test('appointmentDates respects maxAdvanceDays remainder', () => {
  assert.equal(appointmentDates(6, 7).length, 2);
  assert.equal(appointmentDates(8, 7).length, 0);
});

test('formatConfirmRescheduleLabel uses selected slot start', () => {
  const label = formatConfirmRescheduleLabel({
    selectedSlot: { startAt: '2026-08-24T06:00:00.000Z', endAt: '2026-08-24T08:00:00.000Z' },
  });
  assert.match(label, /^确认改期至/);
  assert.match(label, /\d+月\d+日/);
  assert.match(label, /\d{2}:\d{2}/);
});
```

- [ ] **Step 2: Run test — expect FAIL (module missing)**

`cd miniprogram && node --test test/appointment-slot-picker.test.js`

- [ ] **Step 3: Implement helpers**

Port `dateText` / `timeText` / `appointmentDates` from current `appointment-reschedule.js`. Add `formatConfirmRescheduleLabel` →「确认改期至{M}月{D}日 {HH}:{mm}」from `selectedSlot.startAt` local time. Pure exports only.

- [ ] **Step 4: Run test — expect PASS**

`cd miniprogram && node --test test/appointment-slot-picker.test.js`

---

### Task 2: Failing contract tests (all must-update suites)

**Files:**
- Modify: `miniprogram/test/appointment-detail-actions.test.js`
- Modify: `miniprogram/test/appointment-calendar.test.js`
- Modify: `miniprogram/test/customer-service-home.test.js`
- Modify: `miniprogram/test/slice-5-role-homes.test.js`

- [ ] **Step 1: Rewrite `appointment-detail-actions` expectations**

First test (static):

- Remove assert for navigate to `appointment-reschedule?mode=`
- Add: availability GET path; `customer-reschedule` + `internal-reschedule`; picker method names; `doesNotMatch` navigate to reschedule route; sticky cancel|confirm classes; staff secondary still has survey/address/navigate/sync
- Add: confirm label uses `formatConfirmRescheduleLabel` / `confirmRescheduleLabel`
- Add: submit body uses `appointment.version` from loaded data (static match on `this.data.appointment.version` or equivalent) — must **not** POST query `version`

Second test (`internal reschedule reuses real availability…`):

- **Relocate entirely to `appointment-detail`** — assert optional reason field (`调整原因（选填）`, `!customerMode`), `disabled` until slot, `internal-reschedule` on detail script/wxml
- Do **not** keep these assertions on the future shell page

Keep existing lifecycle Page-mock tests.

- [ ] **Step 2: Rewrite `appointment-calendar` expectations**

- Horizon/slot identity behavioral test → detail page methods (or helper + detail), not full reschedule UI
- Capsule list: include `appointment-detail`; for `appointment-reschedule` assert redirect shell only (`redirectTo`, `appointment-detail`, mode mapping, missing-id toast) — no date pager / confirm-bar / `actionWidth` on shell

- [ ] **Step 3: Update caller tests to red**

- `customer-service-home.test.js`: expect navigate to `appointment-detail` with `mode=customer` (or shell only if still used — then document; prefer detail)
- `slice-5-role-homes.test.js`: staff reschedule must open detail **without** `mode=customer`, or shell with `mode=internal` — never bare shell URL without mode

- [ ] **Step 4: Run — expect FAIL**

```bash
cd miniprogram && node --test test/appointment-detail-actions.test.js test/appointment-calendar.test.js test/customer-service-home.test.js test/slice-5-role-homes.test.js
```

---

### Task 3a: Detail JS — data, loadSlots, inline submit

**Files:**
- Modify: `miniprogram/packages/business/appointment-detail/appointment-detail.js`

- [ ] **Step 1: Wire picker state + methods**

Require `appointmentSlotPicker`. Add data fields: `dates`, `dateOffset`, `maxAdvanceDays`, `selectedDate`, `slots`, `selectedSlot`, `selectedSlotStart`, `reason`, `slotsLoading`, `slotsError`, `rescheduleSubmitting`, `confirmRescheduleLabel`.

After `load()` when `canReschedule`, init window and `loadSlots()`. Implement `loadSlots` / `chooseDate` / `previousDates` / `nextDates` / `chooseSlot` / `onReasonInput` (same APIs as old reschedule page). Empty day → clear slots + copy path; loading/error local to picker.

- [ ] **Step 2: Replace `reschedule()` navigate with `submitReschedule()`**

- POST `customer-reschedule` or `internal-reschedule` with `startAt`, `endAt`, `version: this.data.appointment.version`, optional `reason` if `!customerMode`
- Success: toast, clear slot/reason, `await this.load()`, stay on page
- Conflict: toast API message, refresh availability + `load()`
- Zero `navigateTo`/`redirectTo` to `appointment-reschedule`

- [ ] **Step 3: Run detail-actions — expect remaining WXML/LESS failures only (or partial PASS on JS matches)**

`cd miniprogram && node --test test/appointment-detail-actions.test.js`

---

### Task 3b: Detail WXML — locked IA + sticky matrix

**Files:**
- Modify: `miniprogram/packages/business/appointment-detail/appointment-detail.wxml`

- [ ] **Step 1: Mandate IA order when content shows**

Inside `wx:elif="{{appointment}}"`:

1. Hero  
2. Schedule card  
3. Role / finished notes (as needed)  
4. **If `canReschedule`:**「调整上门时段」picker (+ internal reason when `!customerMode`)  
5. Safety points  
6. **Staff secondary** (`!customerMode`): start survey / complete, address∥navigate, sync — only when flags true; never sticky primary when `canReschedule`  
7. **Sticky footer** outside scroll or fixed bar:
   - `canReschedule` + `canCancel` → side-by-side「取消本次预约」| confirm (dynamic label; disabled without slot)
   - `canReschedule` && !`canCancel` → full-width confirm
   - !`canReschedule` && `canRebook` → sticky rebook
   - !`canReschedule` && staff && (`canStartSurvey` || `canComplete`) → promote that single CTA sticky
   - Customer never sees staff secondary

Remove old equal-weight stacked green primaries for survey + reschedule.

- [ ] **Step 2: Run detail-actions — expect style asserts may still fail**

---

### Task 3c: Detail LESS — picker + sticky visual parity

**Files:**
- Modify: `miniprogram/packages/business/appointment-detail/appointment-detail.less`

- [ ] **Step 1: Port picker styles from `appointment-reschedule.less`**

Day cards, active day, slots grid, `.slot.selected` (outline + selected affordance; add corner check if matching `03` without inventing assets — CSS check mark ok), reason field,「正在计算可用时段…」/ empty-slot text.

- [ ] **Step 2: Sticky bar**

Page `padding-bottom` for bar + safe area; fixed `.confirm-bar`; row flex for cancel|confirm; cancel white/border; confirm green `#00c365`, 84rpx / 42rpx radius; primary label ≥ 28rpx.

Keep secondary-row address/navigate language.

- [ ] **Step 3: Re-run**

```bash
cd miniprogram && node --test test/appointment-detail-actions.test.js test/appointment-slot-picker.test.js
```

Expected: PASS for detail-actions + slot-picker

---

### Task 4: Shell + callers in one change (mode-mapping safety)

**Files:**
- Replace: `miniprogram/packages/business/appointment-reschedule/appointment-reschedule.js` (and slim wxml/less)
- Modify: `miniprogram/components/role-workbench/role-workbench.js`
- Modify: `miniprogram/components/customer-service-home/customer-service-home.js`
- Modify: `miniprogram/packages/business/customer-project/customer-project.js`
- Finish: calendar + caller tests from Task 2

- [ ] **Step 1: Update callers BEFORE or WITH shell landing**

| Caller | Target |
| --- | --- |
| `role-workbench` reschedule | `appointment-detail?leadId=&appointmentId=` (**no** `mode=customer`) — preferred — or shell with `mode=internal` |
| `customer-service-home` | `appointment-detail?mode=customer&leadId=&appointmentId=` |
| `customer-project` reschedule | same as customer home |

Never leave staff opening shell without `mode`.

- [ ] **Step 2: Implement redirect shell**

```js
Page({
  onLoad(query) {
    const leadId = query.leadId || '';
    const appointmentId = query.appointmentId || '';
    if (!leadId || !appointmentId) {
      wx.showToast({ title: '预约信息不完整', icon: 'none' });
      setTimeout(() => wx.navigateBack({ fail: () => {} }), 400);
      return;
    }
    const params = [
      `leadId=${encodeURIComponent(leadId)}`,
      `appointmentId=${encodeURIComponent(appointmentId)}`,
    ];
    if (query.mode !== 'internal') {
      params.push('mode=customer');
    }
    if (query.version != null && query.version !== '') {
      params.push(`version=${encodeURIComponent(query.version)}`);
    }
    wx.redirectTo({
      url: `/packages/business/appointment-detail/appointment-detail?${params.join('&')}`,
    });
  },
});
```

Minimal WXML (loading text ok). Keep route in `app.json`.

- [ ] **Step 3: Run full focused suite**

```bash
cd miniprogram && node --test test/appointment-slot-picker.test.js test/appointment-detail-actions.test.js test/appointment-calendar.test.js test/customer-service-home.test.js test/slice-5-role-homes.test.js
```

Expected: all PASS

---

### Task 5: Documentation gate

**Files:**
- `docs/miniprogram-design-restoration-ledger.md`
- `docs/miniprogram-design-restoration-ledger.zh-CN.md`
- `docs/miniprogram-airy-minimalist-v1-page-inventory.zh-CN.md` (A03/A04 only — no new EN inventory)
- `docs/miniprogram-system-modules.md`
- `docs/miniprogram-system-modules.zh-CN.md`
- Spec status → Implemented / ready for QA when done

- [ ] **Step 1: Ledgers** — detail = inline picker + sticky hierarchy + staff secondary; reschedule = compat shell; capture pending  
- [ ] **Step 2: ZH inventory** — A03 inline detail; A04 redirect shell  
- [ ] **Step 3: Module inventory EN+ZH** — replace stacked-primary paragraph with sticky + secondary description  
- [ ] **Step 4:** `git diff --check` clean  

---

### Task 6: Manual smoke (DevTools)

1. Customer confirmed → picker; no cancel; confirm disabled until slot; success stays; time updates  
2. Designer confirmed → cancel|confirm side-by-side; secondary address/navigate; no dual sticky green  
3. Measurer confirmed → no picker; sticky start survey  
4. Old `appointment-reschedule` deep link → detail with correct mode  
5. `390x844` capsule-safe header  

---

## Risk notes

- Confirm label timezone must match existing `timeText` local formatting.
- Do not remove `appointment-reschedule` from `app.json`.
- Do not expand emoji icon set; keep 📐✏️📍 parity with calendar language already in ledger.
- Commits only when user requests.

## Execution handoff

Plan ready for execution choice after reviewer **Approved**.
