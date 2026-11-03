const api = require('../../../utils/api');
const original = require('../public-sites/public-page').page(true);
Page({
  ...original,
  data: { ...original.data, liveEntry: null },
  onLoad(options) {
    original.onLoad.call(this, options); this.liveEpoch=0;
    this.controller.emit=patch=>{
      if(!this.alive)return;this.setData(patch);
      if(patch.site)this.readLiveEntry(patch.site);
      else if(patch.site===null){this.liveEpoch++;this.setData({liveEntry:null});}
    };
  },
  async readLiveEntry(site) {
    const epoch=++this.liveEpoch;this.setData({liveEntry:null});
    try {const r=await api.request('/public/construction-live/'+this.options.enterpriseId+'/site/'+site.id,'GET',{}, {suppressUnauthorized:true});
      if(this.alive&&this.shown&&epoch===this.liveEpoch)this.setData({liveEntry:r?.success?r.data:null});
    }catch(_){if(this.alive&&epoch===this.liveEpoch)this.setData({liveEntry:null});}
  },
  watchLive() {
    const live=this.data.liveEntry,site=this.data.site;if(!live||!site||!/^[a-f0-9]{48}$/.test(live.key))return;
    const values={enterpriseId:this.options.enterpriseId,key:live.key,siteId:site.id,versionId:site.versionId,...(this.options.conversationId?{conversationId:this.options.conversationId}:{})};
    wx.navigateTo({url:'/packages/construction/public-live/public-live?'+Object.entries(values).map(([k,v])=>k+'='+encodeURIComponent(v)).join('&')});
  },
  onHide() {this.liveEpoch++;this.setData({liveEntry:null});original.onHide.call(this);},
  onUnload() {this.liveEpoch++;original.onUnload.call(this);},
});
