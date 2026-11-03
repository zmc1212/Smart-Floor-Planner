# K-01 离线校审证据

本文件由 `scripts/knowledge-review/review_jingyi.py` 生成。原 PDF、逐页 PNG、OCR JSON 和 searchable 文本均为只读输入；本批没有调用 OCR/模型服务，也没有写入知识库。

- 原件：`G:\workspace\向总\Smart-Floor-Planner\docs\装修施工标准手册制度规范\精艺.pdf`
- SHA-256：`efcdc6f1e01ec848d0908e99ddd08929a7f0f07b3942f5b539864361f4aa049b`
- 物理 PDF 页数：`30`
- 渲染基线：宽度 `2400px`，透明度关闭，渲染器 `PyMuPDF`

## 30 页索引

`review-manifest.json` 保存每个物理页的派生 PNG/OCR/searchable 路径与 hash。`renderMatchesDerivedPng=true` 只表示本地渲染像素与既有派生 PNG 完全一致，不等于 OCR 文字准确。

## 5 页实际视觉对照

| 物理页 | 印刷页观察 | 类型 | 视觉结果 | OCR/文字结论 | 状态 |
| ---: | --- | --- | --- | --- | --- |
| 05 | 07/08 (visual observation; physical PDF page 05) | budget summary and basic-package table | Exact raster match. Visible totals include 55,024; 24,779; 56,801; 136,605; 14,400; 9,800; and 24,200 yuan. | OCR retains the headings and most totals but misreads units, decimal points, and many table cells (for example 83.98 and m²). Keep as visual-confirmed and text-unresolved. | `visual-confirmed-text-unresolved` |
| 15 | 27/28 (visual observation; physical PDF page 15) | design image collage | Exact raster match. The page is image-led and visibly contains the modern three-bedroom case, with printed pages 27 and 28. | OCR captures the main headings and page numbers; there is no table or construction numeric field to certify from OCR. | `visual-confirmed-no-table` |
| 20 | 37/38 (visual observation; physical PDF page 20) | main-material and custom-cabinet budget tables | Exact raster match. Visible printed pages 37 and 38 show totals 84,362.45 and 43,736.88, plus material, cabinet, door, and management rows. | OCR preserves many row values but has frequent digit/unit substitutions (for example 43.65, 26188.80, 3976.08, and 43736.88 are not uniformly recognized). Keep as visual-confirmed and text-unresolved. | `visual-confirmed-text-unresolved` |
| 29 | 55/56 (visual observation; physical PDF page 29) | demolition, water/electric, masonry standards | Exact raster match. Visible controls include 16 mm and 20 mm groove depths, 3 cm/3.5 cm depths, 3 cm/6 cm widths, 15 cm spacing, 4 m² dedicated kitchen/bath line, 8-12 kg pressure, and tile void-rate limits below 5% and 3%. | OCR has obvious character substitutions and line breaks (for example 墙/墻, 12 cm, 75 管, and tile-related words). Numeric/unit claims require a later human text pass before publication. | `visual-confirmed-text-unresolved` |
| 30 | 57/58 (visual observation; physical PDF page 30) | waterproofing, filling, carpentry, paint standards | Exact raster match. Visible controls include 1-2% slope, a 10 mm dam, 180 mm shower-zone coating, 300 mm dry-zone/edge requirements, 20 mm minimum water depth, 48 hour observation, 80/30 cm keel spacing, and 50 cm ceiling-width reinforcement trigger. | OCR confuses several units and characters (for example 300 mm, 2-3 days, and some waterproofing terms). Numeric/unit claims require a later human text pass before publication. | `visual-confirmed-text-unresolved` |

视觉对照页的 PNG 证据保存在 `tmp/parallel-support/knowledge-review/K-01/render/original/`。由于 OCR 在预算数字、单位和施工术语上出现可见替换，本批只把页面图像记为已核，未把文字记为可直接发布；后续仍需人工文字/表格校审并由 KnowledgeService 做正式接入检查。

## 下一批

除本批 05、15、20、29、30 外，其余 25 个物理页已沿同一机制完成渲染/派生 PNG 精确对照并建立逐页未解决项：`01, 02, 03, 04, 06, 07, 08, 09, 10, 11, 12, 13, 14, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27, 28`。它们的状态仍是 `render-confirmed-text-pending`，不是文字准确或可发布结论。草稿页不得自动发布；页码定位继续区分物理 PDF 页、印刷页与单页副本页。

`review-manifest.json` 的 `remainingPagePreparation` 保存每页 OCR 行数、可疑 token 和标题预览；原 OCR 文本及差异仍由 `originalOcr`/`originalSearchableText` 指向只读输入。

## 运行边界

本交付不修改原 PDF、不改写 `tmp/v1-01-weiyun-jingyi/`、不写主库、不替换已发布资料、不改变文档 404/405 或版本 410/411 的状态，也不提升 V1-01/V1-02 实现状态。
