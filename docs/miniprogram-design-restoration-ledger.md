# Mini Program Design Restoration Ledger

This is the current route-to-design lookup. Keep exactly one row per runtime
route and one latest approved design source. Replace a row when the source or
production state changes; do not append restoration history here.

| Runtime route | Latest design source | Current QA state | Restored |
| --- | --- | --- | :---: |
| `pages/index/index` | `design-references/all-pages-ip-v1/01-home-v2.png` | Existing restoration; refresh route evidence on the next visual change | Yes |
| `packages/business/lead-detail/lead-detail` | `design-references/all-pages-ip-v3/08-lead-detail-v3.png` | Current customer, acquisition, conversion and formal-surveying states are implemented; native capsule capture is the remaining release check | Yes |
| `packages/business/settings/settings` | `design-references/account/settings-v1.png` | Current notification permission states are implemented; native capsule capture is the remaining release check | Yes |
| `pages/ai-design/ai-design` | `design-references/ai-design/ai-recipe-discovery-home-v2/ai-recipe-discovery-home-v2.png` | Current recipe discovery, project selection and truthful task states are implemented; native capsule capture is the remaining release check | Yes |
| `packages/ai-workflow/create/ai-design-create` | `design-references/all-pages-ip-v3/14-ai-design-create-v3.png` | Existing restoration | Yes |
| `packages/ai-workflow/recipe-detail/recipe-detail` | `design-references/ai-design/ai-recipe-discovery-home-v2/ai-recipe-discovery-home-v2.png` | Current recipe explanation and input contract are implemented; native capture pending | Yes |
| `packages/ai-workflow/recipe-project/recipe-project` | `design-references/ai-design/ai-recipe-discovery-home-v2/ai-recipe-discovery-home-v2.png` | Current project and formal-survey eligibility states are implemented; native capture pending | Yes |
| `packages/ai-workflow/recipe-confirm/recipe-confirm` | `design-references/ai-design/ai-recipe-discovery-home-v2/ai-recipe-discovery-home-v2.png` | Current confirmation and source-choice states are implemented; native capture pending | Yes |
| `packages/ai-workflow/result/ai-design-result` | `design-references/ai-design/ai-recipe-discovery-home-v2/ai-recipe-discovery-home-v2.png` | Current generation, failure and delivery states are implemented; native capture pending | Yes |
| `packages/ai-workflow/history/ai-design-history` | `design-references/ai-design/ai-recipe-discovery-home-v2/ai-recipe-discovery-home-v2.png` | Current task filters and truthful task cards are implemented; native capture pending | Yes |
| `packages/surveying/editor/surveying-editor` | `design-references/surveying/cursor-guide-state-reference-20260812.jpg` | Current Canvas guide and cursor states plus the right-rail confirmed canvas-clear/restart action are covered by focused tests; native capsule capture pending | Yes |
| `packages/business/promotion-service-code/promotion-service-code` | `design-references/referrer-network-appointment-v1/selected-option-a.png` | Selected option A left-screen structure implemented with a protected WeChat code image, anonymous copy, and safe capsule lane; the Antigravity-generated Xiao K transparent PNG follows the approved design and F1/F3 references without slicing the composite. Actual WeChat DevTools QA on the iPhone 12/13 Pro `390x844` simulator confirmed the top route and element bounds and captured the loading state in a full host window including the native capsule | Yes |
| `packages/business/free-design-service/free-design-service` | `design-references/referrer-network-appointment-v1/selected-option-a.png` | Selected option A middle/right states implemented with token resolution, phone authorization, idempotent claim, designer contact delivery, and assignment-pending fallback; service, process, and privacy icons were independently extracted from the Antigravity board into transparent packaged PNGs. Actual WeChat DevTools QA at `390x844` confirmed the authorization and success top routes and element bounds, including a 346px full-content-width primary action, with full host-window captures including the native capsule | Yes |

## Recording rules

- Use the normalized route from `miniprogram/app.json` as the unique key.
- Record the design mapping and one concise current QA result.
- Keep screenshots, metrics, and test logs in local evidence directories, not in
  this canonical ledger.
- Update the English and Chinese ledgers together when a visual restoration changes.

Chinese mirror: [miniprogram-design-restoration-ledger.zh-CN.md](./miniprogram-design-restoration-ledger.zh-CN.md)
