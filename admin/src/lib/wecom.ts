import { IEnterprise } from '@/models/Enterprise';
import { AdminUser } from '@/models/AdminUser';

/**
 * WeCom Integration Service
 */
export class WeComService {
  /**
   * Automatically create a group chat for a new lead
   * @param enterprise The enterprise object with WeCom config
   * @param leadData Data of the lead (customer)
   * @param staffIds IDs of the promoter and designer
   */
  static async createLeadGroup(
    enterprise: any,
    leadName: string,
    promoterId: string,
    designerId: string
  ) {
    if (!enterprise.wecomConfig?.corpId || !enterprise.wecomConfig?.secret) {
      console.log(`[WeCom] Skipping group creation for ${enterprise.name}: Missing config`);
      return null;
    }

    try {
      // 1. Get WeCom User IDs for all participants
      const staff = await AdminUser.find({
        _id: { $in: [promoterId, designerId] }
      }).select('wecomUserId role');

      // Also find the enterprise admin (Boss)
      const boss = await AdminUser.findOne({
        enterpriseId: enterprise._id,
        role: 'enterprise_admin'
      }).select('wecomUserId');

      const userIds = [
        ...staff.map((s: any) => s.wecomUserId),
        (boss as any)?.wecomUserId
      ].filter(Boolean) as string[];

      if (userIds.length === 0) {
        console.log(`[WeCom] No WeCom UserIDs found for staff in ${enterprise.name}`);
        return null;
      }

      console.log(`[WeCom] Triggering group creation for lead: ${leadName} with members: ${userIds.join(',')}`);
      
      // Note: Real WeCom implementation would call:
      // POST https://qyapi.weixin.qq.com/cgi-bin/externalcontact/groupchat/create
      // For now, we simulate the success and return a dummy group ID
      
      const mockGroupId = `wr_group_${Math.random().toString(36).substr(2, 9)}`;
      
      return mockGroupId;
    } catch (error) {
      console.error('[WeCom] Group creation failed:', error);
      return null;
    }
  }

  /**
   * Internal helper to get WeCom Access Token
   */
  private static async getAccessToken(corpId: string, secret: string): Promise<string | null> {
    try {
      const res = await fetch(
        `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${secret}`
      );
      const data = await res.json();
      return data.access_token || null;
    } catch (error) {
      console.error('[WeCom] Failed to get access token:', error);
      return null;
    }
  }

  /**
   * Send a message to the group (e.g., sharing the design)
   */
  static async sendMessage(enterprise: any, chatId: string, content: string) {
    const { corpId, secret } = enterprise.wecomConfig || {};
    if (!corpId || !secret) return false;

    const token = await this.getAccessToken(corpId, secret);
    if (!token) return false;

    try {
      const res = await fetch(
        `https://qyapi.weixin.qq.com/cgi-bin/externalcontact/groupchat/send_msg?access_token=${token}`,
        {
          method: 'POST',
          body: JSON.stringify({
            chat_id: chatId,
            msgtype: 'text',
            text: { content }
          })
        }
      );
      const data = await res.json();
      return data.errcode === 0;
    } catch (error) {
      console.error('[WeCom] Message sending failed:', error);
      return false;
    }
  }

  /**
   * Send a text app message to internal WeCom users.
   */
  static async sendAppMessageToUsers(enterprise: any, userIds: string[], content: string) {
    const { corpId, secret, agentId } = enterprise?.wecomConfig || {};
    if (!corpId || !secret || !agentId) {
      return { success: false, reason: 'missing_config' as const };
    }

    const recipients = userIds.filter(Boolean);
    if (recipients.length === 0) {
      return { success: false, reason: 'no_recipients' as const };
    }

    const token = await this.getAccessToken(corpId, secret);
    if (!token) {
      return { success: false, reason: 'missing_token' as const };
    }

    try {
      const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: recipients.join('|'),
          msgtype: 'text',
          agentid: Number(agentId),
          text: { content },
          safe: 0,
        }),
      });

      const data = await res.json();
      if (data.errcode === 0) {
        return { success: true as const };
      }

      return { success: false as const, reason: data.errmsg || `errcode:${data.errcode}` };
    } catch (error: any) {
      console.error('[WeCom] App message sending failed:', error);
      return { success: false as const, reason: error?.message || 'unknown_error' };
    }
  }
}
