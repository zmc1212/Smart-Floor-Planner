#!/usr/bin/env python3
"""Create a repeatable, read-only review manifest for the Jingyi manual.

The source PDF and its existing page/OCR derivatives are inputs only.  The
script never writes to the source tree, calls an OCR/model service, or updates
the knowledge database.  It renders pages with the same fixed width used by
the retained derivatives and records exact byte-hash equality where possible.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pymupdf as fitz  # PyMuPDF; used only for deterministic local rendering.


EXPECTED_SOURCE_HASH = "efcdc6f1e01ec848d0908e99ddd08929a7f0f07b3942f5b539864361f4aa049b"
SELECTED_PAGES = (5, 15, 20, 29, 30)
PRINTED_PAGE_NOTES = {
    5: "07/08 (visual observation; physical PDF page 05)",
    15: "27/28 (visual observation; physical PDF page 15)",
    20: "37/38 (visual observation; physical PDF page 20)",
    29: "55/56 (visual observation; physical PDF page 29)",
    30: "57/58 (visual observation; physical PDF page 30)",
}
REVIEW_NOTES = {
    5: {
        "kind": "budget summary and basic-package table",
        "visual": "Exact raster match. Visible totals include 55,024; 24,779; 56,801; 136,605; 14,400; 9,800; and 24,200 yuan.",
        "ocr": "OCR retains the headings and most totals but misreads units, decimal points, and many table cells (for example 83.98 and m²). Keep as visual-confirmed and text-unresolved.",
        "status": "visual-confirmed-text-unresolved",
    },
    15: {
        "kind": "design image collage",
        "visual": "Exact raster match. The page is image-led and visibly contains the modern three-bedroom case, with printed pages 27 and 28.",
        "ocr": "OCR captures the main headings and page numbers; there is no table or construction numeric field to certify from OCR.",
        "status": "visual-confirmed-no-table",
    },
    20: {
        "kind": "main-material and custom-cabinet budget tables",
        "visual": "Exact raster match. Visible printed pages 37 and 38 show totals 84,362.45 and 43,736.88, plus material, cabinet, door, and management rows.",
        "ocr": "OCR preserves many row values but has frequent digit/unit substitutions (for example 43.65, 26188.80, 3976.08, and 43736.88 are not uniformly recognized). Keep as visual-confirmed and text-unresolved.",
        "status": "visual-confirmed-text-unresolved",
    },
    29: {
        "kind": "demolition, water/electric, masonry standards",
        "visual": "Exact raster match. Visible controls include 16 mm and 20 mm groove depths, 3 cm/3.5 cm depths, 3 cm/6 cm widths, 15 cm spacing, 4 m² dedicated kitchen/bath line, 8-12 kg pressure, and tile void-rate limits below 5% and 3%.",
        "ocr": "OCR has obvious character substitutions and line breaks (for example 墙/墻, 12 cm, 75 管, and tile-related words). Numeric/unit claims require a later human text pass before publication.",
        "status": "visual-confirmed-text-unresolved",
    },
    30: {
        "kind": "waterproofing, filling, carpentry, paint standards",
        "visual": "Exact raster match. Visible controls include 1-2% slope, a 10 mm dam, 180 mm shower-zone coating, 300 mm dry-zone/edge requirements, 20 mm minimum water depth, 48 hour observation, 80/30 cm keel spacing, and 50 cm ceiling-width reinforcement trigger.",
        "ocr": "OCR confuses several units and characters (for example 300 mm, 2-3 days, and some waterproofing terms). Numeric/unit claims require a later human text pass before publication.",
        "status": "visual-confirmed-text-unresolved",
    },
}


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    # Existing OCR files contain a UTF-8 BOM on some Windows copies.
    return json.loads(path.read_text(encoding="utf-8-sig"))


def suspicious_tokens(text: str) -> list[str]:
    # This is a locator for later manual review, not a correctness classifier.
    tokens = re.findall(r"[闐佣帚霜墻墳壕仝稽徙誒][\u4e00-\u9fff0-9．.％%]*", text)
    return sorted(set(tokens))


def safe_preview(text: str) -> str:
    """Keep the index useful without copying contact numbers from the source."""
    return re.sub(r"\d[\d\s]{8,}\d", "<redacted-contact>", text)


def render_page(document: fitz.Document, page_number: int) -> bytes:
    page = document[page_number - 1]
    scale = 2400 / page.rect.width
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    return pixmap.tobytes("png")


def build_manifest(source_pdf: Path, derived_root: Path, output_root: Path) -> dict[str, Any]:
    output_root.mkdir(parents=True, exist_ok=True)
    render_root = output_root / "render" / "original"
    render_root.mkdir(parents=True, exist_ok=True)

    source_hash = sha256_file(source_pdf)
    if source_hash != EXPECTED_SOURCE_HASH:
        raise SystemExit(
            f"source hash mismatch: expected {EXPECTED_SOURCE_HASH}, got {source_hash}"
        )

    pages_root = derived_root / "pages"
    searchable_root = derived_root / "searchable"
    document = fitz.open(source_pdf)
    if document.page_count != 30:
        raise SystemExit(f"expected 30 PDF pages, got {document.page_count}")

    pages: list[dict[str, Any]] = []
    for page_number in range(1, document.page_count + 1):
        page_name = f"{page_number:02d}"
        png_path = pages_root / f"{page_name}.png"
        ocr_path = pages_root / f"{page_name}.ocr.json"
        text_path = searchable_root / f"{page_name}.txt"
        rendered = render_page(document, page_number)
        rendered_hash = sha256_bytes(rendered)
        existing_hash = sha256_file(png_path) if png_path.exists() else None
        ocr = load_json(ocr_path) if ocr_path.exists() else {}
        ocr_text = str(ocr.get("text", ""))
        lines = ocr.get("lines") if isinstance(ocr.get("lines"), list) else []
        searchable_hash = sha256_file(text_path) if text_path.exists() else None
        page_entry: dict[str, Any] = {
            "physicalPdfPage": page_number,
            "printedPage": PRINTED_PAGE_NOTES.get(page_number, "unknown"),
            "sourcePdf": str(source_pdf),
            "sourcePdfSha256": source_hash,
            "derivedPng": str(png_path),
            "derivedPngSha256": existing_hash,
            "renderedPngSha256": rendered_hash,
            "renderMatchesDerivedPng": existing_hash == rendered_hash,
            "ocrJson": str(ocr_path),
            "ocrJsonSha256": sha256_file(ocr_path) if ocr_path.exists() else None,
            "ocrSourceHash": ocr.get("sourceHash"),
            "ocrInputHash": ocr.get("inputHash"),
            "ocrPageField": ocr.get("page"),
            "ocrEngine": ocr.get("engine"),
            "ocrLineCount": len(lines),
            "ocrTextChars": len(ocr_text),
            "searchableText": str(text_path),
            "searchableTextSha256": searchable_hash,
            "ocrSuspiciousTokenCount": len(suspicious_tokens(ocr_text)),
            "ocrSuspiciousTokens": suspicious_tokens(ocr_text)[:32],
            "ocrHeadingPreview": [
                safe_preview(str(line.get("text", "")))
                for line in lines[:8]
                if isinstance(line, dict) and str(line.get("text", "")).strip()
            ],
        }
        pages.append(page_entry)
        if page_number in SELECTED_PAGES:
            (render_root / f"{page_name}.png").write_bytes(rendered)

    selected = []
    for page_number in SELECTED_PAGES:
        review = REVIEW_NOTES[page_number]
        page_entry = next(item for item in pages if item["physicalPdfPage"] == page_number)
        selected.append(
            {
                "physicalPdfPage": page_number,
                "printedPage": page_entry["printedPage"],
                "visualEvidence": str(render_root / f"{page_number:02d}.png"),
                "existingDerivativeEvidence": str(pages_root / f"{page_number:02d}.png"),
                "originalOcr": str(pages_root / f"{page_number:02d}.ocr.json"),
                "originalSearchableText": str(searchable_root / f"{page_number:02d}.txt"),
                "differenceClass": "exact-raster-match; OCR text requires manual correction",
                "suggestedAction": "Preserve the original OCR and source locator; review numeric/unit/table cells manually before any KnowledgeService import.",
                **review,
            }
        )

    remaining = [page for page in range(1, 31) if page not in SELECTED_PAGES]
    return {
        "delivery": "K-01",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "enterprise": "微云",
            "enterpriseId": "1454",
            "pdf": str(source_pdf),
            "sha256": source_hash,
            "physicalPdfPages": document.page_count,
        },
        "derivedInputRoot": str(derived_root),
        "renderProfile": {"targetWidthPx": 2400, "alpha": False, "renderer": "PyMuPDF"},
        "pages": pages,
        "selectedVisualReviews": selected,
        "remainingPagePreparation": [
            {
                "physicalPdfPage": page["physicalPdfPage"],
                "printedPage": page["printedPage"],
                "renderMatchesDerivedPng": page["renderMatchesDerivedPng"],
                "ocrLineCount": page["ocrLineCount"],
                "ocrSuspiciousTokens": page["ocrSuspiciousTokens"],
                "ocrHeadingPreview": page["ocrHeadingPreview"],
                "status": "render-confirmed-text-pending",
                "unresolved": "No visual text/table sign-off recorded in this batch; preserve and review the original OCR before publication.",
            }
            for page in pages
            if page["physicalPdfPage"] in remaining
        ],
        "nextDraftPages": remaining,
        "publicationBoundary": "Offline review only. Do not publish or replace the 28 draft documents; runtime KnowledgeService must perform any later version, audience, tenant, locator, and revocation checks.",
    }


def write_summary(manifest: dict[str, Any], output_root: Path) -> None:
    summary_path = output_root / "reviewed-pages.md"
    lines = [
        "# K-01 离线校审证据",
        "",
        "本文件由 `scripts/knowledge-review/review_jingyi.py` 生成。原 PDF、逐页 PNG、OCR JSON 和 searchable 文本均为只读输入；本批没有调用 OCR/模型服务，也没有写入知识库。",
        "",
        f"- 原件：`{manifest['source']['pdf']}`",
        f"- SHA-256：`{manifest['source']['sha256']}`",
        f"- 物理 PDF 页数：`{manifest['source']['physicalPdfPages']}`",
        f"- 渲染基线：宽度 `{manifest['renderProfile']['targetWidthPx']}px`，透明度关闭，渲染器 `{manifest['renderProfile']['renderer']}`",
        "",
        "## 30 页索引",
        "",
        "`review-manifest.json` 保存每个物理页的派生 PNG/OCR/searchable 路径与 hash。`renderMatchesDerivedPng=true` 只表示本地渲染像素与既有派生 PNG 完全一致，不等于 OCR 文字准确。",
        "",
        "## 5 页实际视觉对照",
        "",
        "| 物理页 | 印刷页观察 | 类型 | 视觉结果 | OCR/文字结论 | 状态 |",
        "| ---: | --- | --- | --- | --- | --- |",
    ]
    for item in manifest["selectedVisualReviews"]:
        lines.append(
            f"| {item['physicalPdfPage']:02d} | {item['printedPage']} | {item['kind']} | {item['visual']} | {item['ocr']} | `{item['status']}` |"
        )
    lines.extend(
        [
            "",
            "视觉对照页的 PNG 证据保存在 `tmp/parallel-support/knowledge-review/K-01/render/original/`。由于 OCR 在预算数字、单位和施工术语上出现可见替换，本批只把页面图像记为已核，未把文字记为可直接发布；后续仍需人工文字/表格校审并由 KnowledgeService 做正式接入检查。",
            "",
            "## 下一批",
            "",
            "除本批 05、15、20、29、30 外，其余 25 个物理页已沿同一机制完成渲染/派生 PNG 精确对照并建立逐页未解决项：`" + ", ".join(f"{p:02d}" for p in manifest["nextDraftPages"]) + "`。它们的状态仍是 `render-confirmed-text-pending`，不是文字准确或可发布结论。草稿页不得自动发布；页码定位继续区分物理 PDF 页、印刷页与单页副本页。",
            "",
            "`review-manifest.json` 的 `remainingPagePreparation` 保存每页 OCR 行数、可疑 token 和标题预览；原 OCR 文本及差异仍由 `originalOcr`/`originalSearchableText` 指向只读输入。",
            "",
            "## 运行边界",
            "",
            "本交付不修改原 PDF、不改写 `tmp/v1-01-weiyun-jingyi/`、不写主库、不替换已发布资料、不改变文档 404/405 或版本 410/411 的状态，也不提升 V1-01/V1-02 实现状态。",
        ]
    )
    summary_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-pdf", type=Path, required=True)
    parser.add_argument("--derived-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    args = parser.parse_args()
    manifest = build_manifest(args.source_pdf, args.derived_root, args.output_root)
    (args.output_root / "review-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    write_summary(manifest, args.output_root)
    checked = len(manifest["pages"])
    exact = sum(1 for page in manifest["pages"] if page["renderMatchesDerivedPng"])
    print(f"K-01 indexed {checked} pages; exact rendered PNG matches: {exact}/{checked}")
    print(f"selected visual reviews: {', '.join(f'{p:02d}' for p in SELECTED_PAGES)}")
    print(f"manifest: {args.output_root / 'review-manifest.json'}")
    print(f"summary: {args.output_root / 'reviewed-pages.md'}")


if __name__ == "__main__":
    main()
