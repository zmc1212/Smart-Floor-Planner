import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import type { ReportProject } from '@/lib/construction/report-scope';
import { issueStatusLabel } from '@/lib/xiaok-v1/progress-status';
import { weeklyProjectStageName } from '@/lib/xiaok-v1/weekly-report-service';

const dateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
});
const title = '企业工地周报';
const footer = '完整报告可在小程序「企业日周报」查看。';
const openIssues = new Set(['awaiting_verification', 'awaiting_rectification', 'rectifying', 'awaiting_review']);

function dateKey(value: Date | string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dateFormat.format(date) : '';
}

function clean(text: unknown) {
  return typeof text === 'string' ? text.replace(/\s+/gu, ' ').trim() : '';
}

function recordLine(project: string, room: string, text: string) {
  const detail = text.startsWith(project) ? text.slice(project.length).replace(/^[ ·：:]+/u, '') || text : text;
  return !room || detail.startsWith(room) ? detail : `${room} · ${detail}`;
}

function projectNote(project: ReportProject, reportEnd: string) {
  const updates = [...project.records].reverse();
  const latestProgress = updates.find(record => clean(record.data?.completed));
  const latestPending = updates.find(record => clean(record.data?.coordination) || clean(record.data?.pending));
  const plan = project.weekSchedule;
  const late = plan?.available ? plan.nodes.find(node => node.color === 'red') : null;
  const issue = project.issues?.find(item => openIssues.has(item.status) && clean(item.text));
  const nextWeek = dateKey(new Date(Date.parse(`${reportEnd}T00:00:00+08:00`) + 7 * 86_400_000));
  const next = plan?.available && nextWeek ? plan.nodes
    .filter(node => node.completion !== 'completed' && node.plannedStart > reportEnd && node.plannedStart <= nextWeek)
    .sort((left, right) => left.plannedStart.localeCompare(right.plannedStart))[0] : null;

  return {
    id: project.id,
    name: project.name,
    stage: weeklyProjectStageName(project),
    progress: latestProgress ? recordLine(project.name, clean(latestProgress.room), clean(latestProgress.data.completed))
      : updates.length ? `本周有 ${updates.length} 条现场记录。` : '本周暂无新现场记录。',
    attention: [late && `计划落后 · ${late.roomName}${late.stageName}`,
      issue ? [issueStatusLabel(issue.status), recordLine(project.name, clean(issue.room), clean(issue.text)), clean(issue.ownerName)].filter(Boolean).join(' · ')
        : latestPending && `待跟进 · ${recordLine(project.name, clean(latestPending.room), clean(latestPending.data.coordination) || clean(latestPending.data.pending))}`,
    ].filter((line): line is string => Boolean(line)).join(' / '),
    next: next ? `下周计划 · ${next.plannedStart.slice(5).replace('-', '/')} ${next.roomName}${next.stageName}` : '',
    late: Boolean(late),
  };
}

export function buildBossWeeklyNotebook(input: {
  reportId: string; revision: number; periodStart: Date | string; periodEnd: Date | string; projects: ReportProject[];
}) {
  const start = dateKey(input.periodStart), end = dateKey(input.periodEnd);
  const date = start.replaceAll('-', '.');
  const last = (start.slice(0, 4) === end.slice(0, 4) ? end.slice(5) : end).replaceAll('-', '.');
  const projects = input.projects.map(project => projectNote(project, end));
  return {
    reportId: input.reportId,
    revision: input.revision,
    period: start && end && start !== end ? `${date}—${last}` : (date || last),
    withUpdates: input.projects.filter(project => project.records.length > 0).length,
    waitingSchedule: input.projects.filter(project => !project.weekSchedule?.available).length,
    projects,
  };
}

export type BossWeeklyNotebook = ReturnType<typeof buildBossWeeklyNotebook>;

function notices(notebook: BossWeeklyNotebook) {
  const late = notebook.projects.filter(project => project.late).length;
  return [late ? { text: `${late} 个工地有计划落后节点`, tone: 'late' as const } : null,
    notebook.waitingSchedule ? { text: `${notebook.waitingSchedule} 个工地排期待核实`, tone: 'pending' as const } : null,
  ].filter(notice => notice !== null);
}

