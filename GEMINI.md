# Smart Floor Planner Context

Use `AGENTS.md` as the project-wide engineering contract and source-of-truth
index. The Chinese mirror is `AGENTS.zh-CN.md`.

## Current Product Surfaces

- `admin/` is the Next.js 16/Mongoose administration system for platform and
  enterprise operations. Local development uses port `3005`.
- `miniprogram/` is the native WeChat Mini Program for login, leads, promotion
  records, formal surveying, AI generation, inspiration, and staff workbench
  flows.
- Formal floor plans use the v4 `surveyGraph` contract. The old editor and old
  layout copies are removed.

## Read Before Editing

- Admin routes, APIs, models, roles, and workflows:
  `docs/admin-system-modules.md` and `docs/admin-system-modules.zh-CN.md`.
- Mini Program pages, API flows, limits, and role behavior:
  `docs/miniprogram-system-modules.md` and
  `docs/miniprogram-system-modules.zh-CN.md`.
- Formal surveying behavior and data operations:
  `docs/surveying-module/README.md` and
  `docs/surveying-module/formal-surveying.md`.
- Mini Program visual rules:
  `miniprogram/DESIGN.md`, `miniprogram/design-tokens.json`, and
  `miniprogram/app.wxss`.

Roadmaps and implementation plans are historical planning references. Confirm
current behavior in code and the current module inventories before describing or
implementing a feature.
