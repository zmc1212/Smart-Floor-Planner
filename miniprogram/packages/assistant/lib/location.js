const ID = /^[1-9]\d{0,18}$/;
const locationPath = cid => '/conversations/' + cid + '/location';
const fallback = '暂未获取到定位，可以重试，或在对话里告诉我房屋所在城市。';
const deniedNotice = '定位未授权，可以在微信设置中允许后重试，或告诉我房屋所在城市。';
const REUSE_MS = 5 * 60 * 1000;

/** Coordinates live only in this request. Never write them to storage, a chat
 * message, the pending-operation journal, or a model prompt. */
class NearbyLocationController {
  constructor({ client, identity }) { this.client = client; this.identity = identity; this.epoch = 0; }
  clear() { this.epoch++; this.cached = null; this.pending = null; }
  valid(operation) { return this.epoch === operation.epoch && this.identity() === operation.session; }

  async ensure(cid, requestPermission = false, fresh = false) {
    const session = this.identity();
    if (!ID.test(String(cid)) || !session || typeof wx === 'undefined' || typeof wx.getSetting !== 'function') return {};
    const pending = this.pending;
    if (pending?.cid === cid && pending.session === session) {
      if (requestPermission && !pending.explicit) {
        if (pending.clearing || pending.skipped) {
          await pending.result;
          return this.valid(pending) ? this.ensure(cid, true) : {};
        }
        pending.explicit = true;
      }
      return pending.result;
    }
    if (pending) this.clear();
    const operation = { cid, session, epoch: this.epoch, explicit: requestPermission, fresh };
    this.pending = operation;
    operation.result = this.resolve(operation).finally(() => {
      if (this.pending === operation) this.pending = null;
    });
    return operation.result;
  }

  async clearRegion(operation, granted, notice) {
    const { cid, session } = operation;
    operation.clearing = true;
    this.cached = null;
    try { await this.client.read(locationPath(cid), {}, {}, 'DELETE'); }
    catch (_) { return this.valid(operation) ? { notice: notice || fallback, blocked: true } : {}; }
    if (!this.valid(operation)) return {};
    if (!operation.explicit) this.denied = { cid, session, granted, at: Date.now() };
    return { changed: true, notice };
  }

  async resolve(operation) {
    const { cid, session } = operation;
    let granted;
    try {
      const setting = await new Promise((resolve, reject) => wx.getSetting({ success: resolve, fail: reject }));
      if (!this.valid(operation)) return {};
      granted = setting.authSetting?.['scope.userLocation'];
      const denial = this.denied;
      if (!operation.explicit && denial?.cid === cid && denial.session === session && denial.granted === granted && Date.now() - denial.at < REUSE_MS) {
        operation.skipped = true;
        return {};
      }
      if (granted === false || granted !== true && !operation.explicit) {
        if (operation.fresh && !operation.explicit) {
          operation.skipped = true;
          return {};
        }
        return this.clearRegion(operation, granted, operation.explicit ? deniedNotice : '');
      }
      if (granted === true && !operation.fresh) {
        if (this.cached?.cid === cid && this.cached.session === session && Date.now() - this.cached.at < REUSE_MS) return { region: this.cached.region };
        const saved = await this.client.read(locationPath(cid));
        if (!this.valid(operation)) return {};
        const age = Date.now() - Date.parse(saved.region?.resolvedAt);
        if (saved.region?.source === 'wechat_location' && age >= 0 && age < REUSE_MS) {
          this.cached = { cid, session, region: saved.region, at: Date.now() - age };
          this.denied = null;
          return { region: saved.region };
        }
      }
      if (typeof wx.getLocation !== 'function') return this.clearRegion(operation, granted, fallback);
      const point = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject({ errMsg: 'getLocation:fail timeout' }), 12000);
        wx.getLocation({ type: 'gcj02', success: result => { clearTimeout(timer); resolve(result); }, fail: error => { clearTimeout(timer); reject(error); } });
      });
      if (!this.valid(operation)) return {};
      if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) throw Error('invalid_location');
      const data = await this.client.read(locationPath(cid), { latitude: point.latitude, longitude: point.longitude, coordinateSystem: 'gcj02' }, {}, 'POST');
      if (!this.valid(operation)) return {};
      if (data.deferred) return { deferred: true, region: data.region };
      if (!data.region?.cityCode || !data.region?.cityName || data.region.source !== 'wechat_location') throw Error('invalid_location');
      this.cached = { cid, session, region: data.region, at: Date.now() };
      this.denied = null;
      return { changed: true, region: data.region };
    } catch (error) {
      if (!this.valid(operation)) return {};
      if ((error?.code || error?.error) === 'context_changed') return { notice: fallback, blocked: true };
      return this.clearRegion(operation, granted, fallback);
    }
  }
}
module.exports = { NearbyLocationController, locationPath };
