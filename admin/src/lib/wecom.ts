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
    enterprise: IEnterprise,
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
        ...staff.map(s => s.wecomUserId),
        boss?.wecomUserId
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
   * Send a message to the group (e.g., sharing the design)
   */
  static async sendMessage(enterprise: IEnterprise, chatId: string, content: string) {
    // Implementation for sending messages to WeCom group
    console.log(`[WeCom] Sending message to ${chatId}: ${content}`);
  }
}
