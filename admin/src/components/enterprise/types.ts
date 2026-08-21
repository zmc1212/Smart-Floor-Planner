export interface EnterpriseStatusEventItem {
  _id: string;
  enterpriseId: string;
  fromStatus: string;
  toStatus: string;
  action: 'approve' | 'reject' | 'disable' | 'enable' | 'resubmit_review';
  reason: string | null;
  actorAdminId: string | null;
  createdAt?: string | Date;
}

export interface EnterpriseListItem {
  _id: string;
  name: string;
  code: string;
  status: 'pending_approval' | 'active' | 'disabled' | 'rejected';
  registrationMode: 'self_service' | 'manual';
  createdAt?: string;
  logo?: string;
  statusReason?: string | null;
  statusChangedAt?: string | Date | null;
  statusChangedByAdminId?: string | null;
  statusEvents?: EnterpriseStatusEventItem[];
  branding?: {
    primaryColor?: string;
    accentColor?: string;
  };
  groundPromotionFixedCommission?: number;
  contactPerson?: {
    name?: string;
    phone?: string;
    email?: string;
  };
  automationConfig?: {
    followUpSlaHours?: number;
    measureTaskSlaHours?: number;
    designTaskSlaHours?: number;
    reminderIntervalHours?: number;
    maxReminderTimes?: number;
    miniprogramNotificationEnabled?: boolean;
  };
  aiConfig?: {
    provider?: 'pollinations';
    keyMode?: 'managed_child_key';
    pollinationsKeyRef?: string;
    pollinationsKeyName?: string;
    pollinationsMaskedKey?: string;
    allowedModels?: string[];
    pollenBudget?: number | null;
    lastSyncedAt?: string | Date | null;
  };
  aiUsageSnapshot?: {
    balance?: number;
    currency?: string;
    keyInfo?: {
      keyId?: string;
      keyName?: string;
      maskedKey?: string;
      valid?: boolean;
      allowedModels?: string[];
      pollenBudget?: number | null;
    } | null;
    lastSyncedAt?: string | Date | null;
    syncError?: string;
    summary?: {
      today?: {
        requests: number;
        costUsd: number;
      };
      recent7Days?: Array<{
        date: string;
        requests: number;
        costUsd: number;
      }>;
    };
  } | null;
}

export interface EnterpriseFormState {
  name: string;
  code: string;
  contactPerson: {
    name: string;
    phone: string;
    email: string;
  };
  logo: string;
  branding: {
    primaryColor: string;
    accentColor: string;
  };
  groundPromotionFixedCommission: string;
}

export const DEFAULT_ENTERPRISE_FORM: EnterpriseFormState = {
  name: '',
  code: '',
  contactPerson: { name: '', phone: '', email: '' },
  logo: '',
  branding: { primaryColor: '#171717', accentColor: '#0070f3' },
  groundPromotionFixedCommission: '0',
};
