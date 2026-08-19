# Account v1 scene assets

`miniprogram/packages/business/assets/account-v1/` contains the three text-free header-scene
derivatives used only by the Mini Program account pages:

- `profile-dossier-scene-v3.png`
- `settings-guardian-scene-v3.png`
- `security-guardian-scene-v3.png`

They were generated with Codex built-in image generation on 2026-08-10 using
the user-provided references in `design-references/account/` and the approved
F1 Xiao K identity reference in `design-references/brand-concepts/`. The v3
exports use a magenta chroma-key pass followed by local alpha extraction, so
the Mini Program hero's green diagonal remains visible behind the scene. They
are project-owned production derivatives and may be used only inside Smart
Floor Planner. Each image contains no product text, business values,
interactive control, or customer data; all of those remain native WXML/Less
content.
