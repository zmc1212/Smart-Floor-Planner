'use client';

import { useCallback, useEffect, useRef, useState, type Key } from 'react';
import {
  PageContainer,
  ProCard,
  ProTable,
  type ActionType,
  type ProColumns,
} from '@ant-design/pro-components';
import {
  Button,
  Alert,
  Checkbox,
  Descriptions,
  Drawer,
  Empty,
  Flex,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Radio,
  Segmented,
  Select,
  Space,
  Steps,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import { Archive, BadgeCheck, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Download, Eye, FilePenLine, LayoutTemplate, MessageSquare, Plus, RotateCcw, Send, Trash2, Trophy, Undo2, Users, XCircle } from 'lucide-react';
import ModuleOverview from '@/components/admin/ModuleOverview';
import { SensitivePasswordModal } from '@/components/admin/sensitive-password-modal';
import { notify } from '@/components/admin/operation-feedback';
import { useConfirmDialog } from '@/components/admin/confirm-dialog';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { getLeadNextAction, getLeadStatusLabel, getLeadWorkflowStep, LEAD_WORKFLOW_STEPS } from '@/lib/lead-status';
import { canRebookAppointment, resolveLeadServiceStage } from '@/lib/lead-service-stage';
import {
  ASSIGNMENT_STATUS_LABELS,
  getAssignmentPendingHint,
  getAssignmentStatusLabel,
  needsStaffWechatForAssignment,
} from '@/lib/lead-assignment-feedback';
import { getLeadSourceLabel } from '@/lib/lead-source-labels';

type StaffReference = {
  _id: string;
  displayName?: string;
  username?: string;
  phone?: string | null;
  role?: string;
};

type FollowUpRecord = {
  content?: string;
  operator?: string;
  createdAt?: string | Date;
};

type FloorPlan = {
  _id: string;
  name?: string | null;
  display?: {
    projectTitle?: string | null;
    projectSubtitle?: string | null;
  } | null;
  source?: string | null;
  createdAt?: string;
  layoutData?: unknown;
  externalSource?: {
    layoutLabel?: string | null;
  } | null;
};

type Lead = {
  _id: string;
  name: string;
  phone?: string | null;
  communityName?: string | null;
  area?: number | null;
  stylePreference?: string | null;
  source?: string | null;
  status: string;
  archivedAt?: string | null;
  archivedBy?: StaffReference | string | null;
  archiveReason?: string | null;
  archiveNote?: string | null;
  convertedOn?: string | null;
  convertedAt?: string | null;
  convertedBy?: StaffReference | string | null;
  contractAmount?: number | null;
  conversionNote?: string | null;
  conversionActions?: {
    canMarkConverted: boolean;
    canRevertConversion: boolean;
  };
  assignmentActions?: {
    canAssignDesigner: boolean;
    canAssignMeasurer: boolean;
  };
  promoterId?: StaffReference | string | null;
  referrer?: StaffReference | string | null;
  assignedTo?: StaffReference | string | null;
  measurerId?: StaffReference | string | null;
  assignmentStatus?: string | null;
  assignmentErrorCode?: string | null;
  serviceStage?: string | null;
  serviceStageLabel?: string | null;
  nextAction?: string | null;
  canRebook?: boolean;
  appointment?: {
    id: string;
    address?: string;
    timeRange?: string;
    status?: string;
    version?: number;
  } | null;
  floorPlanIds?: FloorPlan[];
  primaryFloorPlanId?: FloorPlan | string | null;
  followUpRecords?: FollowUpRecord[];
  createdAt?: string;
  assignmentAudit?: {
    claimWindow?: {
      id: string; status: string; opensAt: string; expiresAt: string;
      claimedByStaffId?: string | null; claimedAt?: string | null; resolvedAt?: string | null;
      resolutionReason?: string | null; assignmentGroup?: string | null;
    } | null;
    events?: Array<{ id: string; eventType: string; designerId?: string | null; measurerId?: string | null; errorCode?: string | null; reason?: string | null; metadata?: Record<string, unknown> | null; createdAt: string }>;
    outcomes?: Array<{ id: string; outcome: string; performanceEligible: boolean; lostReason?: string | null; note?: string | null; designerId?: string | null; outcomeAt: string; invalidatedAt?: string | null }>;
  };
};

type LifecycleImpact = {
  leadId: string;
  unavailable?: boolean;
  floorPlanCount?: number;
  aiWorkflowCount?: number;
  aiGenerationCount?: number;
  inFlightAiCount?: number;
  followUpCount?: number;
  commissionCount?: number;
  canArchive?: boolean;
  archiveBlockers?: string[];
  canPurge?: boolean;
  purgeBlockers?: string[];
};

type ArchiveBatchFailure = {
  leadId: string;
  name: string;
  status: string;
  reason: string;
};

type AppointmentSlot = {
  startAt: string;
  endAt: string;
  measurerId?: string;
  label: string;
};

type AppointmentDateOption = {
  key: string;
  label: string;
};

type AiSchemePublication = {
  id: string;
  workflowId?: string | null;
  title: string;
  publishedAt?: string;
  finalized?: boolean;
  imageCount: number;
  generationIds: string[];
};

type AssignableStaffOption = {
  id: string;
  displayName?: string;
  phone?: string | null;
  roleLabel?: string;
};

const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  confirmed: '已确认',
  completed: '已完成',
  cancelled: '已取消',
  expired: '已过期',
};

const ARCHIVE_REASON_OPTIONS = [
  { label: '无意向', value: 'no_intent' },
  { label: '失联', value: 'lost_contact' },
  { label: '无效联系方式', value: 'invalid_contact' },
  { label: '重复线索', value: 'duplicate' },
  { label: '误录', value: 'mistaken_entry' },
  { label: '其他', value: 'other' },
];

const ARCHIVE_REASON_LABELS = Object.fromEntries(
  ARCHIVE_REASON_OPTIONS.map((item) => [item.value, item.label])
);

const CLOSE_LOST_REASON_OPTIONS = [
  { label: '选择其他公司', value: 'chose_other_company' },
  { label: '预算不符', value: 'budget_mismatch' },
  { label: '装修取消或延期', value: 'renovation_cancelled_or_delayed' },
  { label: '无意向', value: 'no_intent' },
  { label: '长期失联', value: 'long_term_unreachable' },
  { label: '其他（须备注）', value: 'other' },
  { label: '无效联系方式（负责人）', value: 'invalid_contact' },
  { label: '重复线索（负责人）', value: 'duplicate' },
  { label: '误录（负责人）', value: 'mistaken_entry' },
];
const CLOSE_LOST_REASON_LABELS = Object.fromEntries(CLOSE_LOST_REASON_OPTIONS.map((item) => [item.value, item.label.replace(/（.*）/, '')]));
const ASSIGNMENT_EVENT_LABELS: Record<string, string> = {
  claim_opened: '进入抢单池', claim_succeeded: '设计师抢单成功', assignment_auto: '赛马自动派单',
  assignment_auto_pending: '自动派单待补全', assignment_pending: '派单待重试',
  assignment_created: '自动派单完成', assignment_manual: '负责人手动指派', assignment_reassigned: '负责人改派',
};
const CLAIM_WINDOW_STATUS_LABELS: Record<string, string> = {
  open: '开放中', claimed: '已抢单', auto_assigned: '已自动派单', manually_assigned: '已人工指派',
  assignment_pending: '待重试', cancelled: '已取消',
};

type LeadListResponse = {
  success: boolean;
  error?: string;
  data?: Lead[];
  pagination?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
};

const STATUS_OPTIONS = [
  { label: '新线索', value: 'new' },
  { label: '量房中', value: 'measuring' },
  { label: '方案设计', value: 'designing' },
  { label: '已签约', value: 'converted' },
  { label: '已关闭', value: 'closed' },
];

const STATUS_LABELS = Object.fromEntries(
  STATUS_OPTIONS.map((item) => [item.value, item.label])
);

function openAiWorkbench(leadId: string, workflowId?: string) {
  const params = new URLSearchParams();
  params.set('leadId', leadId);
  if (workflowId) params.set('workflowId', workflowId);
  window.open(`/ai-studio/scenarios?${params.toString()}`, '_blank', 'noopener,noreferrer');
}

function getFloorPlanSourceLabel(source?: string | null) {
  if (source === 'kujiale') return '酷家乐';
  if (source === 'template') return '模板';
  return '手动';
}

function getStatusColor(status: string) {
  if (status === 'measuring') return 'green';
  if (['measured', 'assigned', 'designing', 'quoting'].includes(status)) return 'blue';
  if (status === 'converted') return 'orange';
  if (status === 'closed') return 'default';
  return 'cyan';
}

function getStaffName(
  value: StaffReference | string | null | undefined
) {
  if (!value) return '';
  if (typeof value === 'object') return value.displayName || value.username || '';
  return value;
}

function getStaffId(value: StaffReference | string | null | undefined) {
  if (!value) return '';
  if (typeof value === 'object') return value._id || '';
  return value;
}

function canCancelLeadAppointment(lead: Lead, role?: string | null, userId?: string | null) {
  if (!role || !userId || !lead.appointment) return false;
  if (lead.appointment.status !== 'confirmed') return false;
  if (!['designer', 'enterprise_admin'].includes(role)) return false;
  if (role === 'enterprise_admin') return true;
  return getStaffId(lead.assignedTo) === userId;
}

function canCompleteLeadAppointment(lead: Lead, role?: string | null, userId?: string | null) {
  if (!role || !userId || !lead.appointment) return false;
  const status = lead.appointment.status;
  if (status !== 'confirmed' && status !== 'expired') return false;
  if (!['measurer', 'enterprise_admin', 'designer'].includes(role)) return false;
  if (role === 'enterprise_admin') return true;
  return getStaffId(lead.measurerId) === userId;
}

function canManageLeadPublications(lead: Lead, role?: string | null, userId?: string | null) {
  if (!role || !userId || lead.archivedAt) return false;
  if (!['designer', 'enterprise_admin'].includes(role)) return false;
  if (role === 'enterprise_admin') return true;
  return getStaffId(lead.assignedTo) === userId;
}

function canEditLeadProfile(lead: Lead, role?: string | null, userId?: string | null) {
  if (!role || !userId || lead.archivedAt) return false;
  if (['admin', 'super_admin', 'enterprise_admin'].includes(role)) return true;
  if (role === 'designer') return getStaffId(lead.assignedTo) === userId;
  if (role === 'measurer') return getStaffId(lead.measurerId) === userId;
  return false;
}

const LEAD_STYLE_OPTIONS = [
  '现代简约',
  '北欧风格',
  '奶油风',
  '新中式',
  '工业风',
  '法式轻奢',
];

function formatDate(value?: string | Date) {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '-' : parsed.toLocaleString('zh-CN');
}

function formatAppointmentRange(range?: string | null) {
  if (!range) return '';
  const values = range.replace(/^[[(]|[)]]$/g, '').replaceAll('"', '').split(',');
  if (values.length < 2) return range;
  const start = formatDate(values[0]);
  const end = formatDate(values[1]);
  return end === '-' ? start : `${start} - ${end}`;
}

function appointmentDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function appointmentDateOptions(offset: number, maxAdvanceDays: number): AppointmentDateOption[] {
  const count = Math.min(5, Math.max(0, maxAdvanceDays - offset + 1));
  return Array.from({ length: count }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + offset + index);
    return {
      key: appointmentDateKey(date),
      label: offset + index === 0 ? '今天' : offset + index === 1 ? '明天' : `周${'日一二三四五六'[date.getDay()]}`,
    };
  });
}

