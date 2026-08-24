import AliyunSmsClient, { SendSmsRequest } from '@alicloud/dysmsapi20170525';
import * as AliyunOpenApi from '@alicloud/openapi-client';
import { BasicCredential } from 'tencentcloud-sdk-nodejs-common/tencentcloud/common/credential';
import { Client as TencentSmsClient } from 'tencentcloud-sdk-nodejs-sms/tencentcloud/services/sms/v20210111/sms_client';
import type { SendSmsRequest as TencentSendSmsRequest } from 'tencentcloud-sdk-nodejs-sms/tencentcloud/services/sms/v20210111/sms_models';
import type { SmsProvider } from '@/lib/sms-config';

export type SmsProviderConfig =
  | { provider: 'aliyun'; accessKeyId: string; secretKey: string; signName: string; templateCode: string; region: string }
  | { provider: 'tencent'; secretId: string; secretKey: string; sdkAppId: string; signName: string; templateCode: string; region: string };

export type SmsSendResult = {
  success: boolean;
  providerMessageId?: string | null;
  providerRequestId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export function mapAliyunSmsResponse(body: { code?: string; message?: string; bizId?: string; requestId?: string } | null | undefined): SmsSendResult {
  if (body?.code !== 'OK') {
    return {
      success: false,
      providerRequestId: body?.requestId || null,
      errorCode: body?.code || 'ALIYUN_SMS_ERROR',
      errorMessage: body?.message || '阿里云短信发送失败',
    };
  }
  return { success: true, providerMessageId: body.bizId || null, providerRequestId: body.requestId || null };
}

export function mapTencentSmsResponse(response: { SendStatusSet?: Array<{ Code?: string; Message?: string; SerialNo?: string }>; RequestId?: string } | null | undefined): SmsSendResult {
  const status = response?.SendStatusSet?.[0];
  if (!status || status.Code !== 'Ok') {
    return {
      success: false,
      providerRequestId: response?.RequestId || null,
      errorCode: status?.Code || 'TENCENT_SMS_ERROR',
      errorMessage: status?.Message || '腾讯云短信发送失败',
    };
  }
  return { success: true, providerMessageId: status.SerialNo || null, providerRequestId: response?.RequestId || null };
}

function errorResult(error: unknown): SmsSendResult {
  if (error && typeof error === 'object') {
    const value = error as { code?: unknown; message?: unknown; requestId?: unknown };
    return {
      success: false,
      errorCode: value.code ? String(value.code) : 'SMS_PROVIDER_ERROR',
      errorMessage: value.message ? String(value.message) : '短信供应商请求失败',
      providerRequestId: value.requestId ? String(value.requestId) : null,
    };
  }
  return { success: false, errorCode: 'SMS_PROVIDER_ERROR', errorMessage: String(error || '短信供应商请求失败') };
}

async function sendAliyun(config: Extract<SmsProviderConfig, { provider: 'aliyun' }>, phone: string, templateParams: Record<string, string>) {
  try {
    const apiConfig = new AliyunOpenApi.Config({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.secretKey,
      regionId: config.region,
      endpoint: 'dysmsapi.aliyuncs.com',
      readTimeout: 10000,
      connectTimeout: 10000,
    });
    const client = new AliyunSmsClient(apiConfig);
    const request = new SendSmsRequest({
      phoneNumbers: phone,
      signName: config.signName,
      templateCode: config.templateCode,
      templateParam: JSON.stringify(templateParams || {}),
    });
    const response = await client.sendSms(request);
    const body = response.body;
    return mapAliyunSmsResponse(body);
  } catch (error) {
    return errorResult(error);
  }
}

async function sendTencent(config: Extract<SmsProviderConfig, { provider: 'tencent' }>, phone: string, templateParams: Record<string, string>) {
  try {
    const client = new TencentSmsClient({
      credential: new BasicCredential(config.secretId, config.secretKey),
      region: config.region,
      profile: {
        signMethod: 'TC3-HMAC-SHA256',
        httpProfile: { reqMethod: 'POST', reqTimeout: 10 },
      },
    });
    const request: TencentSendSmsRequest = {
      PhoneNumberSet: [phone],
      SmsSdkAppId: config.sdkAppId,
      TemplateId: config.templateCode,
      SignName: config.signName,
      TemplateParamSet: Object.values(templateParams || {}),
    };
    const response = await client.SendSms(request);
    return mapTencentSmsResponse(response);
  } catch (error) {
    return errorResult(error);
  }
}

export async function sendSms(input: {
  provider: SmsProvider;
  config: SmsProviderConfig;
  phone: string;
  templateParams?: Record<string, string>;
}): Promise<SmsSendResult> {
  const params = input.templateParams || {};
  if (input.provider === 'aliyun') return sendAliyun(input.config as Extract<SmsProviderConfig, { provider: 'aliyun' }>, input.phone, params);
  return sendTencent(input.config as Extract<SmsProviderConfig, { provider: 'tencent' }>, input.phone, params);
}
