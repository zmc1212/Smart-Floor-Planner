import path from 'node:path';
import { createCanvas, GlobalFonts, loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import type { ReportReading } from './report-reading';

const assetDirectory = path.join(process.cwd(), 'public', 'assistant', 'report-poster');
const width = 390, scale = 2;
const ink = '#123b2c', muted = '#536154', sage = '#60745c', paper = '#f6f2e7';
const serif = '"ReportPosterSerif", "Noto Serif CJK SC", "Noto Sans CJK SC", SimSun, serif';
const sans = '"Noto Sans CJK SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';
const numeric = 'Georgia, "Times New Roman", serif';
const graphemes = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
type Site = ReportReading['projects'][number];
type PosterInput = { reading: ReportReading; weekly: boolean; updatedProjectIds: ReadonlySet<string> };
type PhotoCrop = { x: number; y: number; width: number; height: number };
let illustration: Promise<Image> | undefined;

function fill(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function text(ctx: SKRSContext2D, value: string, x: number, y: number, font: string, color = ink, maxWidth?: number) {
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.fillText(value, x, y, maxWidth);
}

function rule(ctx: SKRSContext2D, x: number, y: number, endX: number, endY: number, color: string, weight = .65) {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = weight;
  ctx.moveTo(x, y);
  ctx.lineTo(endX, endY);
  ctx.stroke();
}

function wrap(ctx: SKRSContext2D, value: string, font: string, maxWidth: number, maxLines = Infinity) {
  if (!value) return [];
  ctx.font = font;
  const lines: string[] = [];
  let line = '';
  for (const { segment } of graphemes.segment(value)) {
    if (!line || ctx.measureText(line + segment).width <= maxWidth) {
      line += segment;
      continue;
    }
    if (lines.length === maxLines - 1) {
      const characters = Array.from(line.trimEnd());
      while (characters.length && ctx.measureText(characters.join('') + '…').width > maxWidth) characters.pop();
      return [...lines, characters.join('') + '…'];
    }
    lines.push(line.trimEnd());
    line = segment.trimStart();
  }
  return [...lines, line];
}

function tornPaper(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, color: string, shadow = 5) {
  ctx.save();
  ctx.shadowColor = '#44352033';
  ctx.shadowBlur = shadow;
  ctx.shadowOffsetY = shadow / 3;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  const edge = [0, .75, -.55, 1.2, -.3, .3, 1.6, .5];
  const steps = Math.floor(w / 4);
  for (let index = 0; index <= steps; index++) ctx.lineTo(x + w * (1 - index / steps), y + h + edge[index % edge.length]);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function underline(ctx: SKRSContext2D, x: number, y: number, w: number) {
  ctx.beginPath();
  ctx.strokeStyle = '#829975';
  ctx.lineWidth = 1.65;
  ctx.moveTo(x, y + 5);
  ctx.bezierCurveTo(x + w * .36, y - 4, x + w * .46, y, x + w * .38, y + 6);
  ctx.bezierCurveTo(x + w * .31, y + 11, x + w * .76, y - 5, x + w * .73, y + 3);
  ctx.bezierCurveTo(x + w * .70, y + 8, x + w * .85, y + 5, x + w, y + 3);
  ctx.stroke();
}

function drawPaper(ctx: SKRSContext2D, height: number) {
  fill(ctx, 0, 0, width, height, paper);
  const tile = createCanvas(67, 71), grain = tile.getContext('2d');
  for (let index = 0; index < 620; index++) {
    fill(grain, index * 83 % 67, index * 49 % 71, .65, .65, index % 3 ? '#ffffff28' : '#70634016');
  }
  ctx.fillStyle = ctx.createPattern(tile, 'repeat');
  ctx.fillRect(0, 0, width, height);
  const spine = ctx.createLinearGradient(0, 0, 14, 0);
  spine.addColorStop(0, '#154431');
  spine.addColorStop(.55, '#295d4a');
  spine.addColorStop(1, '#103727');
  ctx.fillStyle = spine;
  ctx.fillRect(0, 0, 13, height);
  for (let x = 1; x < 13; x += 1.3) fill(ctx, x, 0, .32, height, '#e5edc12e');
  fill(ctx, 13, 0, 4, height, '#493e2819');
  ctx.strokeStyle = '#9aa47b';
  ctx.lineWidth = .85;
  for (let y = 96; y < height; y += 221) {
    ctx.beginPath();
    ctx.ellipse(11, y, 5.3, 1.6, -.18, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawClothTab(ctx: SKRSContext2D, caption: string, x: number, y: number) {
  fill(ctx, x, y, 79, 25, '#24543e');
  ctx.save();
  ctx.setLineDash([2, 1.5]);
  ctx.strokeStyle = '#e7eacc80';
  ctx.lineWidth = .5;
  ctx.strokeRect(x + 3, y + 3, 73, 19);
  ctx.restore();
  text(ctx, caption, x + 11, y + 18, `900 14px ${serif}`, '#fbf3d8');
}

function drawPhoto(ctx: SKRSContext2D, image: Image, x: number, y: number, w: number, h: number,
  angle: number, caption: string, crop: PhotoCrop, alignY: number) {
  const frame = 5, captionHeight = 17;
  ctx.save();
  ctx.translate(x + w / 2, y + (h + captionHeight) / 2);
  ctx.rotate(angle * Math.PI / 180);
  ctx.translate(-w / 2, -(h + captionHeight) / 2);
  ctx.shadowColor = '#44352038';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 2;
  fill(ctx, 0, 0, w, h + captionHeight, '#fdf9ed');
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  const photoW = w - frame * 2, photoH = h - frame;
  const ratio = photoW / photoH;
  const sourceW = Math.min(crop.width, crop.height * ratio);
  const sourceH = sourceW / ratio;
  ctx.drawImage(image, crop.x + (crop.width - sourceW) / 2, crop.y + (crop.height - sourceH) * alignY,
    sourceW, sourceH, frame, frame, photoW, photoH);
  text(ctx, caption, 8, h + 11.6, `10.7px ${sans}`, muted, w - 16);
  ctx.restore();
}

function siteCopy(ctx: SKRSContext2D, site: Site | undefined, w: number, feature: boolean, titleWidth = w) {
  const titleFont = `900 ${feature ? 23 : 18}px ${serif}`;
  const progressFont = `${feature ? 15 : 13}px ${sans}`;
  const noteFont = `12px ${sans}`;
  const title = wrap(ctx, site?.name || '暂无新现场记录', titleFont, titleWidth, 3);
  const progress = wrap(ctx, site?.progress || '', progressFont, w);
  const notes = [site?.attention, site?.arrangement].flatMap(note => wrap(ctx, note || '', noteFont, w));
  const titleStep = feature ? 26 : 21;
  return { title, progress, notes, titleFont, progressFont, noteFont, titleStep,
    height: title.length * titleStep + progress.length * 18 + notes.length * 16 + 4 };
}

function drawSiteCopy(ctx: SKRSContext2D, copy: ReturnType<typeof siteCopy>, x: number, y: number) {
  for (const title of copy.title) {
    text(ctx, title, x, y, copy.titleFont);
    y += copy.titleStep;
  }
  for (const progress of copy.progress) {
    text(ctx, progress, x, y, copy.progressFont);
    y += 18;
  }
  for (const note of copy.notes) {
    text(ctx, note, x, y, copy.noteFont, muted);
    y += 16;
  }
}

/** The submitted artwork is an illustrated process, never a site's evidence. */
export async function renderReportPoster({ reading, weekly, updatedProjectIds }: PosterInput) {
  if (!GlobalFonts.has('ReportPosterSerif')) GlobalFonts.registerFromPath(path.join(assetDirectory, 'poster-serif.woff2'), 'ReportPosterSerif');
  const art = await (illustration ??= loadImage(path.join(assetDirectory, 'site-illustration-v002.png')).catch(error => {
    illustration = undefined;
    throw error;
  }));
  const measure = createCanvas(1, 1).getContext('2d');
  const featured = reading.projects.find(site => updatedProjectIds.has(site.id));
  const remaining = reading.projects.filter(site => site.id !== featured?.id);
  const period = wrap(measure, reading.period, `16px ${numeric}, ${sans}`, 324);
  const featureTop = 150 + Math.max(0, period.length - 1) * 19;
  const featuredStage = featured ? featured.stage || '阶段待确认' : '';
  const stageFont = `bold 11px ${sans}`;
  measure.font = stageFont;
  const stageWidth = Math.min(65, Math.ceil(measure.measureText(featuredStage).width));
  const featuredCopy = siteCopy(measure, featured, 217, true, featured ? 205 - stageWidth : 217);
  const featureNameY = featureTop + 287;
  const featureContentEnd = Math.max(featureTop + 310, featureNameY + featuredCopy.height - featuredCopy.titleStep + 10);
  const notices = reading.notices.map(notice => wrap(measure, notice, `12px ${sans}`, 305));
  const featureEnd = featureContentEnd + 12 + notices.reduce((sum, lines) => sum + 10 + lines.length * 15, 0);
  const rows = [];
  let rowTop = featureEnd + (remaining.length ? 88 : 0);
  for (let start = 0; start < remaining.length; start += 2) {
    const pair = remaining.slice(start, start + 2), cardWidth = pair.length === 2 ? 155 : 326;
    const cards = pair.map((site, index) => ({ site, x: index ? 201 : 32, top: rowTop + index * 8,
      width: cardWidth, copy: siteCopy(measure, site, cardWidth - 18, false) }));
    const rowHeight = Math.max(82, ...cards.map(card => 40 + card.copy.height));
    rows.push({ cards, height: rowHeight });
    rowTop += rowHeight + 18;
  }
  const footerY = rowTop + 27;
  const canvas = createCanvas(width * scale, (footerY + 40) * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  drawPaper(ctx, footerY + 40);

  text(ctx, '小K 工地手账', 34, 40, `bold 12px ${sans}`, sage);
  text(ctx, reading.title, 31, 88, `900 39px ${serif}`, ink, 332);
  underline(ctx, 37, 96, 204);
  period.forEach((line, index) => text(ctx, line, 35, 126 + index * 19, `16px ${numeric}, ${sans}`, ink));

  tornPaper(ctx, 26, featureTop, 339, featureEnd - featureTop, '#f9f5e9', 8);
  drawClothTab(ctx, weekly ? '本周现场' : '当日现场', 35, featureTop - 9);
  const [total, updates, attention] = reading.stats;
  text(ctx, updates.value, 36, featureTop + 55, `${updates.value.length > 2 ? 36 : 46}px ${numeric}`, ink, 62);
  text(ctx, '个工地有现场更新', updates.value.length > 2 ? 99 : 76, featureTop + 49, `bold 15.7px ${sans}`, ink, 132);
  rule(ctx, 233, featureTop + 22, 233, featureTop + 52, '#b8c3a5');
  [total, attention].forEach((stat, index) => {
    const y = featureTop + 34 + index * 19;
    text(ctx, stat.value, 248, y, `17px ${numeric}, ${sans}`, ink, 38);
    text(ctx, stat.label, 286, y - 1, `11.5px ${sans}`, muted, 68);
  });
  drawPhoto(ctx, art, 38, featureTop + 72, 309, 162, -2.05, '水电工序示意',
    { x: 0, y: 0, width: art.width, height: art.height }, .92);
  drawPhoto(ctx, art, 263, featureTop + 181, 89, 93, 5.5, '线管局部示意',
    { x: art.width * .28, y: art.height * .33, width: art.width * .30, height: art.height * .64 }, .84);
  drawSiteCopy(ctx, featuredCopy, 38, featureNameY);
  if (featuredStage) text(ctx, featuredStage, 251 - stageWidth, featureNameY - 1, stageFont, sage, 65);
  let noticeY = featureContentEnd + 5;
  for (const lines of notices) {
    const noticeHeight = 6 + lines.length * 15;
    fill(ctx, 38, noticeY, 315, noticeHeight, '#ebe0c2');
    fill(ctx, 38, noticeY, 2, noticeHeight, '#9f8756');
    lines.forEach((line, index) => text(ctx, line, 45, noticeY + 14 + index * 15, `12px ${sans}`, '#725a32'));
    noticeY += noticeHeight + 4;
  }

  if (remaining.length) {
    text(ctx, featured ? '其余工地' : '工地目录', 32, featureEnd + 57, `900 30px ${serif}`);
    underline(ctx, 35, featureEnd + 63, 127);
  }
  for (const row of rows) for (const card of row.cards) {
    const { site, x, top, width: cardWidth, copy } = card, updated = updatedProjectIds.has(site.id);
    tornPaper(ctx, x, top, cardWidth, row.height, updated ? '#faf6ea' : '#eae8db', 4);
    fill(ctx, x, top, cardWidth, 2, updated ? '#aebc93' : '#98a181');
    text(ctx, site.stage || '阶段待确认', x + 9, top + 20, `bold 11px ${sans}`, sage, cardWidth - 18);
    drawSiteCopy(ctx, copy, x + 9, top + 44);
  }
  rule(ctx, 33, footerY, 357, footerY, '#a5ad91');
  text(ctx, '原记录见小程序同一期报告', 33, footerY + 19, `12px ${sans}`, muted);
  return canvas.toBuffer('image/png');
}
