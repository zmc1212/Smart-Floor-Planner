import { PlatformConfigRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';

export const SUBSCRIPTION_TEMPLATE_KINDS = [
  'workflow_todo',
  'lead_assignment',
  'new_lead',
  'measurement_appointment',
] as const;

export type SubscriptionTemplateKind = (typeof SUBSCRIPTION_TEMPLATE_KINDS)[number];

export interface SubscriptionTemplateConfig {
  title: string;
  templateId: string;
  keywordKeys: Record<string, string>;
}

export interface PlatformNotificationConfigV2 {
  version: 2;
  legacyTemplateId?: string;
  templates: Record<SubscriptionTemplateKind, SubscriptionTemplateConfig>;
}

export interface PlatformNotificationConfigDto extends PlatformNotificationConfigV2 {
  /** @deprecated Kept for one release so an older Mini Program can still subscribe. */
  miniprogramTemplateId: string;
}

type TemplatePatch = { templateId?: unknown };

export type PlatformNotificationConfigInput = {
  version?: unknown;
  legacyTemplateId?: unknown;
  miniprogramTemplateId?: unknown;
  templates?: Partial<Record<SubscriptionTemplateKind, TemplatePatch | unknown>>;
};

export const DEFAULT_SUBSCRIPTION_TEMPLATES: Record<
  SubscriptionTemplateKind,
  SubscriptionTemplateConfig
> = {
  workflow_todo: {
    title: '装修待办提醒',
    templateId: '48Jvq7OjOKwRhshn8fyvtsjxAamLOakaNtiKcO11rOc',
    keywordKeys: {
      projectName: 'thing4',
      owner: 'thing11',
      currentStatus: 'phrase12',
      todo: 'thing2',
      note: 'thing5',
    },
  },
  lead_assignment: {
    title: '客户指派成功通知',
    templateId: 'wltuS0LdggzpMWdSOlr6FBSKeRbOKUzqXVCqJDmLpmA',
    keywordKeys: {
      customerName: 'thing1',
      customerStatus: 'phrase2',
      note: 'thing3',
      assignedAt: 'time4',
    },
  },
  new_lead: {
    title: '新增客户成功通知',
    templateId: 'EEvg03Lsp4V0ASHWhLOMiTmDI79Z_T3Sjq4xest9GRc',
    keywordKeys: {
      customerName: 'name1',
      addedAt: 'date2',
      owner: 'name3',
      phone: 'phone_number4',
      selectedAt: 'time5',
    },
  },
  measurement_appointment: {
    title: '上门量房提醒',
    templateId: 'CtcuQ_NWF4GOpHvstgviDPmYRlSjyqTjnFAoeQR9-vl',
    keywordKeys: {
      customerName: 'thing1',
      phone: 'phone_number2',
      community: 'thing3',
      measurementAt: 'time6',
      reminder: 'thing7',
    },
  },
};

function cloneDefaultTemplate(kind: SubscriptionTemplateKind): SubscriptionTemplateConfig {
  const template = DEFAULT_SUBSCRIPTION_TEMPLATES[kind];
  return { ...template, keywordKeys: { ...template.keywordKeys } };
}

function optionalTemplateId(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function validateMiniProgramTemplateId(value: unknown) {
  const templateId = optionalTemplateId(value);
  if (!/^[A-Za-z0-9_-]{10,128}$/.test(templateId)) {
    throw new Error('Invalid Mini Program subscription template ID');
  }
  return templateId;
}

export function normalizePlatformNotificationConfig(
  input?: PlatformNotificationConfigInput | null
): PlatformNotificationConfigDto {
  const templates = Object.fromEntries(
    SUBSCRIPTION_TEMPLATE_KINDS.map((kind) => {
      const fallback = cloneDefaultTemplate(kind);
      const candidate = input?.templates?.[kind];
      const candidateObject =
        candidate && typeof candidate === 'object'
          ? (candidate as Record<string, unknown>)
          : undefined;
      const templateId = optionalTemplateId(candidateObject?.templateId) || fallback.templateId;
      return [kind, { ...fallback, templateId }];
    })
  ) as Record<SubscriptionTemplateKind, SubscriptionTemplateConfig>;
  const legacyTemplateId =
    optionalTemplateId(input?.legacyTemplateId) ||
    (Number(input?.version) === 2 ? '' : optionalTemplateId(input?.miniprogramTemplateId));

  return {
    version: 2,
    ...(legacyTemplateId ? { legacyTemplateId } : {}),
    templates,
    miniprogramTemplateId: templates.workflow_todo.templateId,
  };
}

function storedConfig(config: PlatformNotificationConfigDto): Record<string, unknown> {
  return {
    version: 2,
    ...(config.legacyTemplateId ? { legacyTemplateId: config.legacyTemplateId } : {}),
    templates: config.templates,
  };
}

export function validateDistinctTemplateIds(templates: PlatformNotificationConfigDto['templates']) {
  const ids = SUBSCRIPTION_TEMPLATE_KINDS.map((kind) => templates[kind].templateId);
  if (new Set(ids).size !== ids.length) {
    throw new Error('Mini Program subscription template IDs must be unique');
  }
}

export async function getPlatformNotificationConfig(): Promise<PlatformNotificationConfigDto> {
  return withPlatformTransaction(async (transaction) => {
    const config = await new PlatformConfigRepository(transaction).findByKey('default');
    return normalizePlatformNotificationConfig(
      config?.notificationConfig as PlatformNotificationConfigInput | undefined
    );
  });
}

export async function savePlatformNotificationConfig(input: PlatformNotificationConfigInput) {
  return withPlatformTransaction(async (transaction) => {
    const repository = new PlatformConfigRepository(transaction);
    const record = await repository.findByKey('default');
    const current = normalizePlatformNotificationConfig(
      record?.notificationConfig as PlatformNotificationConfigInput | undefined
    );
    const next = normalizePlatformNotificationConfig(current);

    if (input.templates && typeof input.templates === 'object') {
      for (const kind of SUBSCRIPTION_TEMPLATE_KINDS) {
        const candidate = input.templates[kind];
        if (!candidate || typeof candidate !== 'object') {
          throw new Error(`Missing Mini Program subscription template: ${kind}`);
        }
        next.templates[kind].templateId = validateMiniProgramTemplateId(
          (candidate as TemplatePatch).templateId
        );
      }
    } else {
      const legacyTemplateId = validateMiniProgramTemplateId(input.miniprogramTemplateId);
      next.templates.workflow_todo.templateId = legacyTemplateId;
    }

    validateDistinctTemplateIds(next.templates);
    next.miniprogramTemplateId = next.templates.workflow_todo.templateId;
    await repository.upsert('default', { notificationConfig: storedConfig(next) });
    return next;
  });
}

export async function getMiniProgramSubscriptionTemplates() {
  const config = await getPlatformNotificationConfig();
  return SUBSCRIPTION_TEMPLATE_KINDS.map((type) => ({ type, ...config.templates[type] }));
}

export async function getMiniProgramSubscriptionTemplate(kind: SubscriptionTemplateKind) {
  const config = await getPlatformNotificationConfig();
  return config.templates[kind];
}

/** @deprecated Use getMiniProgramSubscriptionTemplate with an explicit semantic kind. */
export async function getMiniProgramNotificationTemplateId() {
  const config = await getPlatformNotificationConfig();
  return config.miniprogramTemplateId;
}