export function bossWeeklyNotebookText(notebook: BossWeeklyNotebook) {
  const header = [notebook.period ? `${title}（${notebook.period}）` : title,
    `共${notebook.projects.length}个工地 · ${notebook.withUpdates}个有现场更新`,
    ...notices(notebook).map(notice => notice.text)].join('\n');
  const lineLimit = Math.min(110, Math.floor((1598 - header.length - footer.length) / notebook.projects.length) - 1);
  const items = notebook.projects.map(project => {
    const line = [project.name, project.stage || '阶段待确认', project.progress, project.attention || project.next].filter(Boolean).join(' · ');
    // Respect the channel's message budget without dropping a site's line.
    return line.length > lineLimit ? line.slice(0, lineLimit - 1).replace(/[\uD800-\uDBFF]$/u, '') + '…' : line;
  });
  return [header, ...items, footer].join('\n');
}

// The owner-approved WeChat proof uses the Mini Program's paper, spine, and cloth-tab palette.
const width = 390, scale = 2;
const pageX = 35, pageWidth = 337, innerX = 51, innerWidth = 305;
const color = { background: '#f7f3e9', sheet: '#fbf7ed', ink: '#073c30', muted: '#465d54',
  rule: '#b7c8b5', cloth: '#07513c', stage: '#e3e8d7', pending: '#f5e4b7', pendingInk: '#765015',
  late: '#f4dcd4', lateInk: '#8d392b' };
const font = {
  title: 'bold 30px "Noto Serif CJK SC", SimSun, serif',
  name: 'bold 19px "Noto Serif CJK SC", SimSun, serif',
  tab: 'bold 16px "Noto Serif CJK SC", SimSun, serif',
  number: 'bold 34px "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
  body: '16px "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
  small: '13px "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
};
const graphemes = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });

function wrap(ctx: SKRSContext2D, text: string, maxWidth: number, maxLines: number) {
  const lines: string[] = [];
  let line = '';
  for (const { segment } of graphemes.segment(text)) {
    if (!line || ctx.measureText(line + segment).width <= maxWidth) {
      line += segment;
      continue;
    }
    if (lines.length === maxLines - 1) {
      const last = [...graphemes.segment(line)].map(part => part.segment);
      while (ctx.measureText(last.join('') + '…').width > maxWidth && last.length) last.pop();
      return [...lines, last.join('').trimEnd() + '…'];
    }
    lines.push(line.trimEnd());
    line = segment.trimStart();
  }
  return [...lines, line];
}

function noteLayout(ctx: SKRSContext2D, project: BossWeeklyNotebook['projects'][number]) {
  ctx.font = font.small;
  const label = project.stage || '阶段待确认';
  const badge = wrap(ctx, label, 92, 1)[0];
  const badgeWidth = ctx.measureText(badge).width + 20;
  ctx.font = font.name;
  const nameLines = wrap(ctx, project.name, innerWidth - badgeWidth - 14, 3);
  ctx.font = font.body;
  const progressLines = wrap(ctx, project.progress, innerWidth, 2);
  ctx.font = font.small;
  const secondary = [project.attention, project.next].filter(Boolean).flatMap(line => wrap(ctx, line, innerWidth, 2));
  return { nameLines, badge, badgeWidth, progressLines, secondary, pending: !project.stage,
    height: 23 + nameLines.length * 24 + progressLines.length * 23 + secondary.length * 19 };
}

function paper(ctx: SKRSContext2D, y: number, height: number) {
  ctx.save();
  ctx.fillStyle = color.sheet;
  ctx.shadowColor = 'rgba(75, 61, 36, 0.14)';
  ctx.shadowBlur = 9;
  ctx.shadowOffsetY = 3;
  ctx.fillRect(pageX, y, pageWidth, height);
  ctx.restore();
}

function rule(ctx: SKRSContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.strokeStyle = color.rule;
  ctx.lineWidth = 0.65;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function pill(ctx: SKRSContext2D, x: number, y: number, w: number, bg: string, fg: string, text: string) {
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x, y, w, 22, 7);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.font = font.small;
  ctx.textAlign = 'center';
  ctx.fillText(text, x + w / 2, y + 16);
  ctx.textAlign = 'left';
}

function spine(ctx: SKRSContext2D, height: number) {
  const ink = ctx.createLinearGradient(0, 0, 19, 0);
  ink.addColorStop(0, '#216c55');
  ink.addColorStop(0.7, '#0a543f');
  ink.addColorStop(1, '#06382d');
  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, 19, height);
  ctx.fillStyle = 'rgba(255, 249, 215, 0.09)';
  for (let x = 1; x < 18; x += 2) ctx.fillRect(x, 0, 0.6, height);
  ctx.fillStyle = 'rgba(56, 37, 15, 0.10)';
  ctx.fillRect(19, 0, 1.5, height);
  ctx.strokeStyle = '#899773';
  ctx.lineWidth = 1;
  for (let y = 32; y < height - 12; y += 182) {
    ctx.beginPath();
    ctx.ellipse(17, y, 5, 1.5, -0.16, 0, Math.PI * 2);
    ctx.stroke();
  }
}

