import fs from "node:fs/promises";
import path from "node:path";
import sharp from "file:///G:/workspace/向总/Smart-Floor-Planner/admin/node_modules/sharp/lib/index.js";

const outDir = "G:/workspace/向总/Smart-Floor-Planner/design-references/presentation-ai-demo-2026-08";
await fs.mkdir(outDir, { recursive: true });

const files = [
  [
    "C:/Users/Administrator/.codex/generated_images/019ff6ef-5fdf-7390-8582-61c066d49bb5/exec-24fcb69a-fa0f-4d6a-87fe-39e9789d71da.png",
    "owner-sales-modern-cream-v2.jpg",
  ],
  [
    "C:/Users/Administrator/.codex/generated_images/019ff6ef-5fdf-7390-8582-61c066d49bb5/exec-4ae35a6c-210c-43f1-8853-a36b8f834a45.png",
    "owner-sales-modern-french-v2.jpg",
  ],
  [
    "C:/Users/Administrator/.codex/generated_images/019ff6ef-5fdf-7390-8582-61c066d49bb5/exec-cde1a99f-db50-49c4-84fc-9441875a490f.png",
    "owner-sales-modern-chinese-v2.jpg",
  ],
];

const results = [];
for (const [source, name] of files) {
  const target = path.join(outDir, name);
  await sharp(source)
    .resize(1600, 900, { fit: "cover", position: "centre" })
    .jpeg({ quality: 86, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toFile(target);
  const stat = await fs.stat(target);
  results.push({ name, bytes: stat.size });
}

console.log(JSON.stringify(results, null, 2));
