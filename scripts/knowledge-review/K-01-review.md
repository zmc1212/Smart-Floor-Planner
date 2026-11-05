# K-01 离线校审证据

原 PDF、逐页 PNG、OCR JSON、searchable 文本和既有导入清单均为只读输入；人工视觉记录来自独立的 `K-01-manual-review.json`。本批未调用 OCR/模型服务，也未写入知识库。

- 原件：`G:\workspace\向总\Smart-Floor-Planner\docs\装修施工标准手册制度规范\精艺.pdf`
- SHA-256：`efcdc6f1e01ec848d0908e99ddd08929a7f0f07b3942f5b539864361f4aa049b`
- 物理 PDF 页数：`30`
- 人工记录：`30/30` 页；全文文字/表格核准：`否`
- 人工输入 hash：`e97378d858f3f298b75d8d43b50875c3c9b85faecab60cfe4d3f0cfad730e700`

`renderMatchesDerivedPng=true` 只表示本地渲染像素与既有派生 PNG 完全一致，不等于 OCR 文字准确、人工文字核准或可发布。每页的原图/OCR/searchable 路径、hash、人工区域、精确差异、源文疑点和未决项见 `review-manifest.json`。

| 物理页 | 印刷页 | 状态 | 未决项数 |
| ---: | --- | --- | ---: |
| 01 | unknown | `visual-confirmed-no-table` | 1 |
| 02 | 01/02 | `visual-reviewed-text-unresolved` | 1 |
| 03 | 03/04 | `visual-confirmed-no-table` | 1 |
| 04 | 05/06 | `visual-reviewed-text-unresolved` | 1 |
| 05 | 07/08 | `visual-confirmed-text-unresolved` | 1 |
| 06 | 09/10 | `visual-reviewed-text-unresolved` | 1 |
| 07 | 11/12 | `visual-reviewed-text-unresolved` | 1 |
| 08 | 13/14 | `visual-reviewed-text-unresolved` | 1 |
| 09 | 15/16 | `visual-confirmed-no-table` | 1 |
| 10 | 17/18 | `visual-reviewed-text-unresolved` | 1 |
| 11 | 19/20 | `visual-reviewed-text-unresolved` | 1 |
| 12 | 21/22 | `visual-reviewed-text-unresolved` | 1 |
| 13 | 23/24 | `visual-reviewed-text-unresolved` | 1 |
| 14 | 25/26 | `visual-reviewed-text-unresolved` | 1 |
| 15 | 27/28 | `visual-confirmed-no-table` | 1 |
| 16 | 29/30 | `visual-reviewed-text-unresolved` | 1 |
| 17 | 31/32 | `visual-reviewed-text-unresolved` | 1 |
| 18 | 33/34 | `visual-reviewed-text-unresolved` | 1 |
| 19 | 35/36 | `visual-reviewed-text-unresolved` | 1 |
| 20 | 37/38 | `visual-confirmed-text-unresolved` | 1 |
| 21 | 39/40 | `visual-reviewed-text-unresolved` | 1 |
| 22 | 41/42 | `visual-confirmed-no-table` | 1 |
| 23 | 43/44 | `visual-confirmed-no-table` | 1 |
| 24 | 45/46 | `visual-reviewed-text-unresolved` | 1 |
| 25 | 47/48 | `visual-reviewed-text-unresolved` | 1 |
| 26 | 49/50 | `visual-reviewed-text-unresolved` | 1 |
| 27 | 51/52 | `visual-reviewed-text-unresolved` | 1 |
| 28 | 53/54 | `visual-reviewed-text-unresolved` | 1 |
| 29 | 55/56 | `visual-confirmed-text-unresolved` | 1 |
| 30 | 57/58 | `visual-confirmed-text-unresolved` | 1 |

05/15/20/29/30 初始样本及后续 25 页均为实际逐页图像观察，但范围是关键区域、标题/页码、可见表格关键数字和明确 OCR 差异，不是全册文字转录。预算、单位、施工术语和表格单元格均保持原文/建议/未决分离。

既有导入映射只抽取 `prepared.json`/`import.json` 的单页 PDF、copy page、document/version ID 和状态；不复制完整账册/日志。

本交付不修改原 PDF、不改写 `tmp/v1-01-weiyun-jingyi/`、不写主库、不替换已发布资料、不把样例价格解释为当前条款。
