# Customer Service Home — Three Free Benefits

**Date:** 2026-08-25  
**Status:** Implemented / native runtime visual QA pending  
**Surface:** Mini Program customer Service tab · `pages/index/index`  
**Approved source:** `design-references/customer-service-home-three-free-v1/customer-service-home-three-free-v1.png`

## Purpose

The customer Service home now carries the same acquisition promise as the approved phone-authorization surface. The previous `两项服务，全程免费` / `免费量房` / `免费设计` marketing layer is replaced by exactly three benefits:

- `免费效果图` / `出到客户满意为止`
- `免费家装设计顾问` / `解答你的装修问题`
- `免费家装现场顾问` / `解答现场问题`

The marketing benefits and the operational service stage remain separate layers. The white stage ticket still consumes the real `serviceStage`, `nextActionKind`, `appointmentSummary`, formal floor-plan preview, published-scheme preview, and multi-project data. Customer ticket copy on this route drops 上门: inset titles `待预约量房` / `已预约量房` / `量房进行中`, summary `可预约量房时间`, and book CTA `预约量房`; staff workbench and booking-page 上门 wording stay.

## Composition and interactions

1. The capsule-safe identity row remains `家客来 · 服务向导`, the professional-service tag, and service/invite scan.
2. One green Hero reads `三项免费权益` and `三个免费，装修更省心`. Complete Xiao K holds the three semantic benefit cards once.
3. The overlapping service ticket keeps the real four-step rail `匹配 / 预约 / 量房 / 方案`. When a secondary archive action exists, the primary and archive actions share one row; archive-only states keep one full-width action.
4. `免费效果图` opens the current lead's delivered-scheme folio `customer-ai-schemes` (or scan acquisition in the zero-project state; unpublished leads keep the folio empty state). `免费家装设计顾问` reuses the shared designer WeChat contact flow. `免费家装现场顾问` reuses the existing book/reschedule/archive shortcut.
5. The closing strip reads `三项服务不收费` beside the truthful stage-derived status.

No route, API, permission, ranking, media, or stage-derivation contract changes.

## Production asset mapping

The approved whole-page mockup is not sliced or packaged. Route-specific standalone assets are used; where the composite source had no extractable layer, built-in ImageGen produced a dedicated production cutout instead of substituting a generic icon:

| Approved element | Production asset |
| --- | --- |
| Xiao K holding three benefit cards | `miniprogram/images/customer-service-three-free/xiao-k-three-benefits.png` (`560x473`, indexed-colour transparent PNG, `26715` bytes; byte-identical main-package copy of the optimized business-subpackage source) |
| Effect-image benefit | `miniprogram/images/customer-service-three-free/effect-room.jpg` (`520x390`, RGB JPEG, `25193` bytes; generated warm living-room visualization) |
| Design-advisor benefit | `miniprogram/images/customer-service-three-free/design-advisor-3d.png` (`520x390`, RGBA PNG, `118662` bytes; generated bulb-and-conversation cutout) |
| On-site-advisor benefit | `miniprogram/images/customer-service-three-free/onsite-advisor-3d.png` (`520x390`, RGBA PNG, `134840` bytes; generated location-pin, pedestal, and rolled-plan cutout) |
| Benefit-card arrow | `miniprogram/images/customer-service-three-free/chevron-right.png` (`64x64`, RGBA PNG; Lucide `chevron-right` rasterized white for the green circle) |

All assets live in the main package, remain below `300KB`, and use JPEG only for the opaque room visualization and PNG for transparent cutouts. The benefit cards, copy, green arrow circle, surfaces, and stage ticket remain native WXML/Less.

## Source-calibrated element ledger (`390x844`)

| Element | Runtime target |
| --- | --- |
| Identity title | `32rpx` |
| Hero benefit pill | `24rpx`, `52rpx` minimum height |
| Hero headline | `56rpx`, two-line reading block |
| Hero helper | `26rpx` |
| Stage title / summary / rail label | `32rpx` / `22rpx` / `22rpx` |
| Stage actions | `28rpx`, `76rpx` minimum height |
| No-media stage ticket | Copy and four-step rail share one row; actions remain a second row |
| Benefit title / helper | `34rpx` / `24rpx` (`32rpx` title override at `<=360px`) |
| Benefit art stage / visible glyph | `214x150rpx` / `96–104rpx` |
| Benefit arrow | `58rpx` green circle with a `44rpx` Lucide white `chevron-right` PNG |

The page remains content-intrinsic and scrollable; no viewport-growing flex gap is introduced. Runtime visual QA stays pending until the user supplies a `390x844` screenshot containing the native WeChat capsule and the tall-device reading rhythm.