export function renderBossWeeklyNotebook(notebook: BossWeeklyNotebook) {
  const overviewY = 91, hintRows = notices(notebook);
  const overviewHeight = 76 + hintRows.length * 27;
  const sheetY = overviewY + overviewHeight + 24;
  const layoutCtx = createCanvas(1, 1).getContext('2d');
  const rows = notebook.projects.map(project => noteLayout(layoutCtx, project));
  const sheetHeight = 36 + rows.reduce((height, row) => height + row.height, 0);
  const footerY = sheetY + sheetHeight + 18;
  const height = footerY + 57;
  const canvas = createCanvas(width * scale, height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = color.background;
  ctx.fillRect(0, 0, width, height);
  // A faint repeating paper grain is generated once per image with a fixed pattern.
  const tile = createCanvas(43, 41);
  const grain = tile.getContext('2d');
  for (let i = 0; i < 240; i++) {
    grain.fillStyle = i % 2 ? 'rgba(255,255,255,0.20)' : 'rgba(91,76,51,0.045)';
    grain.fillRect((i * 83) % 43, (i * 49) % 41, 1 + i % 3, 0.65);
  }
  ctx.fillStyle = ctx.createPattern(tile, 'repeat');
  ctx.fillRect(0, 0, width, height);
  spine(ctx, height);

  ctx.fillStyle = color.ink;
  ctx.font = font.title;
  ctx.fillText(title, 43, 52);
  ctx.font = font.small;
  ctx.fillStyle = color.muted;
  ctx.fillText(notebook.period, 44, 74);

  paper(ctx, overviewY, overviewHeight);
  rule(ctx, 203, overviewY + 15, 203, overviewY + 62);
  [{ x: 119, number: notebook.projects.length, label: '个工地' },
    { x: 287, number: notebook.withUpdates, label: '个有现场更新' }].forEach(stat => {
    ctx.textAlign = 'center';
    ctx.fillStyle = color.ink;
    ctx.font = font.number;
    ctx.fillText(String(stat.number), stat.x, overviewY + 43);
    ctx.font = font.small;
    ctx.fillText(stat.label, stat.x, overviewY + 62);
  });
  ctx.textAlign = 'left';
  hintRows.forEach((hint, index) => {
    pill(ctx, innerX, overviewY + 70 + index * 27, innerWidth, color[hint.tone],
      hint.tone === 'late' ? color.lateInk : color.pendingInk, hint.text);
  });

  paper(ctx, sheetY, sheetHeight);
  ctx.save();
  ctx.translate(pageX - 4, sheetY + 1);
  ctx.rotate(-0.088);
  ctx.fillStyle = color.cloth;
  ctx.fillRect(0, 0, 131, 28);
  ctx.setLineDash([2, 1.8]);
  ctx.lineWidth = 0.55;
  ctx.strokeStyle = '#aec2a6';
  ctx.strokeRect(3, 3, 125, 22);
  ctx.fillStyle = color.sheet;
  ctx.font = font.tab;
  ctx.fillText('本周工地进展', 11, 20);
  ctx.restore();

  let y = sheetY + 36;
  rows.forEach((row, index) => {
    pill(ctx, innerX + innerWidth - row.badgeWidth, y + 3, row.badgeWidth,
      row.pending ? color.pending : color.stage, row.pending ? color.pendingInk : color.ink, row.badge);
    ctx.fillStyle = color.ink;
    ctx.font = font.name;
    row.nameLines.forEach((line, n) => ctx.fillText(line, innerX, y + 21 + n * 24));
    let baseline = y + row.nameLines.length * 24 + 20;
    ctx.font = font.body;
    row.progressLines.forEach(line => { ctx.fillText(line, innerX, baseline); baseline += 23; });
    ctx.fillStyle = color.muted;
    ctx.font = font.small;
    row.secondary.forEach(line => { ctx.fillText(line, innerX, baseline); baseline += 19; });
    y += row.height;
    if (index < rows.length - 1) rule(ctx, innerX, y - 3, innerX + innerWidth, y - 3);
  });

  ctx.strokeStyle = color.cloth;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.roundRect(pageX, footerY, pageWidth, 39, 6);
  ctx.stroke();
  ctx.fillStyle = color.ink;
  ctx.font = font.small;
  ctx.textAlign = 'center';
  ctx.fillText(footer, pageX + pageWidth / 2, footerY + 25);
  return canvas.toBuffer('image/png');
}
