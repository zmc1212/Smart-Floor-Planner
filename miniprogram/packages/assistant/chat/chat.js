const { aiEntriesEnabled } = require('../../../utils/ai-entries');
const { getRoleLanding } = require('../../../utils/identity-navigation');
const { freeDesignServiceUrl, serviceEntryCode } = require('../../../utils/service-entry');
const definition = require('./chat-definition')();

Page({
  ...definition,
  data: { ...definition.data, aiEntriesEnabled: false, chatEntryVisible: false },
  async onShow() {
    const pending = getApp().globalData.aiEntriesRequest;
    if (pending) await pending;
    if (this._alive && this.syncAiEntryVisibility()) return definition.onShow.call(this);
  },
  syncAiEntryVisibility() {
    if (!this._options) return false;
    const enabled = aiEntriesEnabled();
    const reportBoard = this._options.reportBoard === '1';
    const reportOnly = reportBoard || Boolean(this._ownerReport);
    if (enabled || reportOnly) {
      this.setData({ aiEntriesEnabled: enabled, chatEntryVisible: true,
        ...(!enabled && { reportBoard, ownerSiteReport: !reportBoard, followupActive: true }) });
      return true;
    }
    this.setData({ aiEntriesEnabled: false, chatEntryVisible: false });
    if (getApp().globalData.aiEntriesChecking) return false;
    if (this._aiEntryRedirecting) return false;
    this._aiEntryRedirecting = true;
    const code = serviceEntryCode(this._options.promotionCode);
    const { globalData } = getApp();
    const complete = () => { this._aiEntryRedirecting = false; };
    if (code) wx.redirectTo({ url: freeDesignServiceUrl(code), complete });
    else wx.reLaunch({ url: getRoleLanding(globalData.bootstrap?.current || globalData.userInfo) || '/pages/index/index', complete });
    return false;
  },
});
