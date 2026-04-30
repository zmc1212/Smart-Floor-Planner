export interface EnterpriseListItem {
  _id: string;
  name: string;
  code: string;
  status: 'pending_approval' | 'active' | 'disabled';
  registrationMode: 'self_service' | 'manual';
  createdAt?: string;
  logo?: string;
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
    wecomReminderEnabled?: boolean;
    reminderIntervalHours?: number;
    maxReminderTimes?: number;
  };
  wecomConfig?: {
    corpId?: string;
    agentId?: string;
  };
  wecomConfigConfigured?: boolean;
  wecomSecretConfigured?: boolean;
  wecomMemberStats?: {
    totalStaff: number;
    configuredStaff: number;
  };
  aiConfig?: {
    provider?: 'pollinations';
    keyMode?: 'managed_child_key';
    pollinationsKeyRef?: string;
    pollinationsKeyName?: string;
    pollinationsMaskedKey?: string;
    allowedModels?: string[];
    pollenBudget?: number | null;
    status?: 'active' | 'disabled' | 'revoked';
    lastSyncedAt?: string | Date | null;
  };
  aiUsageSnapshot?: {
    balance?: number;
    currency?: string;
    keyInfo?: {
      keyId?: string;
      keyName?: string;
      maskedKey?: string;
      status?: string;
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
  automationConfig: {
    followUpSlaHours: string;
    measureTaskSlaHours: string;
    designTaskSlaHours: string;
    reminderIntervalHours: string;
    maxReminderTimes: string;
    wecomReminderEnabled: boolean;
  };
}

export const DEFAULT_ENTERPRISE_FORM: EnterpriseFormState = {
  name: '',
  code: '',
  contactPerson: { name: '', phone: '', email: '' },
  logo: '',
  branding: { primaryColor: '#171717', accentColor: '#0070f3' },
  groundPromotionFixedCommission: '0',
  automationConfig: {
    followUpSlaHours: '24',
    measureTaskSlaHours: '48',
    designTaskSlaHours: '72',
    reminderIntervalHours: '24',
    maxReminderTimes: '3',
    wecomReminderEnabled: true,
  },
};
