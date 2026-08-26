# Customer Service home three-free artwork

The customer Service TabBar page packages all three-free-benefit artwork under
`miniprogram/images/customer-service-three-free/`. Page layout, controls,
business copy, and interaction states remain native WXML/Less.

## Provenance and mapping

- `xiao-k-three-benefits.png` is a byte-identical main-package copy of the
  approved standalone artwork at
  `miniprogram/packages/business/assets/referral-service-v1/xiao-k-three-benefits.png`.
- `effect-room.jpg` was generated with Codex built-in ImageGen on 2026-08-25,
  using the approved page design as the style/composition reference. The prompt
  requested a warm cream living-room visualization only, with no UI, text,
  logo, border, people, or watermark.
- `design-advisor-3d.png` was generated with Codex built-in ImageGen on
  2026-08-25. The prompt requested the approved green speech bubble, warm yellow
  bulb, and smaller ivory conversation bubble as a genuine transparent cutout,
  with no UI, text, logo, border, people, or watermark.
- `onsite-advisor-3d.png` was generated and background-extracted with Codex
  built-in ImageGen on 2026-08-25. The prompt requested the approved green
  location pin, ivory pedestal, and rolled floor plan as a genuine transparent
  cutout, with no UI, text, logo, border, people, or watermark.

The generated masters were resized to `520x390`. The opaque room visual is an
optimized JPEG; the two cutouts retain RGBA PNG transparency. Every packaged
asset is below the Mini Program's `300KB` generated-artwork ceiling, and no
composite screenshot crop is shipped.

The three benefit-card controls use `chevron-right.svg` from this directory,
rasterized as the white transparent
`miniprogram/images/customer-service-three-free/chevron-right.png`. The green
`58rpx` circle stays native Less; the glyph is the Lucide icon rather than a
CSS border chevron. License text is in `LICENSE.md`.
