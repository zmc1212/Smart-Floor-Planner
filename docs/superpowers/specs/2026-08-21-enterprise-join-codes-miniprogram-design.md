# Enterprise dual join codes in Mini Program

## Goal

Enterprise-owner Ops workbench CTA shows **出示入驻码** and opens a dual-code page for the same Admin `/join-codes` staff + referrer onboarding codes. The owner can present, generate, rotate, and disable codes on one phone. Staff activity (customer-acquisition) codes remain designer/measurer only.

## Surface

- Workbench: `GET /api/miniprogram/workbench` for `enterprise_admin` returns `{ label: '出示入驻码', target: 'join-codes' }`.
- Page: `packages/business/enterprise-join-codes/enterprise-join-codes` with tabs 员工入驻码 / 推荐人入驻码.
- Visual: reuse 09 service-code show template; join-code copy; bottom manage actions.
- Manage:
  - No active code → **生成入驻码** (`POST .../rotate`)
  - Active code → **换新** + **停用**; viewing/image reveal does not rotate
  - Native `wx.showModal` for confirm; `wx.showToast` for success/failure
- APIs (JWT `enterprise_admin` only):
  - `GET /api/miniprogram/enterprise-join-codes`
  - `GET /api/miniprogram/enterprise-join-codes/[type]/image`
  - `POST /api/miniprogram/enterprise-join-codes/[type]/rotate`
  - `POST /api/miniprogram/enterprise-join-codes/[type]/disable`
- Mutate paths reuse `rotateEnterpriseJoinCode` / `disableEnterpriseJoinCode` (same audit as Admin). List DTO has no token. Image is private no-store.

## Out of scope

- Custom expiry UI on Mini Program
- Full audit event table (remains Admin)
- Designer/measurer dual-code entry
