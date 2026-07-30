# Home v5 asset provenance

The raster assets shipped under `miniprogram/images/home-v5/` are derived from
the project-provided design reference:

- `design-references/home/miniprogram-home-vibrant-green-v5.png`

The reference is stored outside the Mini Program package. Crops are used only
for the home hero scene, measurement illustration, service imagery, plan
preview, and the two small header icons. Text, business data, status, and touch
targets remain native WXML/WXSS rather than being baked into a full-page image.

Service micro-assets are cropped to contain only their visual subject. In
particular, `ai-wand.jpg`, `bluetooth-mark.jpg`, and `laser-device.jpg` exclude
the neighboring reference labels and preserve complete subject padding so
native card text cannot expose partial baked-in glyphs.

These files do not introduce an external icon library or third-party stock
asset. Their usage and redistribution follow the ownership terms of the source
design supplied to this project.
