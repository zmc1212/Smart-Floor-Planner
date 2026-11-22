const ID = /^[1-9]\d{0,18}$/;
const locationPath = cid => '/conversations/' + cid + '/location';
const fallback = '暂未获取到定位，可以重试，或在对话里告诉我房屋所在城市。';

/** Coordinates live only in this request. Never write them to storage, a chat
 * message, the pending-operation journal, or a model prompt. */
class NearbyLocationController {
  constructor({ client, identity }) { this.client = client; this.identity = identity; this.epoch = 0; }
  clear() { this.epoch++; this.cached = null; this.pending = null; this.denied = null; }
  async ensure(cid, requestPermission = false) {
    if (!ID.test(String(cid)) || !this.identity() || typeof wx.getSetting !== 'function') return {};
    if (this.pending && this.pendingCid === cid && this.pendingSession === this.identity()) return this.pending;
    if (this.pending) this.clear();
    const epoch = this.epoch, session = this.identity();
    const valid = () => this.epoch === epoch && this.identity() === session;
    // A denied or unresolvable location stays cleared server-side; repeating
    // the whole delete/refresh chain on every show (or send) only produced
    // duplicate writes and rate-limit noise. Explicit permission requests
    // always retry so a newly granted scope is picked up immediately.
    const deniedLatch = () => this.denied && this.denied.session === session && Date.now() - this.denied.at < 5 * 60 * 1000;
    const run = async () => {
      try {
        const setting = await new Promise((resolve, reject) => wx.getSetting({ success: resolve, fail: reject }));
        if (!valid()) return {};
        const granted = setting.authSetting && setting.authSetting['scope.userLocation'];
        // A recently denied or unresolvable location is already cleared
        // server-side; repeating the chain only produced duplicate writes and
        // rate-limit noise. Explicit permission requests always retry.
        if (!requestPermission && deniedLatch()) return {};
        if (granted !== true && (granted === false || !requestPermission)) {
          await this.client.read(locationPath(cid), {}, {}, 'DELETE');
          this.cached = null;
          if (!requestPermission) this.denied = { session, at: Date.now() };
          return valid() ? { changed: true, notice: requestPermission ? '定位未授权，可以在微信设置中允许后重试，或告诉我房屋所在城市。' : '' } : {};
        }
        if (this.cached?.cid === cid && this.cached.session === session && Date.now() - this.cached.at < 5 * 60 * 1000) return { region: this.cached.region };
        const saved = await this.client.read(locationPath(cid));
        if (!valid()) return {};
        const age = Date.now() - Date.parse(saved.region?.resolvedAt);
        if (saved.region?.source === 'wechat_location' && age >= 0 && age < 5 * 60 * 1000) {
          this.cached = { cid, session, region: saved.region, at: Date.now() - age };
          return { region: saved.region };
        }
        if (typeof wx.getLocation !== 'function') return { notice: fallback };
        const point = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject({ errMsg: 'getLocation:fail timeout' }), 12000);
          wx.getLocation({ type: 'gcj02', success: result => { clearTimeout(timer); resolve(result); }, fail: error => { clearTimeout(timer); reject(error); } });
        });
        if (!valid()) return {};
        if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) throw Error('invalid_location');
        const data = await this.client.read(locationPath(cid), { latitude: point.latitude, longitude: point.longitude, coordinateSystem: 'gcj02' }, {}, 'POST');
        if (!valid()) return {};
        if (!data.region?.cityCode || !data.region?.cityName || data.region.source !== 'wechat_location') throw Error('invalid_location');
        this.cached = { cid, session, region: data.region, at: Date.now() };
        this.denied = null;
        return { changed: true, region: data.region };
      } catch (_) {
        if (!valid()) return {};
        this.cached = null;
        // A denial, failed fix or failed reverse lookup must not reuse yesterday's area.
        try { await this.client.read(locationPath(cid), {}, {}, 'DELETE'); }
        catch (_) { return { notice: fallback, blocked: true }; }
        if (!requestPermission) this.denied = { session, at: Date.now() };
        return valid() ? { changed: true, notice: fallback } : {};
      }
    };
    const pending = run(); this.pending = pending; this.pendingCid = cid; this.pendingSession = session;
    try { return await pending; } finally { if (this.pending === pending) this.pending = null; }
  }
}
module.exports = { NearbyLocationController, locationPath };
