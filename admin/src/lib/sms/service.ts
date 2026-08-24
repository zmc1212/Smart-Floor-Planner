import { parsePostgresId } from '@/db/postgres-dto';
import { SmsDeliveryLogRepository, AdminUserRepository } from '@/db/repositories';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { getSmsProviderRuntimeConfig, getSmsRuntimeConfig, SMS_COPY, type SmsProvider } from '@/lib/sms-config';
import { decryptText, encryptText } from '@/lib/crypto';
import { sendSms, type SmsProviderConfig } from './providers';

const PHONE_PATTERN = /^(?:\+?86)?1[3-9]\d{9}$/;

export function normalizeSmsPhone(phone: string | null | undefined) {
  const value = String(phone || '').trim().replace(/[\s-]/g, '');
  if (!PHONE_PATTERN.test(value)) return null;
  return value.startsWith('+86') ? value : value.startsWith('86') ? `+${value}` : `+86${value}`;
}

export function maskSmsPhone(phone: string | null | undefined) {
  const value = String(phone || '').trim();
  return value.length >= 7 ? `${value.slice(0, 3)}****${value.slice(-4)}` : '未登记电话';
}

export function shouldDedupeSmsLog(status: string) {
  return status === 'sent' || status === 'pending';
}

function runtimeProviderConfig(runtime: Awaited<ReturnType<typeof getSmsRuntimeConfig>>) {
  if (!runtime.config) return null;
  if (runtime.provider === 'aliyun') return { provider: 'aliyun' as const, ...runtime.config };
  return { provider: 'tencent' as const, ...runtime.config };
}

async function sendLog(logId: bigint, provider: SmsProvider, config: SmsProviderConfig, phone: string) {
  const result = await sendSms({ provider, config, phone, templateParams: {} });
  await withPlatformTransaction((transaction) =>
    new SmsDeliveryLogRepository(transaction).markResult(logId, {
      status: result.success ? 'sent' : 'failed',
      providerMessageId: result.providerMessageId,
      providerRequestId: result.providerRequestId,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      incrementAttempt: true,
    })
  );
  return result;
}

export async function sendAssignedDesignerSms(input: {
  enterpriseId: bigint | string;
  leadId: bigint | string;
  designerId: bigint | string;
}) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterprise id');
  const leadId = parsePostgresId(input.leadId, 'lead id');
  const designerId = parsePostgresId(input.designerId, 'designer id');
  const staff = await withTenantTransaction(enterpriseId, (transaction) =>
    new AdminUserRepository(transaction).findById(designerId)
  );
  if (!staff || staff.role !== 'designer') return { success: false, skipped: true, error: 'designer unavailable' };

  const phone = normalizeSmsPhone(staff.phone);
  let runtime: Awaited<ReturnType<typeof getSmsRuntimeConfig>>;
  let runtimeError: string | null = null;
  try {
    runtime = await getSmsRuntimeConfig();
  } catch (error) {
    runtimeError = error instanceof Error ? error.message : '短信配置读取失败';
    runtime = { enabled: true, provider: 'aliyun', config: null };
  }
  const providerConfig = runtimeProviderConfig(runtime);
  const provider = runtime.provider;
  const dedupeKey = `lead_assignment_sms:${leadId.toString()}:${designerId.toString()}`;
  let log = await withTenantTransaction(enterpriseId, (transaction) =>
    new SmsDeliveryLogRepository(transaction).create({
      enterpriseId,
      leadId,
      recipientStaffId: designerId,
      phoneEncrypted: phone ? encryptText(phone) : null,
      phoneMasked: maskSmsPhone(staff.phone),
      provider,
      templateCode: providerConfig?.templateCode || '',
      signName: providerConfig?.signName || '',
      message: SMS_COPY,
      kind: 'lead_assignment',
      status: 'pending',
      dedupeKey,
    })
  );
  if (!log) {
    log = await withTenantTransaction(enterpriseId, (transaction) =>
      new SmsDeliveryLogRepository(transaction).findByDedupeKey(dedupeKey)
    );
    if (!log) return { success: false, error: 'sms log unavailable' };
    if (shouldDedupeSmsLog(log.status)) return { success: true, deduped: true };
  }
  if (!phone) {
    await withTenantTransaction(enterpriseId, (transaction) =>
      new SmsDeliveryLogRepository(transaction).markResult(log.id, {
        status: 'skipped',
        errorCode: 'PHONE_UNAVAILABLE',
        errorMessage: '设计师未登记有效手机号',
        incrementAttempt: false,
      })
    );
    return { success: false, skipped: true, error: 'phone unavailable' };
  }
  if (runtimeError || !runtime.enabled || !providerConfig) {
    await withTenantTransaction(enterpriseId, (transaction) =>
      new SmsDeliveryLogRepository(transaction).markResult(log.id, {
        status: runtimeError ? 'failed' : 'skipped',
        errorCode: runtimeError ? 'SMS_CONFIG_ERROR' : runtime.enabled ? 'SMS_CONFIG_INCOMPLETE' : 'SMS_DISABLED',
        errorMessage: runtimeError || (runtime.enabled ? '当前短信供应商配置不完整' : '短信通知未启用'),
        incrementAttempt: false,
      })
    );
    return { success: false, skipped: true, error: 'sms unavailable' };
  }
  return sendLog(log.id, provider, providerConfig, phone);
}

