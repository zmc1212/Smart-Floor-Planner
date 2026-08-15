# Smart Floor Planner

Smart Floor Planner connects renovation leads, formal surveying, floor-plan
records, and AI-assisted design across a tenant-aware Admin system and native
WeChat Mini Program.

## Users

Enterprise salespeople, surveyors, designers, enterprise administrators, and
platform administrators use the product for lead follow-up, on-site surveying,
design coordination, and business operations. Ordinary Mini Program users can
review their floor plans and continue into measurement or AI design.

## Product boundaries

- Admin uses cookie/JWT sessions and role/menu permissions.
- Mini Program uses `/api/auth/miniprogram` and bearer JWT.
- Business data is enterprise-scoped whenever an enterprise context exists.
- Formal surveying is one version-4 wall-graph workflow. Viewers, exports, 3D,
  and AI consume derived read models instead of maintaining editable copies.
- AI generation, credits, media, notifications, and commissions expose only
  executable server-backed states; provider or WeChat limitations remain visible.

## Design baseline

The Mini Program follows `miniprogram/DESIGN.md`, `design-tokens.json`,
`app.wxss`, and the brand-IP rules in
`docs/design/jiakelai-brand-ip-guidelines.md`. The primary visual QA viewport is
iPhone 13 Pro `390x844`, including the native WeChat capsule and safe areas.

## Source of truth

Current code, route handlers, schemas, tests, and the module inventories are
authoritative. Planning documents and historical design evidence do not prove
that a capability is implemented.
