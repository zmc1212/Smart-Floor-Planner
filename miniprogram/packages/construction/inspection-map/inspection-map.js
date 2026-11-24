const api = require('../../../utils/api');
const { generateUUID } = require('../../../utils/util');
const { errorText } = require('../chat/site-client');
const { loadSiteFont } = require('../lib/site-font');
const { readInspectionFix, confirmInspectionPin } = require('../lib/inspection-location');
const { toNativeMapPoint, fromNativeMapPoint } = require('../lib/inspection-coordinates');
const { maxStops, shanghaiDay, inspectionJourneyKey, readInspectionJourney, saveInspectionJourney,
  makeInspectionJourney, reconcileInspectionJourney } = require('../lib/inspection-journey');

const endpoint = '/miniprogram/construction/inspection';
const taskPage = '/packages/construction/inspection/inspection';
const recordPage = '/packages/construction/inspection-record/inspection-record';
const markerIcon = '/images/leads-v4/map-pin.png';
const fallbackCenter = { latitude: 35.8617, longitude: 104.1954 };
const options = { suppressUnauthorized: true };
const pause = () => new Promise(resolve => setTimeout(resolve, 2000));
const errorCode = error => error?.error || error?.message;
const lostAccess = error => [401, 403, 404].includes(error?.statusCode) || errorCode(error) === 'Unauthorized';
const messages = {
  Unauthorized: '巡检会话已结束，请重新登录后打开。',
  construction_forbidden: '当前账号的工地权限已变化，请返回工作台。',
  inspection_pin_missing: '有工地缺少已确认点位，请补充位置。',
  inspection_map_quota: '今日驾车算路额度已用完，仍可查看工地待办。',
  inspection_map_unconfigured: '驾车算路服务暂不可用，仍可查看工地待办。',
  inspection_route_unavailable: '暂时无法取得预计车程，请重试。',
  inspection_route_changed: '工地位置或待办有变化，请重新规划。',
  version_conflict: '工地信息已更新，请核对位置后重试。',
};
const message = error => messages[errorCode(error)] || (errorCode(error)?.startsWith('inspection_location_')
  ? errorText(error) : '巡检路线暂不可用，请重试。');

function session() {
  const global = getApp().globalData || {};
  const context = global.bootstrap?.current?.context || global.userInfo || {};
  return { token: global.token || wx.getStorageSync('token'), key: inspectionJourneyKey(context) };
}

function marker(point, id, label, name) {
  return {
    ...toNativeMapPoint(point), id, iconPath: markerIcon, width: 22, height: 25,
    label: { content: label, color: '#fffdf0', bgColor: '#00513c', fontSize: 12, borderRadius: 6, padding: 4, anchorX: 8, anchorY: -24 },
    callout: { content: name, display: 'BYCLICK', color: '#073c30', bgColor: '#fffcf4', padding: 8, borderRadius: 6 },
  };
}

function mapViewport(markers, lines) {
  const points = [...markers, ...lines.flatMap(line => line.points)];
  if (!points.length) return { center: fallbackCenter, scale: 4, includePoints: [] };
  let { latitude: south, longitude: west } = points[0];
  let north = south, east = west;
  for (const { latitude, longitude } of points) {
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
  }
  const center = { latitude: (north + south) / 2, longitude: (east + west) / 2 };
  if (south === north && west === east) return { center, scale: 15, includePoints: [center] };

  const latMargin = Math.max((north - south) * 0.16, 0.001);
  const lngMargin = Math.max((east - west) * 0.16, 0.001);
  const includePoints = [
    { latitude: Math.max(-90, south - latMargin), longitude: Math.max(-180, west - lngMargin) },
    { latitude: Math.min(90, north + latMargin), longitude: Math.min(180, east + lngMargin) },
  ];
  // Set a conservative initial zoom for runtimes that apply scale before include-points.
  const latSpan = (north - south + 2 * latMargin) / Math.max(0.15, Math.cos(center.latitude * Math.PI / 180));
  const span = Math.max(latSpan, east - west + 2 * lngMargin);
  const scale = Math.max(3, Math.min(15, Math.floor(Math.log2(270 / span))));
  return { center, scale, includePoints };
}

