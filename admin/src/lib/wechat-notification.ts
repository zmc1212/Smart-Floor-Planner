import { AdminUser } from '@/models/AdminUser';
import mongoose from 'mongoose';

const WX_APPID = process.env.WX_APPID;
const WX_APPSECRET = process.env.WX_APPSECRET;

let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

/**
 * Get WeChat Access Token
 */
async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now) {
    return cachedToken;
  }

  try {
    const response = await fetch(
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${WX_APPID}&secret=${WX_APPSECRET}`
    );
    const data = await response.json();

    if (data.access_token) {
      cachedToken = data.access_token;
      tokenExpiresAt = now + (data.expires_in - 200) * 1000;
      return cachedToken;
    } else {
      console.error('Failed to get WeChat access token:', data);
      return null;
    }
  } catch (error) {
    console.error('Error fetching WeChat access token:', error);
    return null;
  }
}

export interface SubscriptionMessageData {
  touser: string;
  template_id: string;
  page?: string;
  data: Record<string, { value: string }>;
  miniprogram_state?: 'developer' | 'trial' | 'formal';
}

/**
 * Send Mini Program Subscription Message
 */
export async function sendSubscriptionMessage(params: SubscriptionMessageData) {
  const token = await getAccessToken();
  if (!token) return { success: false, error: 'No access token' };

  try {
    const response = await fetch(
      `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...params,
          miniprogram_state: process.env.NODE_ENV === 'production' ? 'formal' : 'developer',
        }),
      }
    );
    const data = await response.json();

    if (data.errcode === 0) {
      return { success: true };
    } else {
      console.error('Failed to send subscription message:', data);
      return { success: false, error: data.errmsg, code: data.errcode };
    }
  } catch (error) {
    console.error('Error sending subscription message:', error);
    return { success: false, error: 'Network error' };
  }
}

/**
 * Global Template ID for all notifications
 */
const GLOBAL_TEMPLATE_ID = 'j6WMWNX3_-NKfuZPs7XuHYz91EymYKcnob1uDziK5f4';

/**
 * Notify Platform Admins about new enterprise reports
 */
export async function notifyPlatformAdminOfNewReport(record: any) {
  const admins = await AdminUser.find({
    role: { $in: ['super_admin', 'admin'] },
    openid: { $exists: true, $ne: null }
  }).lean();

  if (admins.length === 0) return;

  for (const admin of admins) {
    if (!admin.openid) continue;

    await sendSubscriptionMessage({
      touser: admin.openid,
      template_id: GLOBAL_TEMPLATE_ID,
      page: '/pages/index/index', 
      data: {
        thing1: { value: record.promotionStaffName || '系统助手' },
        time2: { value: new Date().toLocaleString('zh-CN', { hour12: false }) },
        thing3: { value: '新企业入驻报备' },
        thing4: { value: `企业:${record.enterpriseName}, 联系人:${record.contactPerson}, 电话:${record.phone}` }
      }
    });
  }
}

/**
 * Notify Enterprise Admin of new lead
 */
export async function notifyEnterpriseAdminOfNewLead(lead: any) {
  if (!lead.enterpriseId) return;

  const admins = await AdminUser.find({
    enterpriseId: lead.enterpriseId,
    role: 'enterprise_admin',
    openid: { $exists: true, $ne: null }
  }).lean();

  if (admins.length === 0) return;

  for (const admin of admins) {
    if (!admin.openid) continue;

    await sendSubscriptionMessage({
      touser: admin.openid,
      template_id: GLOBAL_TEMPLATE_ID,
      page: '/pages/leads-management/leads-management',
      data: {
        thing1: { value: '前端录入人员' },
        time2: { value: new Date().toLocaleString('zh-CN', { hour12: false }) },
        thing3: { value: '新客户分配' },
        thing4: { value: `客户:${lead.name}, 电话:${lead.phone}, 城市:${lead.city || '未知'}` }
      }
    });
  }
}

/**
 * Notify Designer of assigned lead
 */
export async function notifyDesignerOfAssignedLead(lead: any, designerId: string) {
  const designer = await AdminUser.findById(designerId).lean();
  if (!designer || !designer.openid) return;

  await sendSubscriptionMessage({
    touser: designer.openid,
    template_id: GLOBAL_TEMPLATE_ID,
    page: '/pages/leads-management/leads-management',
    data: {
      thing1: { value: '管理员' },
      time2: { value: new Date().toLocaleString('zh-CN', { hour12: false }) },
      thing3: { value: '线索派单提醒' },
      thing4: { value: `请尽快跟进客户: ${lead.name}，开启方案设计。` }
    }
  });
}
