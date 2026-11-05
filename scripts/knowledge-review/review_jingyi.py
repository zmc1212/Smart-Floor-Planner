#!/usr/bin/env python3
"""Create a read-only, hash-bound K-01 review manifest.

Manual visual observations are maintained separately in K-01-manual-review.json.
This script binds them to the retained PDF/PNG/OCR inputs and extracts only the
small page-to-document/version mapping needed for offline evidence.  Structural
render equality never creates a visual approval or publication decision.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pymupdf as fitz


EXPECTED_SOURCE_HASH = "efcdc6f1e01ec848d0908e99ddd08929a7f0f07b3942f5b539864361f4aa049b"
SELECTED_PAGES = (5, 15, 20, 29, 30)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def suspicious_tokens(text: str) -> list[str]:
    # Locator only; not a correctness classifier.
    return sorted(set(re.findall(r"[闐佣帚霜墻墳壕仝稽徙誒][\u4e00-\u9fff0-9-]*", text)))


def safe_preview(text: str) -> str:
    return re.sub(r"\d[\d\s]{8,}\d", "<redacted-contact>", text)


def render_page(document: fitz.Document, page_number: int) -> bytes:
    page = document[page_number - 1]
    scale = 2400 / page.rect.width
    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    return pixmap.tobytes("png")


def load_manual_review(path: Path, source_hash: str) -> tuple[dict[str, Any], dict[int, dict[str, Any]]]:
    data = load_json(path)
    if data.get("sourcePdfSha256") != source_hash:
        raise SystemExit(
            f"manual review source hash mismatch: expected {source_hash}, got {data.get('sourcePdfSha256')}"
        )
    reviews = data.get("pages")
    if not isinstance(reviews, list):
        raise SystemExit("manual review input must contain a pages array")
    by_page: dict[int, dict[str, Any]] = {}
    for review in reviews:
        if not isinstance(review, dict):
            raise SystemExit("manual review pages must contain objects")
        page_number = review.get("physicalPdfPage")
        if not isinstance(page_number, int) or not 1 <= page_number <= 30:
            raise SystemExit(f"invalid manual review page: {page_number!r}")
        if page_number in by_page:
            raise SystemExit(f"duplicate manual review page: {page_number}")
        if not review.get("reviewedRegions"):
            raise SystemExit(f"manual review page {page_number} has no reviewedRegions")
        if not review.get("reviewProvenance"):
            raise SystemExit(f"manual review page {page_number} has no reviewProvenance")
        for difference in review.get("ocrDifferences", []):
            if not isinstance(difference, dict):
                raise SystemExit(f"manual review page {page_number} has an invalid OCR difference")
            if not ("ocrObservation" in difference or "comparisonObservation" in difference):
                raise SystemExit(
                    f"manual review page {page_number} OCR difference needs ocrObservation or comparisonObservation"
                )
            if difference.get("observationIsVerbatim") is not False:
                raise SystemExit(
                    f"manual review page {page_number} OCR observation must be marked non-verbatim"
                )
            if "originalOcrExcerpt" not in difference or "originalOcrLocator" not in difference:
                raise SystemExit(
                    f"manual review page {page_number} OCR difference needs originalOcrExcerpt/originalOcrLocator"
                )
        by_page[page_number] = review
    return data, by_page


def load_import_mapping(derived_root: Path) -> dict[str, Any]:
    """Read only page-level fields from prepared/import evidence manifests."""
    prepared_path = derived_root / "prepared.json"
    import_path = derived_root / "import.json"
    result: dict[str, Any] = {
        "preparedManifest": {
            "path": str(prepared_path),
            "sha256": sha256_file(prepared_path) if prepared_path.exists() else None,
        },
        "importManifest": {
            "path": str(import_path),
            "sha256": sha256_file(import_path) if import_path.exists() else None,
        },
        "pages": {},
        "missing": [],
    }
    prepared: dict[int, dict[str, Any]] = {}
    imported: dict[int, dict[str, Any]] = {}
    if prepared_path.exists():
        for part in load_json(prepared_path).get("parts", []):
            if isinstance(part, dict) and isinstance(part.get("page"), int):
                prepared[part["page"]] = part
    else:
        result["missing"].append("prepared.json")
    if import_path.exists():
        raw_import = load_json(import_path)
        result["importSourceHash"] = raw_import.get("sourceHash")
        result["importEnterpriseId"] = raw_import.get("enterpriseId")
        result["importEnterpriseName"] = raw_import.get("enterpriseName")
        result["importScope"] = raw_import.get("scope")
        for part in raw_import.get("parts", []):
            if isinstance(part, dict) and isinstance(part.get("page"), int):
                imported[part["page"]] = part
    else:
        result["missing"].append("import.json")

    for page_number in range(1, 31):
        prepared_part = prepared.get(page_number, {})
        import_part = imported.get(page_number, {})
        pdf_path = Path(str(prepared_part["path"])) if prepared_part.get("path") else None
        pdf_hash: str | None = None
        pdf_page_count: int | None = None
        if pdf_path and pdf_path.exists():
            pdf_hash = sha256_file(pdf_path)
            try:
                with fitz.open(pdf_path) as single_page_pdf:
                    pdf_page_count = single_page_pdf.page_count
            except Exception:
                pdf_page_count = None
        if not prepared_part:
            result["missing"].append(f"prepared.parts.page={page_number}")
        if not import_part:
            result["missing"].append(f"import.parts.page={page_number}")
        result["pages"][str(page_number)] = {
            "copyPage": 1 if pdf_page_count == 1 else None,
            "singlePagePdf": str(pdf_path) if pdf_path else None,
            "singlePagePdfSha256": pdf_hash or prepared_part.get("sha256"),
            "singlePagePdfPageCount": pdf_page_count,
            "preparedPartHash": prepared_part.get("sha256"),
            "registeredDocumentId": import_part.get("documentId"),
            "registeredVersionId": import_part.get("versionId"),
            "registeredStatus": import_part.get("status"),
            "registeredReviewed": import_part.get("reviewed"),
            "originalReadbackVerified": import_part.get("originalReadbackVerified"),
            "importDerivativeHash": import_part.get("derivativeHash"),
        }
    return result


def build_manifest(
    source_pdf: Path,
    derived_root: Path,
    output_root: Path,
    manual_review_path: Path,
    reuse_render: bool = False,
) -> dict[str, Any]:
    output_root.mkdir(parents=True, exist_ok=True)
    render_root = output_root / "render" / "original"
    render_root.mkdir(parents=True, exist_ok=True)
    source_hash = sha256_file(source_pdf)
    if source_hash != EXPECTED_SOURCE_HASH:
        raise SystemExit(f"source hash mismatch: expected {EXPECTED_SOURCE_HASH}, got {source_hash}")
    manual_data, manual_by_page = load_manual_review(manual_review_path, source_hash)
    import_mapping = load_import_mapping(derived_root)
    pages_root = derived_root / "pages"
    searchable_root = derived_root / "searchable"

    document = fitz.open(source_pdf)
    try:
        if document.page_count != 30:
            raise SystemExit(f"expected 30 PDF pages, got {document.page_count}")
        previous: dict[int, dict[str, Any]] = {}
        previous_path = output_root / "review-manifest.json"
        if reuse_render and previous_path.exists():
            previous_raw = load_json(previous_path)
            previous = {
                int(item["physicalPdfPage"]): item
                for item in previous_raw.get("pages", [])
                if isinstance(item, dict) and isinstance(item.get("physicalPdfPage"), int)
            }

        pages: list[dict[str, Any]] = []
        for page_number in range(1, 31):
            page_name = f"{page_number:02d}"
            png_path = pages_root / f"{page_name}.png"
            ocr_path = pages_root / f"{page_name}.ocr.json"
            text_path = searchable_root / f"{page_name}.txt"
            existing_hash = sha256_file(png_path) if png_path.exists() else None
            previous_entry = previous.get(page_number, {})
            can_reuse = (
                reuse_render
                and previous_entry.get("sourcePdfSha256") == source_hash
                and previous_entry.get("derivedPngSha256") == existing_hash
                and previous_entry.get("renderedPngSha256")
            )
            rendered = None if can_reuse else render_page(document, page_number)
            rendered_hash = previous_entry["renderedPngSha256"] if can_reuse else sha256_bytes(rendered)
            ocr = load_json(ocr_path) if ocr_path.exists() else {}
            ocr_text = str(ocr.get("text", ""))
            lines = ocr.get("lines") if isinstance(ocr.get("lines"), list) else []
            searchable_hash = sha256_file(text_path) if text_path.exists() else None
            manual = manual_by_page.get(page_number)
            page_entry: dict[str, Any] = {
                "physicalPdfPage": page_number,
                "printedPage": manual.get("printedPage", "unknown") if manual else "unknown",
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
                "importMapping": import_mapping["pages"].get(str(page_number), {}),
                "manualReviewStatus": manual.get("status") if manual else "missing-manual-review",
                "manualReview": manual,
                "visualApprovalCreatedByStructure": False,
            }
            pages.append(page_entry)
            if page_number in SELECTED_PAGES:
                evidence_path = render_root / f"{page_name}.png"
                if rendered is not None:
                    evidence_path.write_bytes(rendered)
                elif not evidence_path.exists() and png_path.exists():
                    evidence_path.write_bytes(png_path.read_bytes())
    finally:
        document.close()

    manual_input_hash = sha256_file(manual_review_path)

    def visual_record(page_entry: dict[str, Any]) -> dict[str, Any]:
        manual = page_entry.get("manualReview") or {}
        return {
            "physicalPdfPage": page_entry["physicalPdfPage"],
            "printedPage": page_entry["printedPage"],
            "status": page_entry["manualReviewStatus"],
            "visualEvidence": manual.get("visualEvidence"),
            "existingDerivativeEvidence": page_entry["derivedPng"],
            "originalOcr": page_entry["ocrJson"],
            "originalSearchableText": page_entry["searchableText"],
            "reviewedRegions": manual.get("reviewedRegions", []),
            "confirmed": manual.get("confirmed", []),
            "ocrDifferences": manual.get("ocrDifferences", []),
            "sourceQuestions": manual.get("sourceQuestions", []),
            "suggestions": manual.get("suggestions", []),
            "unresolved": manual.get("unresolved", []),
            "reviewProvenance": manual.get("reviewProvenance"),
            "sourceBinding": {
                "sourcePdfSha256": page_entry["sourcePdfSha256"],
                "derivedPngSha256": page_entry["derivedPngSha256"],
                "ocrJsonSha256": page_entry["ocrJsonSha256"],
                "searchableTextSha256": page_entry["searchableTextSha256"],
            },
            "renderMatchesDerivedPng": page_entry["renderMatchesDerivedPng"],
            "visualApprovalCreatedByStructure": False,
        }

    all_visual_reviews = [visual_record(page) for page in pages]
    selected = [item for item in all_visual_reviews if item["physicalPdfPage"] in SELECTED_PAGES]
    missing_manual = [page["physicalPdfPage"] for page in pages if page["manualReview"] is None]
    return {
        "delivery": "K-01",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "enterprise": "微云",
            "enterpriseId": "1454",
            "pdf": str(source_pdf),
            "sha256": source_hash,
            "physicalPdfPages": len(pages),
        },
        "derivedInputRoot": str(derived_root),
        "renderProfile": {"targetWidthPx": 2400, "alpha": False, "renderer": "PyMuPDF"},
        "manualReviewInput": {
            "path": str(manual_review_path),
            "sha256": manual_input_hash,
            "reviewer": manual_data.get("reviewProvenance", {}).get("reviewer"),
            "scope": manual_data.get("reviewProvenance", {}).get("scope"),
        },
        "importEvidence": import_mapping,
        "pages": pages,
        "visualReviewCoverage": {
            "reviewedPages": len(all_visual_reviews) - len(missing_manual),
            "missingManualPages": missing_manual,
            "fullTextCorrection": False,
            "structureDoesNotApproveText": True,
        },
        "allVisualReviews": all_visual_reviews,
        "selectedVisualReviews": selected,
        "remainingPagePreparation": [item for item in all_visual_reviews if item["physicalPdfPage"] not in SELECTED_PAGES],
        "nextDraftPages": missing_manual,
        "publicationBoundary": "Offline review only. Do not publish or replace draft documents; later KnowledgeService checks remain required.",
    }


def write_summary(manifest: dict[str, Any], output_root: Path) -> None:
    summary_path = output_root / "reviewed-pages.md"
    lines = [
        "# K-01 离线校审证据",
        "",
        "原 PDF、逐页 PNG、OCR JSON、searchable 文本和既有导入清单均为只读输入；人工视觉记录来自独立的 `K-01-manual-review.json`。本批未调用 OCR/模型服务，也未写入知识库。",
        "",
        f"- 原件：`{manifest['source']['pdf']}`",
        f"- SHA-256：`{manifest['source']['sha256']}`",
        f"- 物理 PDF 页数：`{manifest['source']['physicalPdfPages']}`",
        f"- 人工记录：`{manifest['visualReviewCoverage']['reviewedPages']}/30` 页；全文文字/表格核准：`否`",
        f"- 人工输入 hash：`{manifest['manualReviewInput']['sha256']}`",
        "",
        "`renderMatchesDerivedPng=true` 只表示本地渲染像素与既有派生 PNG 完全一致，不等于 OCR 文字准确、人工文字核准或可发布。每页的原图/OCR/searchable 路径、hash、人工区域、精确差异、源文疑点和未决项见 `review-manifest.json`。",
        "",
        "| 物理页 | 印刷页 | 状态 | 未决项数 |",
        "| ---: | --- | --- | ---: |",
    ]
    for item in manifest["allVisualReviews"]:
        lines.append(
            f"| {item['physicalPdfPage']:02d} | {item['printedPage']} | `{item['status']}` | {len(item.get('unresolved', []))} |"
        )
    lines.extend(
        [
            "",
            "05/15/20/29/30 初始样本及后续 25 页均为实际逐页图像观察，但范围是关键区域、标题/页码、可见表格关键数字和明确 OCR 差异，不是全册文字转录。预算、单位、施工术语和表格单元格均保持原文/建议/未决分离。",
            "",
            "既有导入映射只抽取 `prepared.json`/`import.json` 的单页 PDF、copy page、document/version ID 和状态；不复制完整账册/日志。",
            "",
            "本交付不修改原 PDF、不改写 `tmp/v1-01-weiyun-jingyi/`、不写主库、不替换已发布资料、不把样例价格解释为当前条款。",
        ]
    )
    summary_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-pdf", type=Path, required=True)
    parser.add_argument("--derived-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--manual-review", type=Path, default=Path(__file__).with_name("K-01-manual-review.json"))
    parser.add_argument("--reuse-render", action="store_true")
    args = parser.parse_args()
    manifest = build_manifest(
        args.source_pdf,
        args.derived_root,
        args.output_root,
        args.manual_review,
        reuse_render=args.reuse_render,
    )
    (args.output_root / "review-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    write_summary(manifest, args.output_root)
    checked = len(manifest["pages"])
    exact = sum(1 for page in manifest["pages"] if page["renderMatchesDerivedPng"])
    reviewed = manifest["visualReviewCoverage"]["reviewedPages"]
    print(f"K-01 indexed {checked} pages; exact rendered PNG matches: {exact}/{checked}")
    print(f"manual visual records: {reviewed}/{checked}; full text correction: no")
    print(f"manifest: {args.output_root / 'review-manifest.json'}")
    print(f"summary: {args.output_root / 'reviewed-pages.md'}")


if __name__ == "__main__":
    main()
