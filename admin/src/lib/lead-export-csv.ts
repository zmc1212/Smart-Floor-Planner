import { leadToDto } from '@/db/postgres-dto';
import type { LeadWithRelations } from '@/db/repositories/lead-repository';
import { getAssignmentStatusLabel } from '@/lib/lead-assignment-feedback';
import { getLeadSourceLabel } from '@/lib/lead-source-labels';
import { getLeadStatusLabel } from '@/lib/lead-status';

const CSV_HEADERS = [
  '客户称呼',
  '手机号',
  '小区',
  '城市',
  '面积',
  '风格',
  '来源',
  '服务阶段',
  '线索状态',
  '派单状态',
  '推广人',
  '推广人手机',
  '设计师',
  '设计师手机',
  '测量员',
  '测量员手机',
  '预约地址',
  '预约时间',
  '预约状态',
  '签约时间',
  '签约金额',
  '是否归档',
  '创建时间',
] as const;

function formatShanghaiDateTime(value: string | Date | null | undefined) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(date)
    .replace(/\//g, '-');
}

function formatShanghaiDate(value: string | Date | null | undefined) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .replace(/\//g, '-');
}

function staffName(
  value:
    | {
        displayName?: string | null;
        username?: string | null;
      }
    | string
    | null
    | undefined
) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.displayName || value.username || '';
}

function staffPhone(
  value:
    | {
        phone?: string | null;
      }
    | string
    | null
    | undefined
) {
  if (!value || typeof value === 'string') return '';
  return value.phone || '';
}

export function escapeCsvCell(
  value: unknown,
  options: { forceSpreadsheetText?: boolean } = {}
) {
  const raw = value == null ? '' : String(value);
  const text =
    options.forceSpreadsheetText && raw ? `\t${raw}` : raw;
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Column indexes that WPS/Excel must open as text (phones, datetimes, money). */
const SPREADSHEET_TEXT_COLUMN_INDEXES = new Set([
  1, // 手机号
  11, // 推广人手机
  13, // 设计师手机
  15, // 测量员手机
  17, // 预约时间
  19, // 签约时间
  20, // 签约金额
  22, // 创建时间
]);

export function leadRecordToExportRow(record: LeadWithRelations) {
  const dto = leadToDto(record);
  const referrer = dto.referrer as
    | { displayName?: string; username?: string; phone?: string | null }
    | null;
  const assignedTo = dto.assignedTo as
    | { displayName?: string; username?: string; phone?: string | null }
    | string
    | null;
  const measurer = dto.measurerId as
    | { displayName?: string; username?: string; phone?: string | null }
    | string
    | null;

  return [
    dto.name,
    dto.phone || '',
    dto.communityName || '',
    dto.city || '',
    dto.area == null ? '' : dto.area,
    dto.stylePreference || '',
    getLeadSourceLabel(dto.source),
    dto.serviceStageLabel || '',
    getLeadStatusLabel(dto.status),
    getAssignmentStatusLabel(dto.assignmentStatus),
    referrer ? staffName(referrer) : '',
    referrer?.phone || '',
    staffName(assignedTo),
    staffPhone(assignedTo),
    staffName(measurer),
    staffPhone(measurer),
    dto.appointment?.address || '',
    dto.appointment?.timeRange || '',
    dto.appointment?.status || '',
    formatShanghaiDate(dto.convertedOn || dto.convertedAt),
    dto.contractAmount == null ? '' : dto.contractAmount,
    dto.archivedAt ? '是' : '否',
    formatShanghaiDateTime(dto.createdAt),
  ];
}

export function buildLeadsExportCsv(records: LeadWithRelations[]) {
  const lines = [
    CSV_HEADERS.join(','),
    ...records.map((record) =>
      leadRecordToExportRow(record)
        .map((cell, index) =>
          escapeCsvCell(cell, {
            forceSpreadsheetText: SPREADSHEET_TEXT_COLUMN_INDEXES.has(index),
          })
        )
        .join(',')
    ),
  ];
  return `\uFEFF${lines.join('\r\n')}`;
}

export function buildLeadsExportFilename(now = new Date()) {
  const date = formatShanghaiDate(now);
  return `客资导出-${date}.csv`;
}

export { CSV_HEADERS };
