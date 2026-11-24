const { errorCopy } = require('./assistant-client');
const initialContext = () => ({ selectedFloorplan: null, contextVersion: 0, contextItems: [], contextLoading: false,
  contextBusy: false, contextPending: false, contextError: '', contextDetail: null, contextDetailPath: '',
  contextDetailImageState: '', contextBrowseOnly: false });
const validId = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value);
function validPlan(value) {
  return value && validId(value.leadId) && validId(value.floorPlanId || value.id)
    && typeof value.name === 'string' && typeof value.layoutHash === 'string' && /^[a-f0-9]{64}$/.test(value.layoutHash);
}
function validNumberOrNull(value) { return value === null || typeof value === 'number' && Number.isFinite(value); }
function validRoom(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.floorName === 'string'
    && validNumberOrNull(value.ceilingHeightMm)
    && Array.isArray(value.walls) && value.walls.every(wall => wall && typeof wall.id === 'string' && typeof wall.lengthMm === 'number' && wall.lengthMm > 0)
    && Array.isArray(value.openings) && value.openings.every(opening => opening && typeof opening.id === 'string'
      && ['door', 'window'].includes(opening.type)
      && validNumberOrNull(opening.widthMm) && validNumberOrNull(opening.heightMm) && validNumberOrNull(opening.sillHeightMm))
    && Number.isSafeInteger(value.wallCount) && Number.isSafeInteger(value.readableWallCount)
    && Number.isSafeInteger(value.openingCount) && Number.isSafeInteger(value.omittedWalls) && Number.isSafeInteger(value.omittedOpenings);
}
function validDetail(value) {
  return validPlan(value) && typeof value.text === 'string'
    && Array.isArray(value.rooms) && value.rooms.every(validRoom)
    && Number.isSafeInteger(value.totalRooms) && Number.isSafeInteger(value.omittedRooms)
    && (value.previewEndpoint === undefined || typeof value.previewEndpoint === 'string' && value.previewEndpoint.startsWith('/miniprogram/customer-projects/'));
}
function decorateRoom(room, index) {
  const groups = new Map();
  for (const opening of room.openings) {
    const key = [opening.type, opening.widthMm, opening.heightMm, opening.sillHeightMm].join('|');
    const item = groups.get(key) || { ...opening, count: 0 };
    item.count += 1;
    groups.set(key, item);
  }
  const openingLines = [...groups.values()].map(opening => {
    const type = opening.type === 'window' ? '窗' : '门';
    const dimensions = [
      opening.widthMm ? `宽 ${opening.widthMm}` : '',
      opening.heightMm ? `高 ${opening.heightMm}` : '',
      opening.sillHeightMm ? `窗台高 ${opening.sillHeightMm}` : '',
    ].filter(Boolean);
    return `${type}${dimensions.length ? ' · ' + dimensions.join(' · ') : ' · 尺寸未记录'}${opening.count > 1 ? ` · ${opening.count} 处` : ''}`;
  });
  return {
    ...room,
    indexLabel: String(index + 1).padStart(2, '0'),
    ceilingLabel: room.ceilingHeightMm ? `层高 ${room.ceilingHeightMm}` : '',
    wallValues: room.walls.map(wall => wall.lengthMm),
    wallItems: room.walls.map((wall, wallIndex) => ({ key: `${room.id}-w${wallIndex}`, value: wall.lengthMm })),
    partialWalls: room.readableWallCount < room.wallCount,
    openingLines,
    openingItems: openingLines.map((label, lineIndex) => ({ key: `${room.id}-o${lineIndex}`, label })),
    openingEmpty: !room.openingCount,
    omittedOpenings: room.omittedOpenings > 0,
  };
}
function decorateDetail(value) {
  const rooms = (value.rooms || []).map(decorateRoom);
  const updated = value.updatedAt ? new Date(value.updatedAt) : null;
  return {
    ...value,
    rooms,
    roomCountLabel: `${value.totalRooms || rooms.length} 个空间`,
    updatedAtLabel: updated && !Number.isNaN(updated.getTime()) ? `更新于 ${updated.getMonth() + 1}月${updated.getDate()}日` : '',
    truncated: value.omittedRooms > 0 || rooms.some(room => room.omittedWalls > 0 || room.readableWallCount < room.wallCount || room.omittedOpenings > 0),
  };
}
class FloorplanContextController {
  constructor({ client, identity, emit }) { Object.assign(this, { client, identity, emit }); this.epoch = 0; }
  valid(epoch) { return epoch === this.epoch && this.session === this.identity(); }
  clear() { this.epoch++; this.id = ''; this.version = 0; this.selected = null; this.items = []; this.emit(initialContext()); }
  async show(id) {
    if (!id) { this.clear(); return true; }
    if (this.flight && this.id === id && this.session === this.identity()) return this.flight;
    const same = this.id === id && this.session === this.identity();
    const epoch = ++this.epoch; this.id = id; this.session = this.identity();
    if (!same) { this.version = 0; this.selected = null; this.items = []; this.emit(initialContext()); }
    this.emit({ contextLoading: true, contextPending: this.client.pending.has('floorplan-context:' + id), contextDetail: null, contextDetailPath: '', contextDetailImageState: '' });
    const flight = (async () => {
      try {
        const data = await this.client.read('/conversations/' + id + '/floorplan-context');
        if (!this.valid(epoch)) return false;
        this.apply(data);
        this.items = Array.isArray(data.items) ? data.items.filter(validPlan) : [];
        this.emit({ contextItems: this.items, contextError: data.invalidated ? '所选户型已更新或不可用，已切回不结合户型档案。' : '',
          contextPending: this.client.pending.has('floorplan-context:' + id) });
        return !this.client.pending.has('floorplan-context:' + id);
      } catch (error) {
        if (this.valid(epoch)) {
          this.selected = null; this.items = [];
          this.emit({ selectedFloorplan: null, contextItems: [], contextError: errorCopy(error) });
        }
        return false;
      } finally { if (this.valid(epoch)) this.emit({ contextLoading: false }); }
    })();
    this.flight = flight;
    try { return await flight; } finally { if (this.flight === flight) this.flight = null; }
  }
  apply(data) {
    if (!Number.isSafeInteger(data.version) || data.version < 0 || data.selected !== null && !validPlan(data.selected)) throw { code: 'invalid_response' };
    this.version = data.version; this.selected = data.selected;
    this.emit({ selectedFloorplan: data.selected, contextVersion: data.version });
  }
  async select(plan) {
    if (!this.id || this.busy) return false;
    const epoch = this.epoch, slot = 'floorplan-context:' + this.id;
    if (plan && !this.items.some(p => p.id === (plan.id || plan.floorPlanId) && p.leadId === plan.leadId && p.layoutHash === plan.layoutHash)) return false;
    this.busy = true; this.emit({ contextBusy: true, contextError: '' });
    try {
      const data = await this.client.mutate(slot, '/conversations/' + this.id + '/floorplan-context', {
        expectedVersion: this.version,
        selection: plan ? { leadId: plan.leadId, floorPlanId: plan.floorPlanId || plan.id, layoutHash: plan.layoutHash } : null,
      });
      if (!this.valid(epoch)) return false;
      this.apply(data); this.emit({ contextPending: false }); return true;
    } catch (error) {
      if (this.valid(epoch)) this.emit({ contextPending: this.client.pending.has(slot), contextError: this.client.pending.has(slot)
        ? '档案选择结果待核对，请先核对同一次操作再发送。' : errorCopy(error) });
      return false;
    } finally { this.busy = false; if (this.valid(epoch)) this.emit({ contextBusy: false }); }
  }
  retry() { return this.client.pending.has('floorplan-context:' + this.id) ? this.select() : this.show(this.id); }
  async detail(plan) {
    if (!validPlan(plan) || !this.id) return false;
    const epoch = this.epoch;
    this.emit({ contextLoading: true, contextDetail: null, contextDetailPath: '', contextDetailImageState: '', contextError: '' });
    try {
      const data = await this.client.read('/conversations/' + this.id + '/floorplan-context', {
        leadId: plan.leadId, floorPlanId: plan.floorPlanId || plan.id, layoutHash: plan.layoutHash,
      });
      if (!this.valid(epoch)) return false;
      if (!validDetail(data)) throw { code: 'invalid_response' };
      this.emit({ contextDetail: decorateDetail(data) }); return true;
    } catch (error) {
      if (this.valid(epoch)) this.emit({ contextDetail: null, contextError: errorCopy(error) });
      return false;
    } finally { if (this.valid(epoch)) this.emit({ contextLoading: false }); }
  }
}
module.exports = { FloorplanContextController, initialContext };