function station(stop) {
  const count = stop.recordIds.length;
  return { projectId: stop.projectId, name: stop.name, count, nextTitle: stop.nextTitle,
    pinned: Boolean(stop.pin), canSetPin: stop.canSetPin,
    visitLabel: stop.requiredCount ? '必须到场' : '建议到场' };
}

Page({
  data: { ready: false, editing: true, error: '', status: '', busy: false, pinBusy: '',
    picking: false, mapFailed: false, navTop: 40, navRight: 96, ordered: [], stations: [] },

  onLoad() { this.onResize(); void loadSiteFont(); },
  onResize() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    let capsule;
    try { capsule = wx.getMenuButtonBoundingClientRect(); } catch (_) { /* Keep space for the host capsule. */ }
    this.setData({ navTop: Math.max(info.statusBarHeight || 24, (capsule?.top || 46) - (44 - (capsule?.height || 32)) / 2),
      navRight: info.windowWidth - (capsule?.left || info.windowWidth - 94) + 10 });
  },
  onShow() {
    this._visible = true;
    this._view = (this._view || 0) + 1;
    this.setData({ ready: false, error: '', busy: false, pinBusy: '', picking: false, mapFailed: false });
    void this.open();
    this._timer = setInterval(() => {
      if (this.data.ready && !this.data.busy && !this.data.pinBusy && !this.data.picking && !this._openingMap) void this.open();
    }, 30000);
  },
  onHide() {
    this._visible = false;
    clearInterval(this._timer);
  },
  onUnload() { this.onHide(); this._view = null; this._pending = null; },
  async onPullDownRefresh() { try { await this.open(); } finally { wx.stopPullDownRefresh(); } },
  back() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) }); },

  current(view, binding = this._binding) {
    const current = session();
    return Boolean(this._visible && this._view === view && binding?.key && current.key === binding.key && current.token === binding.token);
  },
  persist() {
    return saveInspectionJourney(this._binding?.key, {
      day: this._day, route: this._route, selected: this._route ? [] : this._selected,
    });
  },
  restore() {
    const saved = readInspectionJourney(this._binding.key);
    this._day = shanghaiDay();
    this._route = saved?.route || null;
    this._selected = saved?.selected || [];
    this._stops = [];
    this._pending = null;
    this._first = null;
    this._origin = null;
    this._originSite = null;
    this._originName = '';
    this._editing = !this._route?.active;
  },
  open() {
    const view = this._view;
    if (!this._visible) return Promise.resolve(false);
    if (this._loading?.view === view) return this._loading.promise;
    const promise = this.refresh(view).finally(() => {
      if (this._loading?.view === view) this._loading = null;
    });
    this._loading = { view, promise };
    return promise;
  },
  async refresh(view) {
    try { await getApp().globalData?.sessionHydrationPromise; }
    catch (_) {
      if (this._visible && this._view === view) this.setData({ ready: false, error: messages.Unauthorized });
      return false;
    }
    if (!this._visible || this._view !== view) return false;
    const binding = session(), previous = this._binding;
    this._binding = binding;
    if (previous?.key !== binding.key || this._day !== shanghaiDay()) this.restore();
    if (previous?.token !== binding.token) this._pending = null;
    if (!binding.token || !binding.key) {
      this.setData({ ready: false, error: messages.Unauthorized });
      return false;
    }
    try {
      const nextIds = this._route?.stops.map(stop => stop.projectId) || [];
      if (this._route?.originSite) nextIds.push(this._route.originSite.projectId);
      const query = nextIds.length ? '?projectIds=' + encodeURIComponent([...new Set(nextIds)].join(',')) : '';
      const { data } = await api.request(endpoint + '/route-stops' + query, 'GET', {}, options);
      if (!this.current(view, binding)) return false;
      const oldRoute = this._route;
      const oldSelected = this._selected;
      if (data.today !== this._day) {
        this._day = data.today;
        this._route = null;
        this._pending = null;
        this._selected = [];
        this._editing = true;
      }
      this._stops = data.stops;
      this._route = this._route && reconcileInspectionJourney(this._route, this._stops);
      if (!this._route) this._editing = true;
      const eligible = new Set(this._stops.filter(stop => stop.pin && stop.recordIds.length).map(stop => stop.projectId));
      this._selected = this._selected.filter(id => eligible.has(id));
      if (!this._selected.includes(this._first)) this._first = null;
      if (this._originSite && !this._stops.some(stop => stop.projectId === this._originSite.projectId && stop.pin?.revision === this._originSite.pinRevision)) {
        this._origin = null;
        this._originSite = null;
        this._originName = '';
        this._pending = null;
      }
      if (oldRoute !== this._route || oldSelected.length !== this._selected.length) this.persist();
      this.render({ ready: true, error: '', ...(oldRoute && !this._route ? { status: '原路线已结束或工地权限有变，请重新选站。' } : {}) });
      return true;
    } catch (error) {
      if (!this.current(view, binding)) return false;
      if (lostAccess(error)) {
        this._route = null;
        this._stops = [];
        this._selected = [];
        this._pending = null;
        this._origin = null;
        this._originSite = null;
        this._originName = '';
        this._editing = true;
        this.persist();
        this.render({ ready: false, error: message(error), status: '' });
      } else {
        this.setData({ ready: false, error: message(error) });
      }
      return false;
    }
  },

  render(extra = {}) {
    const stops = this._stops || [];
    const route = this._route;
    const editing = this._editing;
    const byId = new Map(stops.map(stop => [stop.projectId, stop]));
    const ordered = (route?.stops || []).flatMap((stop, index) => {
      const live = byId.get(stop.projectId);
      if (!live) return [];
      return [{ ...station(live), index: index + 1, minutes: stop.minutes,
        done: !live.recordIds.length, deferred: route.deferred.includes(stop.projectId) }];
    });
    const next = ordered.find(stop => !stop.done && !stop.deferred && stop.pinned) || null;
    const pinned = stops.filter(stop => stop.pin);
    const markers = editing ? pinned.map((stop, i) => marker(stop.pin, i + 1, '', stop.name))
      : ordered.filter(stop => stop.pinned).map(stop => marker(byId.get(stop.projectId).pin, stop.index, String(stop.index), stop.name));
    const origin = editing ? this._origin : route?.origin;
    if (origin) markers.unshift(marker(origin, 0, '起点', '巡检起点'));
    const showDriveTime = Boolean(route && !route.stale && !ordered.some(stop => stop.deferred && !stop.done));
    const polyline = editing || !showDriveTime ? [] : route.stops.filter(stop => stop.points.length > 1)
      .map(stop => ({ points: stop.points.map(toNativeMapPoint), color: '#00513ce6', width: 5 }));
    const estimate = ordered.reduce((sum, stop) => sum + stop.minutes, 0);
    const navigated = next && route?.openedId === next.projectId;
    this.setData({
      ...mapViewport(markers, polyline), markers, polyline,
      editing, hasRoute: Boolean(route), stale: Boolean(route?.stale), routeActive: Boolean(route?.active), showDriveTime,
      next, navigated, ordered, estimate, otherStops: ordered.filter(stop => stop !== next),
      selectedCount: this._selected.length,
      stations: stops.filter(stop => stop.recordIds.length).map(stop => ({ ...station(stop),
        selected: this._selected.includes(stop.projectId), first: this._first === stop.projectId })),
      originName: this._originName || '从当前位置出发',
      originChoices: pinned.map(stop => stop.name),
      canPlan: this._selected.length > 0,
      ...extra,
    });
  },

  mapError() { this.setData({ mapFailed: true, picking: false }); },
  pickOrigin() {
    if (this.data.ready && this.data.editing && !this.data.busy && !this.data.mapFailed) this.setData({ picking: !this.data.picking });
  },
  mapTap({ detail }) {
    if (this.data.picking && !this.data.busy && Number.isFinite(detail?.latitude) && Number.isFinite(detail?.longitude)) {
      this.setOrigin(fromNativeMapPoint(detail), '从地图所选位置出发');
    }
  },
  siteOrigin({ detail }) {
    if (!this.data.ready || !this.data.editing || this.data.busy) return;
    const stop = this._stops.filter(item => item.pin)[Number(detail.value)];
    if (stop) this.setOrigin(stop.pin, stop.name + '出发', { projectId: stop.projectId, pinRevision: stop.pin.revision });
  },
  currentOrigin() { if (!this.data.busy) this.setOrigin(null, ''); },
  setOrigin(point, name, site = null) {
    this._origin = point;
    this._originName = name;
    this._originSite = site;
    this._pending = null;
    this.render({ picking: false, status: '' });
  },
  toggleStop({ currentTarget }) {
    if (!this.data.ready || !this.data.editing || this.data.busy || this.data.pinBusy) return;
    const { id } = currentTarget.dataset;
    if (!this._stops.some(stop => stop.projectId === id && stop.pin && stop.recordIds.length)) return;
    if (this._selected.includes(id)) {
      this._selected = this._selected.filter(projectId => projectId !== id);
      if (this._first === id) this._first = null;
    } else {
      if (this._selected.length === maxStops) { this.setData({ status: '每次最多选择 8 个工地。' }); return; }
      this._selected.push(id);
    }
    this._pending = null;
    if (!this._route) this.persist();
    this.render({ status: '' });
  },
  preferStop({ currentTarget }) {
    const { id } = currentTarget.dataset;
    if (!this.data.ready || !this.data.editing || this.data.busy || !this._selected.includes(id)) return;
    this._first = this._first === id ? null : id;
    this._pending = null;
    this.render({ status: '' });
  },
  async setPin({ currentTarget }) {
    if (!this.data.ready || !this.data.editing || this.data.busy || this.data.pinBusy) return;
    const stop = this._stops.find(item => item.projectId === currentTarget.dataset.id);
    if (!stop?.canSetPin) return;
    const view = this._view, current = () => this.current(view);
    this.setData({ pinBusy: stop.projectId, status: '' });
    try {
      if (await confirmInspectionPin(stop, current) && current()) {
        this._pending = null;
        await this.open();
        if (current() && this.data.ready) this.setData({ status: '工地入口已保存。' });
      }
    } catch (error) {
      if (!current()) return;
      if (lostAccess(error) || error.statusCode === 409) await this.open();
      if (current()) this.setData({ status: message(error) });
    } finally {
      if (current()) this.setData({ pinBusy: '' });
    }
  },
  openTasks({ currentTarget }) {
    const { id } = currentTarget.dataset;
    if (!this.data.ready || !this.current(this._view) || !this._stops.some(stop => stop.projectId === id && stop.recordIds.length)) return;
    wx.navigateTo({ url: taskPage + '?projectId=' + encodeURIComponent(id) + '&onsite=1' });
  },
  verifyNext() {
    const next = this.data.next;
    if (!next || this.data.editing || !this.data.ready || !this.current(this._view)) return;
    const stop = this._stops.find(item => item.projectId === next.projectId);
    if (stop?.recordIds.length === 1) {
      wx.navigateTo({ url: recordPage + '?projectId=' + encodeURIComponent(stop.projectId) + '&recordId=' + encodeURIComponent(stop.recordIds[0]) });
    } else {
      this.openTasks({ currentTarget: { dataset: { id: next.projectId } } });
    }
  },
  async navigateNext() {
    const selected = this.data.next?.projectId, view = this._view, binding = this._binding;
    if (!selected || !this.data.ready || this.data.editing || this._openingMap || !this.current(view, binding)) return;
    this._openingMap = true;
    try {
      if (!await this.open() || !this.current(view, binding)) return;
      if (this.data.next?.projectId !== selected) {
        this.setData({ status: '站点待办有更新，请核对下一站。' });
        return;
      }
      const stop = this._stops.find(item => item.projectId === selected);
      if (!stop?.pin) return;
      const routeId = this._route.id;
      const opened = await new Promise(resolve => wx.openLocation({
        ...toNativeMapPoint(stop.pin), name: stop.name, address: stop.pin.name || '', scale: 18,
        success: () => resolve(true), fail: () => resolve(false),
      }));
      const actor = session();
      if (actor.key !== binding.key || actor.token !== binding.token || this._route?.id !== routeId) return;
      if (opened) {
        this._route = { ...this._route, openedId: selected };
        this.persist();
        if (this._visible && this.data.ready) this.render({ status: '' });
      } else if (this.current(view, binding)) {
        this.setData({ status: '暂时无法打开微信地图，可重试或查看本站待办。' });
      }
    } catch (_) {
      if (this.current(view, binding)) this.setData({ status: '暂时无法打开微信地图，可重试或查看本站待办。' });
    } finally { this._openingMap = false; }
  },
  adjust() {
    if (!this.data.ready || !this._route || !this.current(this._view)) return;
    if (!this.data.next) { this.editRoute(); return; }
    const view = this._view, nextId = this.data.next.projectId;
    wx.showActionSheet({ itemList: ['调整选站', '暂缓当前站'], success: ({ tapIndex }) => {
      if (!this.current(view) || !this.data.ready || this._editing) return;
      if (tapIndex === 0) this.editRoute();
      if (tapIndex === 1 && this.data.next?.projectId === nextId) this.defer(nextId, true);
    } });
  },
  editRoute() {
    this._editing = true;
    this._selected = this.data.ordered.filter(stop => stop.pinned && !stop.done && !stop.deferred).map(stop => stop.projectId);
    this._first = null;
    this.setOrigin(null, '');
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  cancelEdit() {
    if (this.data.busy || this.data.pinBusy || !this._route) return;
    this._editing = false;
    this._pending = null;
    this.render({ status: '', picking: false });
  },
  restoreStop({ currentTarget }) { this.defer(currentTarget.dataset.id, false); },
  defer(id, deferred) {
    if (!this.data.ready || !this.current(this._view) || !this._route?.stops.some(stop => stop.projectId === id)) return;
    const ids = this._route.deferred.filter(projectId => projectId !== id);
    if (deferred) ids.push(id);
    this._route = { ...this._route, deferred: ids };
    this.render({ status: this.persist() ? '' : '路线状态暂未保存到本机。' });
  },

  async plan() {
    if (!this.data.ready || !this.data.editing || this.data.busy || this.data.pinBusy || !this.data.canPlan) return;
    const view = this._view, binding = this._binding;
    const current = () => this.current(view, binding);
    this.setData({ busy: true, picking: false, status: '正在规划驾车路线…' });
    try {
      let job = this._pending;
      if (!job || Date.now() - job.created > 14 * 60000) {
        const origin = this._origin || (await readInspectionFix()).point;
        if (!current()) return;
        job = { requestId: generateUUID().replace(/-/g, ''), created: Date.now(), originSite: this._originSite,
          input: { origin: { latitude: origin.latitude, longitude: origin.longitude, coordinateSystem: 'wgs84' },
            projectIds: [...this._selected], firstProjectId: this._first } };
        this._pending = job;
      }
      if (!job.ticket) {
        const result = await api.request(endpoint + '/map-entry', 'POST', { origin: null }, options);
        if (!/^[A-Za-z0-9_.-]{1,4096}$/.test(result.data?.ticket || '')) throw Error('inspection_route_unavailable');
        job.ticket = result.data.ticket;
      }
      const until = Date.now() + 150000;
      while (current() && this._pending === job && Date.now() < until) {
        try {
          const { data } = await api.request(endpoint + '/map', 'POST', job.input, {
            ...options, headers: { Authorization: 'Bearer ' + job.ticket, 'X-Inspection-Request-Id': job.requestId },
          });
          if (!current() || this._pending !== job) return;
          if (data) {
            this._route = makeInspectionJourney(data, job, job.originSite);
            this._editing = false;
            this._pending = null;
            const saved = this.persist();
            await this.open();
            if (current() && this.data.ready) {
              this.setData({ status: saved ? '' : '路线暂未保存到本机，请保持此页。' });
              wx.pageScrollTo({ scrollTop: 0, duration: 0 });
            }
            return;
          }
        } catch (error) {
          if (error.statusCode && ![502, 504].includes(error.statusCode)) throw error;
        }
        await pause();
      }
      if (current()) this.setData({ status: messages.inspection_route_unavailable });
    } catch (error) {
      if (!current()) return;
      this._pending = null;
      if (lostAccess(error) || errorCode(error) === 'inspection_route_changed') await this.open();
      if (current() && this.data.ready) this.setData({ status: message(error) });
    } finally {
      if (current()) this.setData({ busy: false });
    }
  },
});
