# Enterprise dual join codes in Mini Program

## Goal

Enterprise-owner Ops uses an acquisition-first Hero pair. The primary **分享活动码** action opens the store-level customer-acquisition presenter and supports direct customer sharing; the secondary **邀请入驻** action opens the dual-code page for the same Admin `/join-codes` staff + referrer onboarding codes. The owner can present, generate, rotate, and disable onboarding codes on one phone.

## Surface

- Workbench: `GET /api/miniprogram/workbench` for `enterprise_admin` returns `activityCode: { label: '分享活动码', detail: '发给客户 · 扫码留资', target: 'activity-code' }` plus `joinCode: { label: '邀请入驻', detail: '员工 · 推荐人', target: 'join-codes' }`.
- Workbench visual: `design-references/enterprise-owner-activity-code-entry-v3/enterprise-owner-operations-home-v3.png`; the white activity-code tile and translucent outlined onboarding tile are equal-width, equal-height actions with aligned icon/text/chevron boxes. The approved V3 reorganizes the owner's five existing KPI values into a regular three-column `新增线索 → 已完成量房 → 已签约` operations path, a straight progress rail, and secondary `方案交付率` / `签单率` tiles plus an integrated pale-mint exception tray. The stage-2 detail is the real period-scoped `已发布方案 N 份` count instead of the ambiguous `闭合率`; it is derived from `schemeFacts.publishedLeadCount`. Native WXML keeps every label, value, state, and tap target dynamic. V3 business illustrations are standalone transparent ImageGen cutouts, mapped to `images/operations-dashboard/enterprise-guide.png`, `lead-inbox.png`, and `staff-load.png`; no composite design screenshot is sliced into product assets. During staggered deployment, the Mini Program maps the old single `activityCode.target === 'join-codes'` payload to onboarding instead of presenting it as customer acquisition.
- Page: `packages/business/enterprise-join-codes/enterprise-join-codes` with tabs 员工入驻码 / 推荐人入驻码.
- Visual: `design-references/enterprise-code-presenters-fullscreen-v1/enterprise-join-codes-fullscreen-v1.png`; the mint QR card is an intrinsic block (header, large QR, overlapping scan-guide Xiao K, caption), followed by the white-page journey rail and the safety/share/manage dock. The stage uses independent transparent `code-presenter-v3` business artwork rather than text-in-circle substitutes; copy and controls remain native. No viewport-sized flex gap or screenshot slicing is used.
- Manage:
  - No active code → **生成入驻码** (`POST .../rotate`)
  - Active code → **换新** + **停用**; viewing/image reveal does not rotate
  - Native `wx.showModal` for confirm; `wx.showToast` for success/failure
- APIs (JWT `enterprise_admin` only):
  - `GET /api/miniprogram/enterprise-join-codes`
  - `GET /api/miniprogram/enterprise-join-codes/[type]/image`
  - `POST /api/miniprogram/enterprise-join-codes/[type]/rotate`
  - `POST /api/miniprogram/enterprise-join-codes/[type]/disable`
- Mutate paths reuse `rotateEnterpriseJoinCode` / `disableEnterpriseJoinCode` (same audit as Admin). Admin list DTO has no token. Mini Program GET includes the active HMAC token for WeChat share into onboarding and does not write a reveal audit (image fetch still does). Image is private no-store.

## Out of scope

- Custom expiry UI on Mini Program
- Full audit event table (remains Admin)
- Designer/measurer dual-code entry
