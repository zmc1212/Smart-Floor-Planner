import path from 'node:path';
import { PlatformConfigRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';

export const ENTERPRISE_REGISTRATION_TEMPLATE_IDS = ['merchant-onboarding-v1'] as const;
export type EnterpriseRegistrationTemplateId =
  (typeof ENTERPRISE_REGISTRATION_TEMPLATE_IDS)[number];

export type EnterpriseRegistrationQrPlacement = {
  centerX: number;
  centerY: number;
  diameter: number;
  shape: 'circle' | 'square';
};

export type EnterpriseRegistrationCodeTemplateConfig = {
  templateId: EnterpriseRegistrationTemplateId;
  qrPlacement: EnterpriseRegistrationQrPlacement;
};

export const ENTERPRISE_REGISTRATION_TEMPLATE_LABELS: Record<
  EnterpriseRegistrationTemplateId,
  string
> = {
  'merchant-onboarding-v1': '家客来商户入驻',
};

export const DEFAULT_ENTERPRISE_REGISTRATION_CODE_TEMPLATE_CONFIG: EnterpriseRegistrationCodeTemplateConfig =
  {
    templateId: 'merchant-onboarding-v1',
    qrPlacement: {
      centerX: 0.5,
      centerY: 0.36,
      diameter: 0.24,
      shape: 'circle',
    },
  };

type StoredEnterpriseRegistrationCodeTemplateConfig =
  Partial<EnterpriseRegistrationCodeTemplateConfig> & {
    qrPlacement?: Partial<EnterpriseRegistrationQrPlacement>;
  };

function isTemplateConfigMigrationError(error: unknown) {
  const candidate = error as { code?: string; message?: string } | null;
  const message = String(candidate?.message || error || '').toLowerCase();
  return (
    candidate?.code === '42703' ||
    candidate?.code === '42P01' ||
    (message.includes('enterprise_registration_code_template_config') &&
      (message.includes('column') || message.includes('relation')))
  );
}

function clampRatio(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

function normalizeQrPlacement(
  input?: Partial<EnterpriseRegistrationQrPlacement> | null
): EnterpriseRegistrationQrPlacement {
  const defaults = DEFAULT_ENTERPRISE_REGISTRATION_CODE_TEMPLATE_CONFIG.qrPlacement;
  const shape = input?.shape === 'square' ? 'square' : 'circle';
  return {
    centerX: clampRatio(input?.centerX, defaults.centerX),
    centerY: clampRatio(input?.centerY, defaults.centerY),
    diameter: clampRatio(input?.diameter, defaults.diameter),
    shape,
  };
}

export function normalizeEnterpriseRegistrationCodeTemplateConfig(
  input?: StoredEnterpriseRegistrationCodeTemplateConfig | null
): EnterpriseRegistrationCodeTemplateConfig {
  const templateId = ENTERPRISE_REGISTRATION_TEMPLATE_IDS.includes(
    input?.templateId as EnterpriseRegistrationTemplateId
  )
    ? (input!.templateId as EnterpriseRegistrationTemplateId)
    : DEFAULT_ENTERPRISE_REGISTRATION_CODE_TEMPLATE_CONFIG.templateId;
  return {
    templateId,
    qrPlacement: normalizeQrPlacement(input?.qrPlacement),
  };
}

export function getEnterpriseRegistrationTemplateBackgroundPath(
  templateId: EnterpriseRegistrationTemplateId
) {
  return path.join(
    process.cwd(),
    'assets',
    'enterprise-registration-templates',
    `${templateId}.jpg`
  );
}

export async function getPlatformEnterpriseRegistrationCodeTemplateConfig(): Promise<EnterpriseRegistrationCodeTemplateConfig> {
  try {
    return await withPlatformTransaction(async (transaction) => {
      const config = await new PlatformConfigRepository(transaction).findByKey('default');
      return normalizeEnterpriseRegistrationCodeTemplateConfig(
        config?.enterpriseRegistrationCodeTemplateConfig as
          | StoredEnterpriseRegistrationCodeTemplateConfig
          | undefined
      );
    });
  } catch (error) {
    if (isTemplateConfigMigrationError(error)) {
      return DEFAULT_ENTERPRISE_REGISTRATION_CODE_TEMPLATE_CONFIG;
    }
    throw error;
  }
}

export async function savePlatformEnterpriseRegistrationCodeTemplateConfig(
  input: StoredEnterpriseRegistrationCodeTemplateConfig
): Promise<EnterpriseRegistrationCodeTemplateConfig> {
  const config = normalizeEnterpriseRegistrationCodeTemplateConfig(input);
  try {
    await withPlatformTransaction((transaction) =>
      new PlatformConfigRepository(transaction).upsert('default', {
        enterpriseRegistrationCodeTemplateConfig: config,
      })
    );
  } catch (error) {
    if (isTemplateConfigMigrationError(error)) {
      throw new Error('开户海报模板字段尚未完成数据库迁移，请先在 admin 目录运行 npm run db:migrate');
    }
    throw error;
  }
  return config;
}