function appointmentSlotLabel(startAt: string, endAt: string) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '时间待确认';
  const format = (value: Date) => `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  return `${format(start)} - ${format(end)}`;
}

function chinaDateValue() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function formatContractAmount(value?: number | null) {
  if (!value) return '-';
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
  }).format(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseLayoutData(layoutData: unknown): Record<string, unknown> | null {
  if (!layoutData) return null;
  if (typeof layoutData === 'string') {
    try {
      const parsed: unknown = JSON.parse(layoutData);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isRecord(layoutData) ? layoutData : null;
}

function isFormalSurveyPlan(plan: FloorPlan) {
  const layoutData = parseLayoutData(plan.layoutData);
  const surveyGraph = layoutData?.surveyGraph;
  return Boolean(
    layoutData?.version === 4 &&
    layoutData.measurementMode === 'surveying' &&
    isRecord(surveyGraph) &&
    surveyGraph.kind === 'survey-wall-graph'
  );
}

function getSurveyGraphStats(layoutData: unknown) {
  const graph = parseLayoutData(layoutData)?.surveyGraph;
  if (!isRecord(graph)) return { wallCount: 0, spaceCount: 0, openingCount: 0 };
  const floors = Array.isArray(graph.floors) ? graph.floors : [];
  const activeFloor = floors.find((floor) => isRecord(floor) && floor.id === graph.activeFloorId) || floors[0];
  if (!isRecord(activeFloor)) return { wallCount: 0, spaceCount: 0, openingCount: 0 };
  const walls = Array.isArray(activeFloor.walls) ? activeFloor.walls : [];
  const spaces = Array.isArray(activeFloor.spaces) ? activeFloor.spaces : [];
  const openings = Array.isArray(activeFloor.openings) ? activeFloor.openings : [];
  return {
    wallCount: walls.length,
    spaceCount: spaces.filter((space) => isRecord(space) && space.closed === true).length,
    openingCount: openings.length,
  };
}

function LeadsPage() {
  const actionRef = useRef<ActionType>(null);
  const leadListRequestRef = useRef<AbortController | null>(null);
  const leadDetailRequestRef = useRef<AbortController | null>(null);
  const confirmAction = useConfirmDialog();
  const { user: currentUser } = useCurrentUser();
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const selectedLeadRef = useRef<Lead | null>(null);
  selectedLeadRef.current = selectedLead;
  const [newNote, setNewNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [archiveState, setArchiveState] = useState<'active' | 'archived'>('active');
  const [capabilities, setCapabilities] = useState({ canManageArchive: false, canPurge: false });
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [visibleLeads, setVisibleLeads] = useState<Lead[]>([]);
  const [archiveTargets, setArchiveTargets] = useState<Lead[]>([]);
  const [archiveImpacts, setArchiveImpacts] = useState<LifecycleImpact[]>([]);
  const [archiveReason, setArchiveReason] = useState<string>();
  const [archiveNote, setArchiveNote] = useState('');
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveFailures, setArchiveFailures] = useState<ArchiveBatchFailure[]>([]);
  const [purgeTarget, setPurgeTarget] = useState<Lead | null>(null);
  const [purgeImpact, setPurgeImpact] = useState<LifecycleImpact | null>(null);
  const [purgeConfirmation, setPurgeConfirmation] = useState('');
  const [overview, setOverview] = useState({ total: 0, measuring: 0, assigned: 0, converted: 0 });
  const [conversionOpen, setConversionOpen] = useState(false);
  const [conversionDate, setConversionDate] = useState(chinaDateValue());
  const [conversionAmount, setConversionAmount] = useState<number | null>(null);
  const [conversionNote, setConversionNote] = useState('');
  const [conversionSubmitting, setConversionSubmitting] = useState(false);
  const [closeLostOpen, setCloseLostOpen] = useState(false);
  const [closeLostReason, setCloseLostReason] = useState<string>();
  const [closeLostNote, setCloseLostNote] = useState('');
  const [closeLostSubmitting, setCloseLostSubmitting] = useState(false);
  const [reopenSubmitting, setReopenSubmitting] = useState(false);
  const [retryingAssignmentId, setRetryingAssignmentId] = useState<string | null>(null);
  const [staffAssign, setStaffAssign] = useState<{
    lead: Lead;
    role: 'designer' | 'measurer';
  } | null>(null);
  const [staffAssignOptions, setStaffAssignOptions] = useState<AssignableStaffOption[]>([]);
  const [staffAssignSelectedId, setStaffAssignSelectedId] = useState<string>();
  const [staffAssignLoading, setStaffAssignLoading] = useState(false);
  const [staffAssignSubmitting, setStaffAssignSubmitting] = useState(false);
  const [revertConversionOpen, setRevertConversionOpen] = useState(false);
  const [revertReason, setRevertReason] = useState('');
  const [appointmentOpen, setAppointmentOpen] = useState(false);
  const [appointmentAddress, setAppointmentAddress] = useState('');
  const [appointmentSubmitting, setAppointmentSubmitting] = useState(false);
  const [addressOpen, setAddressOpen] = useState(false);
  const [addressLead, setAddressLead] = useState<Lead | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleLead, setRescheduleLead] = useState<Lead | null>(null);
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [slotMode, setSlotMode] = useState<'create' | 'reschedule'>('create');
  const [slotDates, setSlotDates] = useState<AppointmentDateOption[]>([]);
  const [slotDateOffset, setSlotDateOffset] = useState(0);
  const [slotMaxAdvanceDays, setSlotMaxAdvanceDays] = useState(30);
  const [slotDate, setSlotDate] = useState('');
  const [availableSlots, setAvailableSlots] = useState<AppointmentSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<AppointmentSlot | null>(null);
  const [slotLoading, setSlotLoading] = useState(false);
  const [slotError, setSlotError] = useState('');
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [completeSubmitting, setCompleteSubmitting] = useState(false);
  const [publicationLoading, setPublicationLoading] = useState(false);
  const [publicationUpdatingId, setPublicationUpdatingId] = useState<string | null>(null);
  const [publicationFinalizingId, setPublicationFinalizingId] = useState<string | null>(null);
  const [publications, setPublications] = useState<AiSchemePublication[]>([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileSubmitting, setProfileSubmitting] = useState(false);
  const [profileForm, setProfileForm] = useState({
    name: '',
    phone: '',
    communityName: '',
    area: '',
    stylePreference: '',
  });

  useEffect(() => () => {
    leadListRequestRef.current?.abort();
    leadDetailRequestRef.current?.abort();
  }, []);

  useEffect(() => {
    const leadId = new URLSearchParams(window.location.search).get('leadId');
    if (!leadId) return;
    void fetch(`/api/leads/${leadId}`)
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '线索详情加载失败');
        setSelectedLead(result.data);
      })
      .catch((error) => notify.error(error instanceof Error ? error.message : '线索详情加载失败'));
  }, []);

  useEffect(() => {
    void fetch('/api/leads/capabilities')
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '读取线索操作权限失败');
        setCapabilities(result.data);
      })
      .catch((error) => notify.error(error instanceof Error ? error.message : '读取线索操作权限失败'));
  }, []);

  useEffect(() => {
    setSelectedRowKeys([]);
    void actionRef.current?.reload();
  }, [archiveState]);

  const refreshLeads = useCallback(async () => {
    await actionRef.current?.reload();
  }, []);

  const requestLeads = useCallback(async (params: {
    current?: number;
    pageSize?: number;
    status?: string;
    serviceStage?: string;
    assignmentStatus?: string;
  }) => {
    leadListRequestRef.current?.abort();
    const controller = new AbortController();
    leadListRequestRef.current = controller;
    const query = new URLSearchParams({
      page: String(params.current || 1),
      limit: String(params.pageSize || 20),
    });
    if (params.status) query.set('status', String(params.status));
    if (params.serviceStage) query.set('serviceStage', String(params.serviceStage));
    if (params.assignmentStatus) query.set('assignmentStatus', String(params.assignmentStatus));
    query.set('archiveState', archiveState);
    try {
      const response = await fetch(`/api/leads?${query.toString()}`, { signal: controller.signal });
      const result = await response.json() as LeadListResponse;
      if (!response.ok || !result.success) throw new Error(result.error || '线索列表加载失败');
      setVisibleLeads(result.data || []);
      const selectedLeadId = selectedLeadRef.current?._id;
      if (selectedLeadId) {
        const refreshed = result.data?.find((lead) => lead._id === selectedLeadId);
        if (refreshed) setSelectedLead((current) => current ? { ...current, ...refreshed } : current);
      }
      const nextOverview = {
        total: result.data?.length || 0,
        measuring: (result.data || []).filter((lead) => lead.status === 'measuring').length,
        assigned: (result.data || []).filter((lead) => ['measured', 'assigned', 'designing', 'quoting'].includes(lead.status)).length,
        converted: (result.data || []).filter((lead) => lead.status === 'converted').length,
      };
      setOverview((current) => (
        current.total === nextOverview.total &&
        current.measuring === nextOverview.measuring &&
        current.assigned === nextOverview.assigned &&
        current.converted === nextOverview.converted
          ? current
          : nextOverview
      ));
      return {
        data: result.data || [],
        total: result.pagination?.total || 0,
        success: true,
      };
    } catch (error) {
      if (controller.signal.aborted) return { data: [], total: 0, success: false };
      throw error;
    }
  }, [archiveState]);

  const openLeadDetail = async (lead: Lead) => {
    leadDetailRequestRef.current?.abort();
    const controller = new AbortController();
    leadDetailRequestRef.current = controller;
    setSelectedLead(lead);
    setPublications([]);
    try {
      const response = await fetch(`/api/leads/${lead._id}`, { signal: controller.signal });
      const result = await response.json();
      if (!controller.signal.aborted && response.ok && result.success) {
        setSelectedLead(result.data);
        if (canManageLeadPublications(result.data, currentUser?.role, currentUser?._id)) {
          void loadPublications(result.data._id);
        }
      } else if (!controller.signal.aborted) {
        notify.error(result.error || '线索详情加载失败');
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        notify.error(error instanceof Error ? error.message : '线索详情加载失败');
      }
    }
  };

  const loadPublications = async (leadId: string) => {
    setPublicationLoading(true);
    try {
      const response = await fetch(`/api/leads/${leadId}/ai-scheme-publications`);
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '读取方案发布状态失败');
      setPublications(Array.isArray(result.data) ? result.data : []);
    } catch (error) {
      setPublications([]);
      notify.error(error instanceof Error ? error.message : '读取方案发布状态失败');
    } finally {
      setPublicationLoading(false);
    }
  };

  const closeLeadDetail = () => {
    leadDetailRequestRef.current?.abort();
    setSelectedLead(null);
    setNewNote('');
    setConversionOpen(false);
    setRevertConversionOpen(false);
    setRevertReason('');
    setCloseLostOpen(false);
    setCloseLostReason(undefined);
    setCloseLostNote('');
    setAppointmentOpen(false);
    setAddressOpen(false);
    setAddressLead(null);
    setRescheduleOpen(false);
    setRescheduleLead(null);
    setCancelOpen(false);
    setCancelReason('');
    setPublications([]);
  };

  const cancelAppointment = async () => {
    const appointment = selectedLead?.appointment;
    if (!appointment || !cancelReason.trim()) return;
    setCancelSubmitting(true);
    try {
      const response = await fetch(`/api/appointments/${appointment.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: appointment.version, reason: cancelReason.trim() }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '取消预约失败');
      setSelectedLead((current) => current ? {
        ...current,
        appointment: result.data,
        canRebook: true,
        serviceStage: 'awaiting_rebooking',
        serviceStageLabel: '待重新预约',
        nextAction: '选择新时段',
      } : current);
      setCancelOpen(false);
      setCancelReason('');
      notify.success('预约已取消');
      await refreshLeads();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '取消预约失败');
    } finally {
      setCancelSubmitting(false);
    }
  };

  const completeAppointment = async () => {
    const appointment = selectedLead?.appointment;
    if (!appointment) return;
    const confirmed = await confirmAction({
      title: '确认完成量房',
      description: '确认测量员已完成本次上门服务。此操作会结束当前预约，且需要先完成正式量房数据保存。',
      confirmText: '确认完成',
    });
    if (!confirmed) return;
    setCompleteSubmitting(true);
    try {
      const response = await fetch(`/api/appointments/${appointment.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: appointment.version }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        if (result.code === 'appointment_survey_required') {
          throw new Error('请先完成并保存正式量房数据');
        }
        throw new Error(result.error || '完成预约失败');
      }
      setSelectedLead((current) => current ? { ...current, appointment: result.data } : current);
      notify.success('预约已完成');
      await refreshLeads();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '完成预约失败');
    } finally {
      setCompleteSubmitting(false);
    }
  };

  const withdrawScheme = async (scheme: AiSchemePublication) => {
    if (!selectedLead || !scheme.workflowId) return;
    const confirmed = await confirmAction({
      title: '撤回客户方案',
      description: `撤回后，客户将不能继续在项目中查看「${scheme.title}」这套方案。`,
      confirmText: '确认撤回',
      destructive: true,
    });
    if (!confirmed) return;
    setPublicationUpdatingId(scheme.id);
    try {
      const response = await fetch(`/api/leads/${selectedLead._id}/ai-scheme-publications/${scheme.workflowId}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '撤回方案失败');
      notify.success('方案已撤回');
      await loadPublications(selectedLead._id);
      await refreshLeads();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '撤回方案失败');
    } finally {
      setPublicationUpdatingId(null);
    }
  };

  const finalizeScheme = async (scheme: AiSchemePublication) => {
    if (!selectedLead || !scheme.workflowId || scheme.finalized) return;
    const confirmed = await confirmAction({
      title: '设为定稿',
      description: `客户档案与方案册将优先展示「${scheme.title}」。定稿后仍可继续出图和更新方案，直到您改指定稿或撤回该套方案。`,
      confirmText: '确认定稿',
    });
    if (!confirmed) return;
    setPublicationFinalizingId(scheme.id);
    try {
      const response = await fetch(
        `/api/leads/${selectedLead._id}/ai-scheme-publications/${scheme.workflowId}/finalize`,
        { method: 'POST' },
      );
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '定稿方案失败');
      notify.success('已设为定稿');
      await loadPublications(selectedLead._id);
      await refreshLeads();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '定稿方案失败');
    } finally {
      setPublicationFinalizingId(null);
    }
  };

  const openStaffAssign = async (lead: Lead, role: 'designer' | 'measurer') => {
    setStaffAssign({ lead, role });
    setStaffAssignSelectedId(undefined);
    setStaffAssignOptions([]);
    setStaffAssignLoading(true);
    try {
      const response = await fetch(`/api/leads/${lead._id}/assignable-staff?role=${encodeURIComponent(role)}`);
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '读取可派人员失败');
      setStaffAssignOptions(Array.isArray(result.data?.items) ? result.data.items : []);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '读取可派人员失败');
      setStaffAssign(null);
    } finally {
      setStaffAssignLoading(false);
    }
  };

  const submitStaffAssign = async () => {
    if (!staffAssign || !staffAssignSelectedId) return;
    setStaffAssignSubmitting(true);
    try {
      const payload = staffAssign.role === 'designer'
        ? { designerId: staffAssignSelectedId }
        : { measurerId: staffAssignSelectedId };
      const response = await fetch(`/api/leads/${staffAssign.lead._id}/assign-staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '派单失败');
      notify.success(staffAssign.role === 'designer' ? '设计师已更新' : '测量员已更新');
      if (selectedLead?._id === staffAssign.lead._id && result.data) {
        setSelectedLead((current) => current ? { ...current, ...result.data } : current);
      }
      setStaffAssign(null);
      setStaffAssignSelectedId(undefined);
      await refreshLeads();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '派单失败');
    } finally {
      setStaffAssignSubmitting(false);
    }
  };

  const retryAssignment = async (lead: Lead) => {
    setRetryingAssignmentId(lead._id);
    try {
      const response = await fetch(`/api/leads/${lead._id}/retry-assignment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'admin_retry_from_leads' }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '派单重试失败');
      const nextStatus = result.data?.assignmentStatus as string | undefined;
      const nextErrorCode = (result.data?.assignmentErrorCode as string | null | undefined) ?? null;
      if (nextStatus === 'assigned') {
        notify.success('派单已成功');
      } else {
        const reason = getAssignmentStatusLabel('assignment_pending', nextErrorCode);
        notify.warning(`派单未完成：${reason}`, {
          description: getAssignmentPendingHint(nextErrorCode),
          duration: 6000,
        });
      }
      if (selectedLead?._id === lead._id && result.data) {
        setSelectedLead((current) => current ? { ...current, ...result.data } : current);
      }
      await refreshLeads();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '派单重试失败');
    } finally {
      setRetryingAssignmentId(null);
    }
  };

  const createAppointment = async () => {
    if (!selectedLead || !selectedSlot || !appointmentAddress.trim()) return;
    setAppointmentSubmitting(true);
    try {
      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: selectedLead._id, startAt: selectedSlot.startAt, endAt: selectedSlot.endAt, address: appointmentAddress.trim() }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '创建预约失败');
      const appointment = result.data;
      const stage = resolveLeadServiceStage({
        leadStatus: selectedLead.status,
        assignmentStatus: selectedLead.assignmentStatus,
        measurerId: getStaffId(selectedLead.measurerId),
        appointment,
      });
      setSelectedLead((current) => current ? {
        ...current,
        appointment,
        serviceStage: stage.key,
        serviceStageLabel: stage.label,
        nextAction: stage.nextAction,
        canRebook: canRebookAppointment({
          leadStatus: current.status,
          assignmentStatus: current.assignmentStatus,
          appointment,
        }),
      } : current);
      setAppointmentOpen(false);
      notify.success('预约上门量房时间已设置');
      await refreshLeads();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '创建预约失败');
    } finally {
      setAppointmentSubmitting(false);
    }
  };

  const loadAvailableSlots = async (leadId: string, date: string, offset = slotDateOffset) => {
    if (!leadId || !date) return;
    setSlotLoading(true);
    setSlotError('');
    setSelectedSlot(null);
    try {
      const response = await fetch(`/api/appointments/availability?leadId=${encodeURIComponent(leadId)}&date=${encodeURIComponent(date)}`);
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '可用时段加载失败');
      const maxAdvanceDays = Number(result.data?.maxAdvanceDays);
      const nextMaxAdvanceDays = Number.isInteger(maxAdvanceDays) ? maxAdvanceDays : slotMaxAdvanceDays;
      const slots = (result.data?.slots || []).map((slot: { startAt: string; endAt: string; measurerId?: string }) => ({
        ...slot,
        label: appointmentSlotLabel(slot.startAt, slot.endAt),
      }));
      setSlotMaxAdvanceDays(nextMaxAdvanceDays);
      setSlotDates(appointmentDateOptions(offset, nextMaxAdvanceDays));
      setAvailableSlots(slots);
    } catch (error) {
      setAvailableSlots([]);
      setSlotError(error instanceof Error ? error.message : '可用时段加载失败');
    } finally {
      setSlotLoading(false);
    }
  };

  const openSlotPicker = (mode: 'create' | 'reschedule', leadId: string) => {
    const dates = appointmentDateOptions(0, 30);
    setSlotMode(mode);
    setSlotDateOffset(0);
    setSlotMaxAdvanceDays(30);
    setSlotDates(dates);
    setSlotDate(dates[0]?.key || '');
    setAvailableSlots([]);
    setSelectedSlot(null);
    setSlotError('');
    void loadAvailableSlots(leadId, dates[0]?.key || '', 0);
  };

  const chooseSlotDate = (date: string, offset = slotDateOffset) => {
    setSlotDate(date);
    const leadId = slotMode === 'reschedule' ? rescheduleLead?._id : selectedLead?._id;
    if (leadId) void loadAvailableSlots(leadId, date, offset);
  };

  const shiftSlotDates = (direction: -1 | 1) => {
    const nextOffset = slotDateOffset + direction * 5;
    if (nextOffset < 0 || nextOffset > slotMaxAdvanceDays) return;
    const dates = appointmentDateOptions(nextOffset, slotMaxAdvanceDays);
    if (!dates.length) return;
    setSlotDateOffset(nextOffset);
    setSlotDates(dates);
    chooseSlotDate(dates[0].key, nextOffset);
  };

  const openAppointmentPicker = (lead: Lead) => {
    setAppointmentAddress(lead.communityName || '');
    setAppointmentOpen(true);
    openSlotPicker('create', lead._id);
  };

  const openReschedule = (lead: Lead) => {
    if (!lead.appointment) return;
    setRescheduleLead(lead);
    setRescheduleReason('客户已确认新的上门时间');
    setRescheduleOpen(true);
    openSlotPicker('reschedule', lead._id);
  };

  const openAddressEditor = (lead: Lead) => {
    if (!lead.appointment) return;
    setAddressLead(lead);
    setAppointmentAddress(lead.appointment.address || lead.communityName || '');
    setAddressOpen(true);
  };

  const updateAppointmentAddress = async () => {
    const appointment = addressLead?.appointment;
    if (!appointment || !appointmentAddress.trim()) return;
    setAppointmentSubmitting(true);
    try {
      const response = await fetch(`/api/appointments/${appointment.id}/address`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: appointmentAddress.trim(), version: appointment.version }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '更新服务地址失败');
      setSelectedLead((current) => current ? { ...current, appointment: result.data } : current);
      setAddressOpen(false);
      setAddressLead(null);
      notify.success('服务地址已更新');
      await refreshLeads();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '更新服务地址失败');
    } finally {
      setAppointmentSubmitting(false);
    }
  };

  const rescheduleAppointment = async () => {
    const appointment = rescheduleLead?.appointment;
    if (!appointment || !selectedSlot || !rescheduleReason.trim()) return;
    setAppointmentSubmitting(true);
    try {
      const response = await fetch(`/api/appointments/${appointment.id}/internal-reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startAt: selectedSlot.startAt,
          endAt: selectedSlot.endAt,
          version: appointment.version,
          reason: rescheduleReason.trim(),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '修改预约失败');
      setSelectedLead((current) => current ? { ...current, appointment: result.data } : current);
      setRescheduleOpen(false);
      setRescheduleLead(null);
      notify.success('预约时间已修改，并已记录交接原因');
      await refreshLeads();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '修改预约失败');
    } finally {
      setAppointmentSubmitting(false);
    }
  };

  const updateLead = async (
    leadId: string,
    updates: Record<string, unknown>,
    closeAfterSuccess = false
  ) => {
    try {
      const response = await fetch(`/api/leads/${leadId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '线索更新失败');
      setSelectedLead(result.data);
      notify.success('线索信息已更新');
      await refreshLeads();
      if (closeAfterSuccess) closeLeadDetail();
      return true;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '线索更新失败');
      return false;
    }
  };

  const openProfileEditor = (lead: Lead) => {
    setProfileForm({
      name: lead.name || '',
      phone: lead.phone || '',
      communityName: lead.communityName || '',
      area: lead.area ? String(lead.area) : '',
      stylePreference: lead.stylePreference || '',
    });
    setProfileOpen(true);
  };

  const saveLeadProfile = async () => {
    if (!selectedLead || profileSubmitting) return;
    const name = profileForm.name.trim();
    const phone = profileForm.phone.trim();
    const communityName = profileForm.communityName.trim();
    if (!name) {
      notify.error('请输入客户称呼');
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      notify.error('请输入有效的手机号');
      return;
    }
    if (!communityName) {
      notify.error('请输入小区名称');
      return;
    }
    const areaValue = profileForm.area.trim();
    const area = areaValue ? Number(areaValue) : null;
    if (areaValue && (area === null || !Number.isFinite(area) || area <= 0)) {
      notify.error('请输入有效的房屋面积');
      return;
    }
    setProfileSubmitting(true);
    try {
      const succeeded = await updateLead(selectedLead._id, {
        name,
        phone,
        communityName,
        area: area ?? null,
        stylePreference: profileForm.stylePreference.trim() || null,
      });
      if (succeeded) setProfileOpen(false);
    } finally {
      setProfileSubmitting(false);
    }
  };

  const openArchive = async (targets: Lead[]) => {
    if (!targets.length || archiveLoading) return;
    if (targets.length > 100) {
      notify.error('每次最多归档 100 条客户线索');
      return;
    }
    setArchiveLoading(true);
    try {
      const response = await fetch('/api/leads/archive-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: targets.map((lead) => lead._id) }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '归档预检失败');
      setArchiveTargets(targets);
      setArchiveImpacts(result.data || []);
      setArchiveReason(undefined);
      setArchiveNote('');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '归档预检失败');
    } finally {
      setArchiveLoading(false);
    }
  };

  const archiveLeads = async () => {
    if (!archiveReason || !archiveTargets.length) return;
    setArchiveLoading(true);
    try {
      const response = await fetch('/api/leads/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: archiveTargets.map((lead) => lead._id),
          reason: archiveReason,
          note: archiveNote,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '归档失败');
      const resultItems = (result.data || []) as Array<{
        leadId: string;
        status: string;
        impact?: LifecycleImpact;
      }>;
      const archivedCount = resultItems.filter((item) => item.status === 'archived').length;
      const failures = resultItems
        .filter((item) => item.status !== 'archived')
        .map((item) => ({
          leadId: item.leadId,
          name: archiveTargets.find((lead) => lead._id === item.leadId)?.name || `线索 ${item.leadId}`,
          status: item.status,
          reason: item.status === 'blocked'
            ? (item.impact?.archiveBlockers || ['存在运行中的 AI 任务']).join('；')
            : item.status === 'already_archived'
              ? '线索已归档，无需重复处理'
              : '无权访问或线索已不存在',
        }));
      const blockedCount = failures.length;
      if (archivedCount) notify.success(`已归档 ${archivedCount} 条客户线索`);
      if (blockedCount) {
        setArchiveFailures(failures);
        notify.error(`${blockedCount} 条线索未处理，已列出具体原因`);
      }
      if (selectedLead && archiveTargets.some((lead) => lead._id === selectedLead._id)) closeLeadDetail();
      setArchiveTargets([]);
      setArchiveImpacts([]);
      setSelectedRowKeys([]);
      await refreshLeads();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '归档失败');
    } finally {
      setArchiveLoading(false);
    }
  };

  const restoreLead = async (lead: Lead) => {
    if (deletingId) return;
    const confirmed = await confirmAction({
      title: '恢复客户线索',
      description: `恢复“${lead.name}”后，将重新出现在业务列表并可继续跟进。`,
      confirmText: '恢复',
    });
    if (!confirmed) return;
    setDeletingId(lead._id);
    try {
      const response = await fetch(`/api/leads/${lead._id}/restore`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '恢复失败');
      if (selectedLead?._id === lead._id) closeLeadDetail();
      notify.success('客户线索已恢复');
      await refreshLeads();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '恢复失败');
    } finally {
      setDeletingId(null);
    }
  };

  const openPurge = async (lead: Lead) => {
    if (deletingId) return;
    setDeletingId(lead._id);
    try {
      const response = await fetch(`/api/leads/${lead._id}/purge-preview`);
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '删除预检失败');
      setPurgeTarget(lead);
      setPurgeImpact(result.data);
      setPurgeConfirmation('');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '删除预检失败');
    } finally {
      setDeletingId(null);
    }
  };

  const purgeLead = async () => {
    if (!purgeTarget || purgeConfirmation !== purgeTarget.name || !purgeImpact?.canPurge) return;
    setDeletingId(purgeTarget._id);
    try {
      const response = await fetch(`/api/leads/${purgeTarget._id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmName: purgeConfirmation }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error([result.error, ...(result.blockers || [])].filter(Boolean).join('：'));
      if (selectedLead?._id === purgeTarget._id) closeLeadDetail();
      setPurgeTarget(null);
      setPurgeImpact(null);
      notify.success('空白客户线索已永久删除');
      await refreshLeads();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '永久删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  const addFollowUp = async () => {
    if (!newNote.trim() || !selectedLead) return;
    setIsSubmitting(true);
    const records = [
      ...(selectedLead.followUpRecords || []),
      { content: newNote.trim(), operator: '管理员', createdAt: new Date().toISOString() },
    ];
    const succeeded = await updateLead(selectedLead._id, { followUpRecords: records });
    if (succeeded) setNewNote('');
    setIsSubmitting(false);
  };

  const openConversion = () => {
    setConversionDate(chinaDateValue());
    setConversionAmount(null);
    setConversionNote('');
    setConversionOpen(true);
  };

  const markConverted = async () => {
    if (!selectedLead || !conversionDate || conversionSubmitting) return;
    setConversionSubmitting(true);
    try {
      const response = await fetch(`/api/leads/${selectedLead._id}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          convertedOn: conversionDate,
          contractAmount: conversionAmount,
          conversionNote,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '标记已签约失败');
      setSelectedLead(result.data);
      setConversionOpen(false);
      notify.success('客户已标记为已签约');
      await refreshLeads();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '标记已签约失败');
    } finally {
      setConversionSubmitting(false);
    }
  };

  const revertConversion = async () => {
    if (!selectedLead || !revertReason.trim() || conversionSubmitting) return;
    setConversionSubmitting(true);
    try {
      const response = await fetch(`/api/leads/${selectedLead._id}/revert-conversion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: revertReason.trim() }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '撤销签约标记失败');
      setSelectedLead(result.data);
      setRevertConversionOpen(false);
      setRevertReason('');
      notify.success('签约标记已撤销');
      await refreshLeads();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '撤销签约标记失败');
    } finally {
      setConversionSubmitting(false);
    }
  };

  const closeLost = async () => {
    if (!selectedLead || !closeLostReason || closeLostSubmitting) return;
    if (closeLostReason === 'other' && !closeLostNote.trim()) {
      notify.error('选择“其他”时必须填写备注');
      return;
    }
    setCloseLostSubmitting(true);
    try {
      const response = await fetch(`/api/leads/${selectedLead._id}/close-lost`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: closeLostReason, note: closeLostNote.trim() }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '未签单结案失败');
      setCloseLostOpen(false);
      setCloseLostReason(undefined);
      setCloseLostNote('');
      notify.success('线索已按经营结果结案');
      await refreshLeads();
      await openLeadDetail({ ...selectedLead, status: 'closed' });
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '未签单结案失败');
    } finally { setCloseLostSubmitting(false); }
  };

  const reopenLost = async () => {
    if (!selectedLead || reopenSubmitting) return;
    setReopenSubmitting(true);
    try {
      const response = await fetch(`/api/leads/${selectedLead._id}/reopen`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: '企业负责人重新激活' }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '重新激活失败');
      notify.success('线索已恢复到结案前阶段');
      await refreshLeads();
      await openLeadDetail({ ...selectedLead, status: result.data.status });
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '重新激活失败');
    } finally { setReopenSubmitting(false); }
  };

  const columns: ProColumns<Lead>[] = [
    {
      title: '服务阶段',
      dataIndex: 'serviceStage',
      valueType: 'select',
      valueEnum: {
        claimed: '新线索',
        assignment_pending: '待派单',
        measurer_assigned: '已匹配测量员',
        appointment_confirmed: '已预约',
        appointment_in_progress: '上门中',
        appointment_expired: '已过期',
        awaiting_rebooking: '待重约',
        survey_ready: '待确认完成',
        survey_completed: '量房完成',
        design_published: '方案已发布',
        converted: '已签约',
        closed: '已关闭',
      },
      width: 150,
      render: (_, lead) => <Tag color={getStatusColor(lead.status)}>{lead.serviceStageLabel || getLeadStatusLabel(lead.status)}</Tag>,
    },
    {
      title: '业务状态',
      dataIndex: 'status',
      valueType: 'select',
      valueEnum: STATUS_LABELS,
      hideInTable: true,
    },
    {
      title: '客户 / 小区',
      dataIndex: 'name',
      hideInSearch: true,
      width: 250,
      render: (_, lead) => (
        <Flex vertical gap={2}>
          <Typography.Text strong>{lead.name}</Typography.Text>
          <Typography.Text type="secondary" className="text-xs" ellipsis={{ tooltip: lead.communityName || '未记录小区' }}>
            {lead.communityName || '未记录小区'}
          </Typography.Text>
        </Flex>
      ),
    },
    {
      title: '联系电话',
      dataIndex: 'phone',
      hideInSearch: true,
      width: 165,
      render: (phone) => <Typography.Text code>{phone || '-'}</Typography.Text>,
    },
    {
      title: '推广人 / 渠道人员',
      key: 'promoter',
      hideInSearch: true,
      width: 170,
      render: (_, lead) => lead.source === 'referrer_network'
        ? getStaffName(lead.referrer) || '未识别推广人'
        : getStaffName(lead.promoterId) || '系统录入',
    },
    {
      title: '绑定设计师',
      key: 'assignee',
      hideInSearch: true,
      width: 180,
      render: (_, lead) => getStaffName(lead.assignedTo) || '未绑定设计师',
    },
    {
      title: '派单',
      dataIndex: 'assignmentStatus',
      valueType: 'select',
      valueEnum: ASSIGNMENT_STATUS_LABELS,
      hideInTable: true,
    },
    {
      title: '量房安排',
      key: 'survey-assignment',
      hideInSearch: true,
      width: 260,
      render: (_, lead) => (
        <Flex vertical gap={4}>
          <Typography.Text>{getStaffName(lead.measurerId) || '未绑定测量员'}</Typography.Text>
          {lead.appointment ? <><Typography.Text type="secondary" className="text-xs">{formatAppointmentRange(lead.appointment.timeRange)}</Typography.Text><Typography.Text type="secondary" className="text-xs" ellipsis={{ tooltip: lead.appointment.address || '地址待确认' }}>{lead.appointment.address || '地址待确认'}</Typography.Text></> : <Typography.Text type="secondary" className="text-xs">尚未预约上门</Typography.Text>}
        </Flex>
      ),
    },
    {
      title: '提交日期',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      hideInSearch: true,
      width: 190,
      render: (_, lead) => formatDate(lead.createdAt),
    },
    ...(archiveState === 'archived' ? [{
      title: '归档信息',
      key: 'archive',
      hideInSearch: true,
      width: 210,
      render: (_: unknown, lead: Lead) => (
        <Flex vertical gap={2}>
          <Typography.Text>{ARCHIVE_REASON_LABELS[lead.archiveReason || ''] || '其他'}</Typography.Text>
          <Typography.Text type="secondary" className="text-xs">{formatDate(lead.archivedAt || undefined)}</Typography.Text>
        </Flex>
      ),
    } satisfies ProColumns<Lead>] : []),
    {
      title: '操作',
      key: 'actions',
      valueType: 'option',
      fixed: 'right',
      width: 285,
      hideInSearch: true,
      render: (_, lead) => (
        <Space size={8}>
          <Button size="small" icon={<Eye size={14} />} onClick={() => void openLeadDetail(lead)}>
            详情
          </Button>
          {archiveState === 'active' ? (
            <>
              <Button size="small" icon={<FilePenLine size={14} />} onClick={() => openAiWorkbench(lead._id)}>
                {lead.floorPlanIds?.length || lead.followUpRecords?.length ? '查看方案' : '开始方案'}
              </Button>
              {capabilities.canManageArchive ? (
                <Button size="small" disabled={archiveLoading} loading={archiveLoading && archiveTargets.some((item) => item._id === lead._id)} icon={<Archive size={14} />} onClick={() => void openArchive([lead])}>
                  归档
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <Button size="small" disabled={Boolean(deletingId)} loading={deletingId === lead._id} icon={<RotateCcw size={14} />} onClick={() => void restoreLead(lead)}>
                恢复
              </Button>
              {capabilities.canPurge ? (
                <Button size="small" danger disabled={Boolean(deletingId)} loading={deletingId === lead._id} icon={<Trash2 size={14} />} onClick={() => void openPurge(lead)}>
                  永久删除
                </Button>
              ) : null}
            </>
          )}
        </Space>
      ),
    },
  ];

  const renderSlotPicker = () => (
    <Flex vertical gap={14}>
      <Flex vertical gap={6}>
        <Typography.Text strong>选择日期</Typography.Text>
        <Flex align="center" gap={6}>
          <Button
            type="text"
            size="small"
            icon={<ChevronLeft size={16} />}
            disabled={slotDateOffset === 0 || slotLoading}
            aria-label="查看更早日期"
            onClick={() => shiftSlotDates(-1)}
          />
          <Segmented
            block
            style={{ flex: 1, minWidth: 0 }}
            value={slotDate}
            options={slotDates.map((item) => ({
              value: item.key,
              label: <Flex vertical align="center" gap={1}><Typography.Text>{item.label}</Typography.Text><Typography.Text type="secondary" className="text-xs">{item.key.slice(5)}</Typography.Text></Flex>,
            }))}
            onChange={(value) => chooseSlotDate(String(value))}
          />
          <Button
            type="text"
            size="small"
            icon={<ChevronRight size={16} />}
            disabled={slotDateOffset + slotDates.length > slotMaxAdvanceDays || slotLoading}
            aria-label="查看后续日期"
            onClick={() => shiftSlotDates(1)}
          />
        </Flex>
      </Flex>
      <Flex vertical gap={6}>
        <Typography.Text strong>选择可用时段</Typography.Text>
        {slotLoading ? <Typography.Text type="secondary">正在计算测量员可用时段…</Typography.Text> : null}
        {slotError ? <Alert showIcon type="warning" message={slotError} /> : null}
        {!slotLoading && !slotError && availableSlots.length ? (
          <Radio.Group
            value={selectedSlot?.startAt}
            optionType="button"
            buttonStyle="solid"
            onChange={(event) => setSelectedSlot(availableSlots.find((slot) => slot.startAt === event.target.value) || null)}
          >
            <Flex gap={8} wrap>
              {availableSlots.map((slot) => <Radio key={slot.startAt} value={slot.startAt}>{slot.label}</Radio>)}
            </Flex>
          </Radio.Group>
        ) : null}
        {!slotLoading && !slotError && !availableSlots.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当天暂无可用时段" /> : null}
      </Flex>
    </Flex>
  );

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="客资线索管理"
        content="跟进客户状态、查看协作归属，并衔接正式量房与方案设计。"
      >
        <ModuleOverview
          ariaLabel="线索概览"
          items={[
            { label: '本页线索', value: overview.total, icon: <Users size={18} /> },
            { label: '本页量房中', value: overview.measuring, icon: <ClipboardCheck size={18} />, tone: 'warning' },
            { label: '本页方案设计', value: overview.assigned, icon: <LayoutTemplate size={18} />, tone: 'success' },
            { label: '本页已签约', value: overview.converted, icon: <ClipboardCheck size={18} />, tone: 'success' },
          ]}
        />
        <ProTable<Lead>
          className="admin-data-table admin-mobile-filter-stack"
          actionRef={actionRef}
          rowKey="_id"
          columns={columns}
          search={{ labelWidth: 'auto', defaultCollapsed: false, span: 12 }}
          options={{ reload: true, density: true, setting: true }}
          toolBarRender={() => [
            currentUser?.role === 'enterprise_admin' ? (
              <Button
                key="export-leads"
                icon={<Download size={16} />}
                onClick={() => setExportModalOpen(true)}
              >
                导出客资
              </Button>
            ) : null,
            capabilities.canManageArchive ? (
              <Segmented
                key="archive-state"
                value={archiveState}
                options={[
                  { label: '在用线索', value: 'active' },
                  { label: '已归档', value: 'archived' },
                ]}
                onChange={(value) => setArchiveState(value as 'active' | 'archived')}
              />
            ) : null,
            archiveState === 'active' && capabilities.canManageArchive ? (
              <Button
                key="batch-archive"
                icon={<Archive size={16} />}
                disabled={!selectedRowKeys.length || archiveLoading}
                loading={archiveLoading}
                onClick={() => void openArchive(visibleLeads.filter((lead) => selectedRowKeys.includes(lead._id)))}
              >
                归档所选（{selectedRowKeys.length}）
              </Button>
            ) : null,
          ].filter(Boolean)}
          rowSelection={archiveState === 'active' && capabilities.canManageArchive ? {
            selectedRowKeys,
            preserveSelectedRowKeys: false,
            onChange: setSelectedRowKeys,
          } : false}
          pagination={{ defaultPageSize: 20, showSizeChanger: true }}
          cardProps={false}
          tableViewRender={(tableProps) => {
            const rows = (tableProps.dataSource || []) as Lead[];
            const pagination = tableProps.pagination;
            const rowSelection = tableProps.rowSelection;
            return (
              <Flex
                vertical
                className="lead-card-list"
                style={{ gap: 16, padding: 16, background: 'color-mix(in oklab, var(--muted) 52%, var(--card))' }}
              >
                {tableProps.loading ? (
                  <ProCard bordered loading bodyStyle={{ minHeight: 120 }} />
                ) : rows.length ? rows.map((lead) => {
                  const isSelected = Boolean(rowSelection?.selectedRowKeys?.some((key) => String(key) === lead._id));
                  const toggleSelection = (checked: boolean) => {
                    if (!rowSelection?.onChange) return;
                    const currentKeys = (rowSelection.selectedRowKeys || []).map((key) => String(key));
                    const nextKeys = checked
                      ? [...new Set([...currentKeys, lead._id])]
                      : currentKeys.filter((key) => key !== lead._id);
                    const nextRows = rows.filter((item) => nextKeys.includes(item._id));
                    rowSelection.onChange(nextKeys, nextRows, { type: 'all' });
                  };
                  return (
                    <ProCard
                      key={lead._id}
                      bordered
                      className="lead-record-card"
                      bodyStyle={{ padding: 0 }}
                    >
                      <Flex vertical>
                        <Flex
                          align="start"
                          justify="space-between"
                          gap={16}
                          wrap
                          className="border-b border-border bg-muted/35 px-5 py-4"
                          style={{ gap: 16, padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'color-mix(in oklab, var(--muted) 35%, var(--card))' }}
                        >
                          <Flex align="start" gap={12} className="min-w-0" style={{ gap: 12 }}>
                            {rowSelection ? <Checkbox checked={isSelected} onChange={(event) => toggleSelection(event.target.checked)} aria-label={`选择${lead.name}`} /> : null}
                            <Flex vertical gap={6} className="min-w-0" style={{ gap: 8 }}>
                              <Flex align="center" gap={8} wrap style={{ gap: 12 }}>
                                <Typography.Title level={5} className="!mb-0">{lead.name}</Typography.Title>
                                <Tag color={getStatusColor(lead.status)} style={{ marginInlineStart: 4 }}>{lead.serviceStageLabel || getLeadStatusLabel(lead.status)}</Tag>
                              </Flex>
                              <Flex gap={12} wrap style={{ gap: 16 }}>
                                <Typography.Text type="secondary">{lead.phone || '暂无联系电话'}</Typography.Text>
                                <Typography.Text type="secondary" ellipsis={{ tooltip: lead.communityName || '未记录小区' }}>
                                  {lead.communityName || '未记录小区'}
                                </Typography.Text>
                              </Flex>
                              <Flex gap={6} wrap style={{ gap: 8, marginTop: 2 }}>
                                <Tag bordered={false} className="!m-0">{getLeadSourceLabel(lead.source)}</Tag>
                                {lead.area ? <Tag bordered={false} className="!m-0">{lead.area} ㎡</Tag> : null}
                                {lead.stylePreference ? <Tag bordered={false} className="!m-0">{lead.stylePreference}</Tag> : null}
                              </Flex>
                            </Flex>
                          </Flex>
                          <Flex align="center" wrap style={{ gap: 12 }}>
                            <Button size="small" icon={<Eye size={14} />} onClick={() => void openLeadDetail(lead)}>详情</Button>
                            {archiveState === 'active' ? (
                              <Button type="primary" size="small" icon={<FilePenLine size={14} />} onClick={() => openAiWorkbench(lead._id)}>
                                {lead.floorPlanIds?.length || lead.followUpRecords?.length ? '查看方案' : '开始方案'}
                              </Button>
                            ) : null}
                          </Flex>
                        </Flex>

                        <div className="grid gap-5 px-5 py-5 xl:grid-cols-[minmax(0,1fr)_minmax(17rem,0.7fr)]" style={{ gap: 20, padding: 20 }}>
                          <Flex vertical gap={10} className="min-w-0" style={{ gap: 12 }}>
                            <Flex align="center" justify="space-between" gap={12} wrap style={{ gap: 12 }}>
                              <Typography.Text strong>当前转化进度</Typography.Text>
                              <Typography.Text type="secondary" className="text-xs">下一步：{lead.nextAction || getLeadNextAction(lead.status)}</Typography.Text>
                            </Flex>
                            <Steps
                              size="small"
                              current={getLeadWorkflowStep(lead.status)}
                              items={LEAD_WORKFLOW_STEPS.map((title) => ({ title }))}
                            />
                          </Flex>

                          <Flex vertical gap={5} className="min-w-0 border-l-0 border-border/80 pl-0 xl:border-l xl:pl-5" style={{ gap: 8, borderLeft: '1px solid var(--border)', paddingLeft: 20 }}>
                            <Typography.Text type="secondary" className="text-xs">上门量房</Typography.Text>
                            <Typography.Text strong ellipsis={{ tooltip: lead.appointment ? formatAppointmentRange(lead.appointment.timeRange) : '尚未预约' }}>
                              {lead.appointment ? formatAppointmentRange(lead.appointment.timeRange) : '尚未预约'}
                            </Typography.Text>
                            <Typography.Text type="secondary" className="text-xs" ellipsis={{ tooltip: lead.appointment?.address || (lead.appointment ? '地址待确认' : '可在详情中设置') }}>
                              {lead.appointment?.address || (lead.appointment ? '地址待确认' : '可在详情中设置')}
                            </Typography.Text>
                            {archiveState === 'active' && lead.appointment?.status === 'confirmed' && !lead.canRebook ? (
                              <Button size="small" icon={<CalendarDays size={14} />} className="mt-1 self-start" onClick={() => openReschedule(lead)}>改预约</Button>
                            ) : null}
                          </Flex>
                        </div>

                        <div className="grid grid-cols-1 gap-x-5 gap-y-4 border-t border-border px-5 py-4 sm:grid-cols-2 xl:grid-cols-4" style={{ columnGap: 20, rowGap: 16, padding: '16px 20px', borderTop: '1px solid var(--border)' }}>
                          <LeadStaffCardField
                            label={lead.source === 'referrer_network' ? '推广人' : '渠道人员'}
                            staff={lead.source === 'referrer_network' ? lead.referrer : lead.promoterId}
                            fallback={lead.source === 'referrer_network' ? '未识别推广人' : '系统录入'}
                          />
                          <LeadStaffCardField
                            label="绑定设计师"
                            staff={lead.assignedTo}
                            fallback="未绑定设计师"
                            canAssign={Boolean(lead.assignmentActions?.canAssignDesigner)}
                            onAssign={() => void openStaffAssign(lead, 'designer')}
                          />
                          <LeadStaffCardField
                            label="测量员"
                            staff={lead.measurerId}
                            fallback="未绑定测量员"
                            canAssign={Boolean(lead.assignmentActions?.canAssignMeasurer)}
                            onAssign={() => void openStaffAssign(lead, 'measurer')}
                          />
                          <LeadCardField
                            label="派单状态"
                            value={getAssignmentStatusLabel(lead.assignmentStatus, lead.assignmentErrorCode)}
                            detail={
                              lead.assignmentStatus === 'assignment_pending'
                                ? getAssignmentPendingHint(lead.assignmentErrorCode)
                                : undefined
                            }
                          />
                        </div>

                        <Flex align="center" justify="space-between" gap={12} wrap className="border-t border-border bg-muted/20 px-5 py-3" style={{ gap: 12, padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'color-mix(in oklab, var(--muted) 20%, var(--card))' }}>
                          <Flex gap={12} wrap style={{ gap: 12 }}>
                            <Typography.Text type="secondary" className="text-xs">来源：{getLeadSourceLabel(lead.source)}</Typography.Text>
                            <Typography.Text type="secondary" className="text-xs">提交：{formatDate(lead.createdAt)}</Typography.Text>
                          </Flex>
                          <Flex align="center" wrap style={{ gap: 12 }}>
                            {archiveState === 'active' && lead.assignmentStatus === 'assignment_pending' ? (
                              <>
                                {needsStaffWechatForAssignment(lead.assignmentErrorCode) ? (
                                  <Button size="small" href="/staff">去员工管理</Button>
                                ) : null}
                                <Button size="small" loading={retryingAssignmentId === lead._id} onClick={() => void retryAssignment(lead)}>重试派单</Button>
                              </>
                            ) : null}
                            {archiveState === 'active' && capabilities.canManageArchive ? (
                              <Button size="small" icon={<Archive size={14} />} disabled={archiveLoading} onClick={() => void openArchive([lead])}>归档</Button>
                            ) : archiveState === 'archived' ? (
                              <Button size="small" icon={<RotateCcw size={14} />} disabled={Boolean(deletingId)} loading={deletingId === lead._id} onClick={() => void restoreLead(lead)}>恢复</Button>
                            ) : null}
                            {archiveState === 'archived' && capabilities.canPurge ? <Button size="small" danger icon={<Trash2 size={14} />} disabled={Boolean(deletingId)} loading={deletingId === lead._id} onClick={() => void openPurge(lead)}>永久删除</Button> : null}
                          </Flex>
                        </Flex>
                      </Flex>
                    </ProCard>
                  );
                }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无符合条件的客户线索" />}
                {pagination && typeof pagination !== 'boolean' ? (
                  <Flex
                    justify="end"
                    className="lead-card-pagination"
                    style={{ minHeight: 52, padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--card)' }}
                  >
                    <Pagination {...pagination} size="small" />
                  </Flex>
                ) : null}
              </Flex>
            );
          }}
          request={requestLeads}
          onRequestError={(error) => notify.error(error instanceof Error ? error.message : '线索列表加载失败')}
        />
      </PageContainer>

      <Modal
        open={archiveTargets.length > 0}
        title={`归档 ${archiveTargets.length} 条客户线索`}
        okText="确认归档"
        cancelText="取消"
        confirmLoading={archiveLoading}
        okButtonProps={{ disabled: !archiveReason || !archiveImpacts.some((impact) => impact.canArchive) }}
        onCancel={() => { if (!archiveLoading) { setArchiveTargets([]); setArchiveImpacts([]); } }}
        onOk={() => void archiveLeads()}
      >
        <Flex vertical gap={16}>
          <Alert
            showIcon
            type={archiveImpacts.some((impact) => (impact.inFlightAiCount || 0) > 0) ? 'warning' : 'info'}
            message="归档不会删除客户资产"
            description={archiveImpacts.some((impact) => (impact.inFlightAiCount || 0) > 0)
              ? '存在运行中的 AI 任务；这些线索会跳过，其余可处理线索仍可归档。'
              : '归档后将从日常线索、小程序和 AI 客户选择中隐藏，户型、方案、提成和历史记录仍会保留。'}
          />
          {archiveImpacts.some((impact) => !impact.canArchive) ? (
            <Flex vertical gap={4}>
              {archiveImpacts.filter((impact) => !impact.canArchive).map((impact) => {
                const lead = archiveTargets.find((item) => item._id === impact.leadId);
                return (
                  <Typography.Text key={impact.leadId} type="secondary">
                    {lead?.name || impact.leadId}：{impact.unavailable ? '无权访问或线索已不存在' : (impact.archiveBlockers || ['当前不可归档']).join('；')}
                  </Typography.Text>
                );
              })}
            </Flex>
          ) : null}
          <Descriptions
            size="small"
            column={2}
            items={[
              { key: 'floorplans', label: '关联户型', children: archiveImpacts.reduce((total, item) => total + (item.floorPlanCount || 0), 0) },
              { key: 'workflows', label: 'AI 方案', children: archiveImpacts.reduce((total, item) => total + (item.aiWorkflowCount || 0), 0) },
              { key: 'generations', label: 'AI 生成', children: archiveImpacts.reduce((total, item) => total + (item.aiGenerationCount || 0), 0) },
              { key: 'followups', label: '跟进记录', children: archiveImpacts.reduce((total, item) => total + (item.followUpCount || 0), 0) },
            ]}
          />
          <Flex vertical gap={6}>
            <Typography.Text strong>归档原因</Typography.Text>
            <Select value={archiveReason} options={ARCHIVE_REASON_OPTIONS} placeholder="请选择归档原因" onChange={setArchiveReason} />
          </Flex>
          <Flex vertical gap={6} className="pb-3">
            <Typography.Text strong>备注（可选）</Typography.Text>
            <Flex vertical gap={4}>
              <Input.TextArea value={archiveNote} maxLength={500} autoSize={{ minRows: 2, maxRows: 4 }} onChange={(event) => setArchiveNote(event.target.value)} />
              <Typography.Text type="secondary" className="self-end text-xs">{archiveNote.length} / 500</Typography.Text>
            </Flex>
          </Flex>
        </Flex>
      </Modal>

      <Modal
        open={rescheduleOpen}
        zIndex={1300}
        title={rescheduleLead ? `为${rescheduleLead.name}修改预约` : '修改预约'}
        okText="保存新时间"
        cancelText="取消"
        okButtonProps={{ loading: appointmentSubmitting, disabled: !selectedSlot || !rescheduleReason.trim() }}
        onCancel={() => setRescheduleOpen(false)}
        onOk={() => void rescheduleAppointment()}
      >
        <Flex vertical gap={12} className="pb-3">
          <Alert showIcon type="info" message="这是代客户改期" description="设计师与客户通过微信或电话确认后，可在这里代为调整上门时间；保存后会写入预约审计并通知相关人员。" />
          {renderSlotPicker()}
          <Flex vertical gap={4}>
            <Input.TextArea value={rescheduleReason} maxLength={200} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="填写客户确认方式或改期原因" onChange={(event) => setRescheduleReason(event.target.value)} />
            <Typography.Text type="secondary" className="self-end text-xs">{rescheduleReason.length} / 200</Typography.Text>
          </Flex>
        </Flex>
      </Modal>

      <Modal
        open={appointmentOpen}
        zIndex={1300}
        title="设置预约上门量房"
        okText="确认预约"
        cancelText="取消"
        okButtonProps={{ loading: appointmentSubmitting, disabled: !selectedSlot || !appointmentAddress.trim() }}
        onCancel={() => setAppointmentOpen(false)}
        onOk={() => void createAppointment()}
      >
        <Flex vertical gap={12}>
          <Typography.Text type="secondary">请为客户设置测量员上门服务的时间和地址。</Typography.Text>
          {renderSlotPicker()}
          <Input value={appointmentAddress} placeholder="上门地址" onChange={(event) => setAppointmentAddress(event.target.value)} />
        </Flex>
      </Modal>

      <Modal
        open={addressOpen}
        zIndex={1300}
        title={addressLead ? `为${addressLead.name}${addressLead.appointment?.address ? '修改' : '补充'}服务地址` : '服务地址'}
        okText="保存地址"
        cancelText="取消"
        okButtonProps={{ loading: appointmentSubmitting, disabled: !appointmentAddress.trim() }}
        onCancel={() => { if (!appointmentSubmitting) { setAddressOpen(false); setAddressLead(null); } }}
        onOk={() => void updateAppointmentAddress()}
      >
        <Flex vertical gap={12} className="pb-3">
          <Alert showIcon type="info" message="设计师和测量员都可以在预约详情中补充" description="地址会写入预约服务事实，并保留修改版本。" />
          <Flex vertical gap={4}>
            <Input.TextArea value={appointmentAddress} maxLength={300} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="填写详细上门地址" onChange={(event) => setAppointmentAddress(event.target.value)} />
            <Typography.Text type="secondary" className="self-end text-xs">{appointmentAddress.length} / 300</Typography.Text>
          </Flex>
        </Flex>
      </Modal>

      <Modal
        open={archiveFailures.length > 0}
        title="未处理的客户线索"
        footer={<Button type="primary" onClick={() => setArchiveFailures([])}>知道了</Button>}
        onCancel={() => setArchiveFailures([])}
      >
        <Flex vertical gap={10}>
          {archiveFailures.map((item) => (
            <Flex key={`${item.leadId}-${item.status}`} vertical gap={2}>
              <Typography.Text strong>{item.name}</Typography.Text>
              <Typography.Text type="secondary">{item.reason}</Typography.Text>
            </Flex>
          ))}
        </Flex>
      </Modal>

      <Modal
        open={Boolean(purgeTarget)}
        title="永久删除空白客户线索"
        okText="永久删除"
        cancelText="取消"
        okButtonProps={{
          danger: true,
          disabled: !purgeTarget || !purgeImpact?.canPurge || purgeConfirmation !== purgeTarget.name,
          loading: Boolean(purgeTarget && deletingId === purgeTarget._id),
        }}
        onCancel={() => { if (!deletingId) { setPurgeTarget(null); setPurgeImpact(null); } }}
        onOk={() => void purgeLead()}
      >
        <Flex vertical gap={16}>
          {purgeImpact?.canPurge ? (
            <Alert showIcon type="error" message="此操作不可恢复" description="该线索未发现户型、AI、获客、提成或跟进记录。永久删除后只保留不含客户隐私的操作审计。" />
          ) : (
            <Alert showIcon type="warning" message="该线索不能永久删除" description={(purgeImpact?.purgeBlockers || []).join('；')} />
          )}
          {purgeTarget && purgeImpact?.canPurge ? (
            <Flex vertical gap={6}>
              <Typography.Text>请输入客户名称 <Typography.Text strong>{purgeTarget.name}</Typography.Text> 确认：</Typography.Text>
              <Input value={purgeConfirmation} onChange={(event) => setPurgeConfirmation(event.target.value)} />
            </Flex>
          ) : null}
        </Flex>
      </Modal>

      <Modal
        open={profileOpen}
        title="补充客户资料"
        destroyOnHidden
        okText="保存"
        cancelText="取消"
        confirmLoading={profileSubmitting}
        onCancel={() => { if (!profileSubmitting) setProfileOpen(false); }}
        onOk={() => void saveLeadProfile()}
      >
        <Flex vertical gap={16} className="pb-3">
          <Alert
            showIcon
            type="info"
            message="更新客户基础资料"
            description="修改后会同步到小程序线索详情、预约与项目展示；不会变更设计师绑定或提成受益人。"
          />
          <Flex vertical gap={6}>
            <Typography.Text strong>客户称呼</Typography.Text>
            <Input
              maxLength={50}
              value={profileForm.name}
              placeholder="请输入客户称呼"
              onChange={(event) => setProfileForm((current) => ({ ...current, name: event.target.value }))}
            />
          </Flex>
          <Flex vertical gap={6}>
            <Typography.Text strong>手机号码</Typography.Text>
            <Input
              maxLength={11}
              value={profileForm.phone}
              placeholder="请输入手机号"
              onChange={(event) => setProfileForm((current) => ({ ...current, phone: event.target.value }))}
            />
          </Flex>
          <Flex vertical gap={6}>
            <Typography.Text strong>小区名称</Typography.Text>
            <Input
              maxLength={100}
              value={profileForm.communityName}
              placeholder="请输入小区名称"
              onChange={(event) => setProfileForm((current) => ({ ...current, communityName: event.target.value }))}
            />
          </Flex>
          <Flex vertical gap={6}>
            <Typography.Text strong>意向面积（选填）</Typography.Text>
            <InputNumber
              className="w-full"
              min={1}
              max={99999}
              precision={0}
              controls={false}
              addonAfter="m²"
              placeholder="请输入房屋面积"
              value={profileForm.area ? Number(profileForm.area) : null}
              onChange={(value) => setProfileForm((current) => ({
                ...current,
                area: value == null ? '' : String(value),
              }))}
            />
          </Flex>
          <Flex vertical gap={6}>
            <Typography.Text strong>偏好风格（选填）</Typography.Text>
            <Select
              allowClear
              className="w-full"
              placeholder="请选择意向风格"
              options={LEAD_STYLE_OPTIONS.map((value) => ({ label: value, value }))}
              value={profileForm.stylePreference || undefined}
              onChange={(value) => setProfileForm((current) => ({ ...current, stylePreference: value || '' }))}
            />
          </Flex>
        </Flex>
      </Modal>

      <Modal
        open={Boolean(staffAssign)}
        title={staffAssign?.role === 'measurer' ? '分配测量员' : '分配设计师'}
        destroyOnHidden
        footer={(
          <Flex justify="end" gap={8}>
            <Button
              disabled={staffAssignSubmitting}
              onClick={() => {
                if (!staffAssignSubmitting) {
                  setStaffAssign(null);
                  setStaffAssignSelectedId(undefined);
                }
              }}
            >
              取消
            </Button>
            <Button
              type="primary"
              loading={staffAssignSubmitting}
              disabled={!staffAssignSelectedId || staffAssignLoading}
              onClick={() => void submitStaffAssign()}
            >
              确认
            </Button>
          </Flex>
        )}
        onCancel={() => {
          if (!staffAssignSubmitting) {
            setStaffAssign(null);
            setStaffAssignSelectedId(undefined);
          }
        }}
      >
        <Flex vertical gap={12}>
          <Typography.Text type="secondary">
            {getStaffId(staffAssign?.role === 'measurer' ? staffAssign.lead.measurerId : staffAssign?.lead.assignedTo)
              ? '选择后将替换当前人员'
              : '选择可派人员'}
          </Typography.Text>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder={staffAssignLoading ? '正在读取可派人员…' : '请选择人员'}
            loading={staffAssignLoading}
            value={staffAssignSelectedId}
            options={staffAssignOptions.map((item) => ({
              value: item.id,
              label: `${item.displayName || '未命名'}${item.phone ? ` · ${item.phone}` : ''}`,
            }))}
            onChange={(value) => setStaffAssignSelectedId(value)}
          />
        </Flex>
      </Modal>

      <Modal
        open={conversionOpen}
        title="确认客户已签约"
        destroyOnHidden
        footer={(
          <Flex justify="end" gap={8}>
            <Button disabled={conversionSubmitting} onClick={() => setConversionOpen(false)}>取消</Button>
            <Button
              color="green"
              variant="solid"
              icon={<BadgeCheck size={16} />}
              loading={conversionSubmitting}
              disabled={!conversionDate}
              onClick={() => void markConverted()}
            >
              确认已签约
            </Button>
          </Flex>
        )}
        onCancel={() => { if (!conversionSubmitting) setConversionOpen(false); }}
      >
        <Flex vertical gap={16} className="pb-3">
          <Alert
            showIcon
            type="info"
            message={selectedLead ? `${selectedLead.name} · ${selectedLead.communityName || '未填写小区'}` : '客户信息'}
            description={`当前阶段：${selectedLead ? getLeadStatusLabel(selectedLead.status) : '-'}`}
          />
          {selectedLead && !['measured', 'assigned', 'designing', 'quoting'].includes(selectedLead.status) ? (
            <Alert showIcon type="warning" message="本次操作将跳过尚未完成的中间阶段" />
          ) : null}
          <Flex vertical gap={6}>
            <Typography.Text strong>签约日期</Typography.Text>
            <Input
              type="date"
              max={chinaDateValue()}
              value={conversionDate}
              onChange={(event) => setConversionDate(event.target.value)}
            />
          </Flex>
          <Flex vertical gap={6}>
            <Typography.Text strong>签约金额（选填）</Typography.Text>
            <InputNumber
              className="w-full"
              min={0.01}
              max={999999999999.99}
              precision={2}
              controls={false}
              prefix="¥"
              placeholder="用于经营统计，不作为财务结算凭证"
              value={conversionAmount}
              onChange={(value) => setConversionAmount(value)}
            />
          </Flex>
          <Flex vertical gap={6}>
            <Typography.Text strong>签约备注（选填）</Typography.Text>
            <Flex vertical gap={4}>
              <Input.TextArea
                value={conversionNote}
                maxLength={200}
                autoSize={{ minRows: 2, maxRows: 4 }}
                placeholder="可记录合同编号或需要交接的事项"
                onChange={(event) => setConversionNote(event.target.value)}
              />
              <Typography.Text type="secondary" className="self-end text-xs">{conversionNote.length} / 200</Typography.Text>
            </Flex>
          </Flex>
          <Typography.Text type="secondary">
            仅更新客户业务状态，不会自动生成订单、扣款或结算获客提成。
          </Typography.Text>
        </Flex>
      </Modal>

      <Modal
        open={revertConversionOpen}
        title="撤销签约标记"
        okText="确认撤销"
        cancelText="取消"
        okButtonProps={{
          danger: true,
          loading: conversionSubmitting,
          disabled: !revertReason.trim(),
        }}
        onCancel={() => {
          if (!conversionSubmitting) {
            setRevertConversionOpen(false);
            setRevertReason('');
          }
        }}
        onOk={() => void revertConversion()}
      >
        <Flex vertical gap={12} className="pb-3">
          <Alert
            showIcon
            type="warning"
            message="撤销后将恢复为签约前的业务阶段"
            description="签约审计记录会保留，已记录的签约信息将从当前线索摘要中移除。"
          />
          <Flex vertical gap={6}>
            <Typography.Text strong>撤销原因</Typography.Text>
            <Flex vertical gap={4}>
              <Input.TextArea
                value={revertReason}
                maxLength={200}
                autoSize={{ minRows: 3, maxRows: 5 }}
                placeholder="请说明合同未生效或误操作等原因"
                onChange={(event) => setRevertReason(event.target.value)}
              />
              <Typography.Text type="secondary" className="self-end text-xs">{revertReason.length} / 200</Typography.Text>
            </Flex>
          </Flex>
        </Flex>
      </Modal>

      <Modal
        open={cancelOpen}
        zIndex={1300}
        title="取消本次预约"
        okText="确认取消"
        cancelText="返回"
        okButtonProps={{ danger: true, loading: cancelSubmitting, disabled: !cancelReason.trim() }}
        onCancel={() => { if (!cancelSubmitting) { setCancelOpen(false); setCancelReason(''); } }}
        onOk={() => void cancelAppointment()}
      >
        <Flex vertical gap={12} className="pb-3">
          <Alert showIcon type="warning" message="取消后客户需重新预约上门" description="请填写取消原因，系统会通知设计师、测量员和已授权客户。" />
          <Flex vertical gap={4}>
            <Input.TextArea
              value={cancelReason}
              maxLength={200}
              autoSize={{ minRows: 2, maxRows: 4 }}
              placeholder="请填写取消原因"
              onChange={(event) => setCancelReason(event.target.value)}
            />
            <Typography.Text type="secondary" className="self-end text-xs">{cancelReason.length} / 200</Typography.Text>
          </Flex>
        </Flex>
      </Modal>

      <Modal
        open={closeLostOpen}
        title="未签单结案"
        okText="确认结案"
        cancelText="取消"
        confirmLoading={closeLostSubmitting}
        okButtonProps={{ disabled: !closeLostReason || (closeLostReason === 'other' && !closeLostNote.trim()) }}
        onCancel={() => { if (!closeLostSubmitting) setCloseLostOpen(false); }}
        onOk={() => void closeLost()}
      >
        <Flex vertical gap={14}>
          <Alert showIcon type="info" message="经营结案与归档互不替代" description="正常未签单原因进入设计师签单率分母；无效、重复和误录不计绩效，且仅企业负责人可选。" />
          <Select
            value={closeLostReason}
            placeholder="选择结案原因"
            options={CLOSE_LOST_REASON_OPTIONS.filter((item) => ['enterprise_admin', 'admin', 'super_admin'].includes(currentUser?.role || '') || !['invalid_contact', 'duplicate', 'mistaken_entry'].includes(item.value))}
            onChange={setCloseLostReason}
          />
          <Input.TextArea value={closeLostNote} maxLength={500} autoSize={{ minRows: 2, maxRows: 5 }} placeholder={closeLostReason === 'other' ? '请填写具体原因（必填）' : '补充备注（可选）'} onChange={(event) => setCloseLostNote(event.target.value)} />
        </Flex>
      </Modal>

      <Drawer
        open={Boolean(selectedLead)}
        width={640}
        destroyOnHidden
        title={selectedLead ? `${selectedLead.name}的线索详情` : '线索详情'}
        onClose={closeLeadDetail}
        extra={selectedLead && !selectedLead.archivedAt ? (
          <Button icon={<FilePenLine size={16} />} onClick={() => openAiWorkbench(selectedLead._id)}>
            {selectedLead.floorPlanIds?.length || selectedLead.followUpRecords?.length ? '查看方案' : '开始方案'}
          </Button>
        ) : null}
      >
        {selectedLead ? (
          <Flex vertical gap={24}>
            {selectedLead.archivedAt ? (
              <Alert
                showIcon
                type="info"
                message="该客户线索已归档"
                description={`${ARCHIVE_REASON_LABELS[selectedLead.archiveReason || ''] || '其他'} · ${formatDate(selectedLead.archivedAt)}${selectedLead.archiveNote ? ` · ${selectedLead.archiveNote}` : ''}`}
              />
            ) : null}
            <Flex align="center" justify="space-between" gap={16} wrap>
              <Flex vertical gap={4}>
                <Typography.Text type="secondary">{selectedLead.phone || '-'}</Typography.Text>
                <Tag color={getStatusColor(selectedLead.status)}>{selectedLead.serviceStageLabel || getLeadStatusLabel(selectedLead.status)}</Tag>
              </Flex>
              <Flex vertical gap={2} className="min-w-44" align="end">
                <Typography.Text type="secondary">创建时绑定设计师</Typography.Text>
                <Typography.Text strong>
                  {getStaffName(selectedLead.assignedTo) || '未绑定设计师'}
                </Typography.Text>
              </Flex>
            </Flex>

            <Descriptions
              title="量房安排"
              bordered
              size="small"
              column={1}
              items={[
                { key: 'measurer', label: '测量员', children: getStaffName(selectedLead.measurerId) || '未绑定测量员' },
                {
                  key: 'appointment',
                  label: '预约上门时间',
                  children: selectedLead.appointment
                    ? `${formatAppointmentRange(selectedLead.appointment.timeRange)} · ${selectedLead.appointment.address || '地址待确认'}`
                    : '尚未预约',
                },
                ...(selectedLead.appointment?.status ? [{
                  key: 'appointmentStatus',
                  label: '预约状态',
                  children: APPOINTMENT_STATUS_LABELS[selectedLead.appointment.status] || selectedLead.appointment.status,
                }] : []),
              ]}
              extra={!selectedLead.archivedAt ? (
                selectedLead.canRebook || !selectedLead.appointment ? (
                  <Button type="primary" icon={<ClipboardCheck size={15} />} onClick={() => openAppointmentPicker(selectedLead)}>
                    {selectedLead.canRebook ? '重新预约' : '设置预约'}
                  </Button>
                ) : (
                  <Space wrap>
                    {selectedLead.appointment.status === 'confirmed' ? (
                      <>
                        <Button icon={<CalendarDays size={15} />} onClick={() => openReschedule(selectedLead)}>改预约</Button>
                        <Button icon={<FilePenLine size={15} />} onClick={() => openAddressEditor(selectedLead)}>
                          {selectedLead.appointment.address ? '修改地址' : '补充地址'}
                        </Button>
                      </>
                    ) : null}
                    {canCancelLeadAppointment(selectedLead, currentUser?.role, currentUser?._id) ? (
                      <Button danger icon={<XCircle size={15} />} onClick={() => { setCancelReason(''); setCancelOpen(true); }}>取消预约</Button>
                    ) : null}
                    {canCompleteLeadAppointment(selectedLead, currentUser?.role, currentUser?._id) ? (
                      <Button icon={<CheckCircle2 size={15} />} loading={completeSubmitting} onClick={() => void completeAppointment()}>完成预约</Button>
                    ) : null}
                  </Space>
                )
              ) : null}
            />

              <Steps
                size="small"
                current={getLeadWorkflowStep(selectedLead.status)}
                items={LEAD_WORKFLOW_STEPS.map((title) => ({ title }))}
              />

              <Typography.Text type="secondary">
                下一步：{selectedLead.nextAction || getLeadNextAction(selectedLead.status)}
              </Typography.Text>

            {canManageLeadPublications(selectedLead, currentUser?.role, currentUser?._id) ? (
              <Flex vertical gap={12}>
                <Flex align="center" justify="space-between" gap={12} wrap>
                  <Flex align="center" gap={8}>
                    <Send size={16} />
                    <Typography.Text strong>客户可见方案</Typography.Text>
                    <Tag color={publications.length ? 'green' : 'default'}>{publications.length ? '已发布' : '仅内部可见'}</Tag>
                  </Flex>
                  <Button size="small" icon={<FilePenLine size={14} />} onClick={() => openAiWorkbench(selectedLead._id)}>
                    前往 AI 工作台
                  </Button>
                </Flex>
                {publicationLoading ? (
                  <Typography.Text type="secondary">读取发布状态中…</Typography.Text>
                ) : publications.length ? (
                  <Flex vertical gap={8}>
                    {publications.map((item) => (
                      <Flex key={item.id} align="center" justify="space-between" gap={12} className="rounded-lg border border-border bg-card p-3">
                        <Flex vertical gap={2} className="min-w-0">
                          <Flex align="center" gap={8} wrap>
                            <Typography.Text strong>{item.title}</Typography.Text>
                            {item.finalized ? <Tag color="gold">已定稿</Tag> : null}
                          </Flex>
                          <Typography.Text type="secondary" className="text-xs">
                            {item.imageCount} 张效果图 · 发布于 {formatDate(item.publishedAt)}
                          </Typography.Text>
                        </Flex>
                        {item.workflowId ? (
                          <Flex gap={8}>
                            {!item.finalized ? (
                              <Button
                                size="small"
                                loading={publicationFinalizingId === item.id}
                                onClick={() => void finalizeScheme(item)}
                              >
                                设为定稿
                              </Button>
                            ) : null}
                            <Button
                              size="small"
                              danger
                              loading={publicationUpdatingId === item.id}
                              onClick={() => void withdrawScheme(item)}
                            >
                              撤回
                            </Button>
                          </Flex>
                        ) : null}
                      </Flex>
                    ))}
                  </Flex>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有发送给客户的方案，请在 AI 工作台勾选效果图后发送" />
                )}
              </Flex>
            ) : null}

            {selectedLead.conversionActions?.canMarkConverted ? (
              <Flex
                align="center"
                justify="space-between"
                gap={16}
                wrap
                className="rounded-xl bg-emerald-50 p-4"
              >
                <Flex vertical gap={2}>
                  <Typography.Text strong>客户已完成合同签署？</Typography.Text>
                  <Typography.Text type="secondary">
                    确认后进入“已签约”，并记录签约日期与操作人。
                  </Typography.Text>
                </Flex>
                <Button color="green" variant="solid" icon={<BadgeCheck size={16} />} onClick={openConversion}>
                  标记已签约
                </Button>
              </Flex>
            ) : null}

            {selectedLead.status === 'converted' ? (
              <Descriptions
                title="签约记录"
                bordered
                size="small"
                column={1}
                extra={selectedLead.conversionActions?.canRevertConversion ? (
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<Undo2 size={14} />}
                    onClick={() => setRevertConversionOpen(true)}
                  >
                    撤销签约标记
                  </Button>
                ) : null}
                items={[
                  { key: 'convertedOn', label: '签约日期', children: selectedLead.convertedOn || '历史数据未记录' },
                  { key: 'convertedBy', label: '标记人', children: getStaffName(selectedLead.convertedBy) || '历史数据未记录' },
                  { key: 'convertedAt', label: '标记时间', children: formatDate(selectedLead.convertedAt || undefined) },
                  { key: 'contractAmount', label: '签约金额', children: formatContractAmount(selectedLead.contractAmount) },
                  ...(selectedLead.conversionNote ? [{ key: 'conversionNote', label: '签约备注', children: selectedLead.conversionNote }] : []),
                ]}
              />
            ) : null}

            {!selectedLead.archivedAt && !['closed', 'converted'].includes(selectedLead.status) && (
              ['enterprise_admin', 'admin', 'super_admin'].includes(currentUser?.role || '')
              || (currentUser?.role === 'designer' && getStaffId(selectedLead.assignedTo) === currentUser?._id)
            ) ? (
              <Flex align="center" justify="space-between" gap={16} wrap className="rounded-xl bg-amber-50 p-4">
                <Flex vertical gap={2}><Typography.Text strong>客户确定不再继续？</Typography.Text><Typography.Text type="secondary">按真实原因结案，用于签单率统计；不会自动归档客户资料。</Typography.Text></Flex>
                <Button danger icon={<XCircle size={16} />} onClick={() => setCloseLostOpen(true)}>未签单结案</Button>
              </Flex>
            ) : null}

            {selectedLead.status === 'closed' && ['enterprise_admin', 'admin', 'super_admin'].includes(currentUser?.role || '') ? (
              <Flex align="center" justify="space-between" gap={16} wrap className="rounded-xl bg-emerald-50 p-4">
                <Flex vertical gap={2}><Typography.Text strong>客户重新启动装修？</Typography.Text><Typography.Text type="secondary">恢复结案前阶段；已取消的预约不会自动恢复。</Typography.Text></Flex>
                <Button loading={reopenSubmitting} icon={<RotateCcw size={16} />} onClick={() => void reopenLost()}>重新激活</Button>
              </Flex>
            ) : null}

            {selectedLead.assignmentAudit ? (
              <Flex vertical gap={12}>
                <Flex align="center" gap={8}><Trophy size={16} /><Typography.Text strong>派单与经营结果审计</Typography.Text></Flex>
                {selectedLead.assignmentAudit.claimWindow ? (
                  <Descriptions bordered size="small" column={1} items={[
                    { key: 'window', label: '抢单窗口', children: `${CLAIM_WINDOW_STATUS_LABELS[selectedLead.assignmentAudit.claimWindow.status] || selectedLead.assignmentAudit.claimWindow.status} · ${formatDate(selectedLead.assignmentAudit.claimWindow.opensAt)} 至 ${formatDate(selectedLead.assignmentAudit.claimWindow.expiresAt)}` },
                    { key: 'route', label: '派单路径', children: selectedLead.assignmentAudit.claimWindow.assignmentGroup ? (selectedLead.assignmentAudit.claimWindow.assignmentGroup === 'high' ? '自动派至高绩效组' : '自动派至普通组') : selectedLead.assignmentAudit.claimWindow.resolutionReason || '等待结果' },
                  ]} />
                ) : null}
                {(selectedLead.assignmentAudit.outcomes || []).length ? (
                  <Timeline items={(selectedLead.assignmentAudit.outcomes || []).map((outcome) => ({
                    color: outcome.invalidatedAt ? 'gray' : outcome.outcome === 'signed' ? 'green' : 'orange',
                    children: <Flex vertical gap={2}><Typography.Text>{outcome.outcome === 'signed' ? '已签单' : `未签单：${CLOSE_LOST_REASON_LABELS[outcome.lostReason || ''] || outcome.lostReason || '未记录原因'}`}{outcome.performanceEligible ? '（计入绩效）' : '（不计绩效）'}</Typography.Text><Typography.Text type="secondary" className="text-xs">{formatDate(outcome.outcomeAt)}{outcome.invalidatedAt ? ` · 已撤销 ${formatDate(outcome.invalidatedAt)}` : ''}</Typography.Text></Flex>,
                  }))} />
                ) : null}
                {(selectedLead.assignmentAudit.events || []).length ? (
                  <Timeline items={(selectedLead.assignmentAudit.events || []).map((event) => ({
                    children: <Flex vertical gap={2}><Typography.Text>{ASSIGNMENT_EVENT_LABELS[event.eventType] || event.eventType}</Typography.Text><Typography.Text type="secondary" className="text-xs">{formatDate(event.createdAt)}{event.errorCode ? ` · ${event.errorCode}` : ''}</Typography.Text></Flex>,
                  }))} />
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无派单审计记录" />}
              </Flex>
            ) : null}

            <Descriptions
              title="客户资料"
              bordered
              size="small"
              column={1}
              extra={selectedLead && !selectedLead.archivedAt && canEditLeadProfile(selectedLead, currentUser?.role, currentUser?._id) ? (
                <Button
                  type="link"
                  size="small"
                  icon={<FilePenLine size={14} />}
                  onClick={() => openProfileEditor(selectedLead)}
                >
                  补充资料
                </Button>
              ) : null}
              items={[
                { key: 'community', label: '小区名称', children: selectedLead.communityName || '-' },
                { key: 'promoter', label: selectedLead.source === 'referrer_network' ? '推广人' : '录入人员', children: selectedLead.source === 'referrer_network' ? getStaffName(selectedLead.referrer) || '未识别推广人' : getStaffName(selectedLead.promoterId) || '系统' },
                { key: 'area', label: '意向面积', children: selectedLead.area ? `${selectedLead.area} m2` : '-' },
                { key: 'style', label: '偏好风格', children: selectedLead.stylePreference || '-' },
                { key: 'source', label: '来源渠道', children: getLeadSourceLabel(selectedLead.source) },
              ]}
            />

            <RelatedFloorPlans
              floorPlans={selectedLead.floorPlanIds || []}
              primaryFloorPlanId={typeof selectedLead.primaryFloorPlanId === 'object' ? selectedLead.primaryFloorPlanId?._id : selectedLead.primaryFloorPlanId || undefined}
            />

            <Flex vertical gap={12}>
              <Flex align="center" gap={8}>
                <MessageSquare size={16} />
                <Typography.Text strong>跟进日志</Typography.Text>
                <Tag>{selectedLead.followUpRecords?.length || 0}</Tag>
              </Flex>
              {!selectedLead.archivedAt ? <Flex gap={8} align="start">
                <Input.TextArea
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  placeholder="记录新的跟进动态"
                  value={newNote}
                  onChange={(event) => setNewNote(event.target.value)}
                />
                <Button type="primary" icon={<Plus size={16} />} loading={isSubmitting} disabled={!newNote.trim()} onClick={() => void addFollowUp()}>
                  添加
                </Button>
              </Flex> : null}
              {selectedLead.followUpRecords?.length ? (
                <Timeline
                  items={[...(selectedLead.followUpRecords || [])].reverse().map((record) => ({
                    children: (
                      <Flex vertical gap={4}>
                        <Typography.Text>{record.content || '-'}</Typography.Text>
                        <Typography.Text type="secondary" className="text-xs">
                          {record.operator || '管理员'} · {formatDate(record.createdAt)}
                        </Typography.Text>
                      </Flex>
                    ),
                  }))}
                />
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无跟进记录" />}
            </Flex>
          </Flex>
        ) : null}
      </Drawer>
      <SensitivePasswordModal
        open={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
      />
    </div>
  );
}

function RelatedFloorPlans({
  floorPlans,
  primaryFloorPlanId,
}: {
  floorPlans: FloorPlan[];
  primaryFloorPlanId?: string;
}) {
  const sortedFloorPlans = [...floorPlans].sort((left, right) => {
    if (primaryFloorPlanId && left._id === primaryFloorPlanId) return -1;
    if (primaryFloorPlanId && right._id === primaryFloorPlanId) return 1;
    return 0;
  });

  return (
    <Flex vertical gap={12}>
      <Flex align="center" justify="space-between">
        <Typography.Text strong>实测户型档案</Typography.Text>
        <Tag>{floorPlans.length}</Tag>
      </Flex>
      {sortedFloorPlans.length ? sortedFloorPlans.map((plan) => {
        const isSurveying = isFormalSurveyPlan(plan);
        const stats = getSurveyGraphStats(plan.layoutData);
        return (
          <Flex key={plan._id} align="center" justify="space-between" gap={16} className="rounded-lg border border-border bg-card p-3">
            <Flex vertical gap={4} className="min-w-0">
              <Space size={6} wrap>
                <Typography.Text strong ellipsis={{ tooltip: plan.display?.projectTitle || plan.name || '未命名户型' }}>{plan.display?.projectTitle || plan.name || '未命名户型'}</Typography.Text>
                {primaryFloorPlanId === plan._id ? <Tag color="green">主户型</Tag> : null}
                {isSurveying ? <Tag color="blue">正式量房</Tag> : null}
              </Space>
              <Typography.Text type="secondary" className="text-xs">
                {isSurveying ? `${plan.display?.projectSubtitle ? `${plan.display.projectSubtitle} · ` : ''}${stats.wallCount} 面墙 · ${stats.spaceCount} 个空间 · ${stats.openingCount} 个门窗` : getFloorPlanSourceLabel(plan.source)}
              </Typography.Text>
            </Flex>
            <Button size="small" href={`/floorplans/${plan._id}`}>查看</Button>
          </Flex>
        );
      }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无关联的实测记录" />}
    </Flex>
  );
}

function LeadCardField({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <Flex vertical gap={3} className="min-w-0">
      <Typography.Text type="secondary" className="text-xs">{label}</Typography.Text>
      <Typography.Text strong ellipsis={{ tooltip: value }}>{value}</Typography.Text>
      {detail ? <Typography.Text type="secondary" className="text-xs" ellipsis={{ tooltip: detail }}>{detail}</Typography.Text> : null}
    </Flex>
  );
}

function LeadStaffCardField({
  label,
  staff,
  fallback,
  canAssign,
  onAssign,
}: {
  label: string;
  staff: StaffReference | string | null | undefined;
  fallback: string;
  canAssign?: boolean;
  onAssign?: () => void;
}) {
  const name = getStaffName(staff) || fallback;
  const phone = typeof staff === 'object' && staff ? staff.phone : null;
  const actionLabel = getStaffId(staff) ? '更换' : '分配';
  return (
    <Flex vertical gap={3} className="min-w-0">
      <Flex align="center" justify="space-between" gap={8}>
        <Typography.Text type="secondary" className="text-xs">{label}</Typography.Text>
        {canAssign ? (
          <Button type="link" size="small" className="h-auto px-0" onClick={onAssign}>{actionLabel}</Button>
        ) : null}
      </Flex>
      <Typography.Text strong ellipsis={{ tooltip: name }}>姓名：{name}</Typography.Text>
      <Typography.Text style={{ color: '#1677ff' }} ellipsis={{ tooltip: phone || '未记录' }}>手机号：{phone || '未记录'}</Typography.Text>
    </Flex>
  );
}

export default LeadsPage;