export async function sendSmsTest(phoneInput: string) {
  const phone = normalizeSmsPhone(phoneInput);
  if (!phone) throw new Error('请输入有效的手机号');
  const runtime = await getSmsRuntimeConfig();
  const providerConfig = runtimeProviderConfig(runtime);
  if (!runtime.enabled || !providerConfig) throw new Error('请先启用并完整配置当前短信供应商');
  const log = await withPlatformTransaction((transaction) =>
    new SmsDeliveryLogRepository(transaction).create({
      enterpriseId: null,
      leadId: null,
      recipientStaffId: null,
      phoneEncrypted: encryptText(phone),
      phoneMasked: maskSmsPhone(phone),
      provider: runtime.provider,
      templateCode: providerConfig.templateCode,
      signName: providerConfig.signName,
      message: SMS_COPY,
      kind: 'test',
      status: 'pending',
      dedupeKey: `sms_test:${runtime.provider}:${phone}:${Date.now()}`,
    })
  );
  if (!log) throw new Error('创建测试短信记录失败');
  return sendLog(log.id, runtime.provider, providerConfig, phone);
}

export async function retrySmsDeliveryLog(idInput: string) {
  const id = parsePostgresId(idInput, 'sms log id');
  const log = await withPlatformTransaction((transaction) =>
    new SmsDeliveryLogRepository(transaction).prepareRetry(id)
  );
  if (!log) throw new Error('仅可重试发送失败的短信记录');
  const provider = log.provider === 'tencent' ? 'tencent' : 'aliyun';
  const runtime = await getSmsProviderRuntimeConfig(provider);
  const providerConfig = runtimeProviderConfig(runtime);
  const phone = normalizeSmsPhone(log.phoneEncrypted ? decryptText(log.phoneEncrypted) : null);
  if (!runtime.enabled || !providerConfig || !phone) {
    return withPlatformTransaction((transaction) =>
      new SmsDeliveryLogRepository(transaction).markResult(id, {
        status: 'failed',
        errorCode: !phone ? 'PHONE_UNAVAILABLE' : runtime.enabled ? 'SMS_CONFIG_INCOMPLETE' : 'SMS_DISABLED',
        errorMessage: !phone ? '记录中的手机号不可重试' : '当前短信供应商未就绪',
        incrementAttempt: false,
      })
    );
  }
  return sendLog(
    id,
    provider,
    { ...providerConfig, signName: log.signName, templateCode: log.templateCode },
    phone
  );
}
