const api = require('../../../utils/api');
const nativePreview = require('../../../utils/native-preview');
const { clamp, topCornerAngle, drawPageCurl } = require('./report-page-curl');

const initialBook = () => ({ reportBookPage: 0, reportBookMoving: false, reportBookClip: '',
  reportBookImage: '', reportBookImageState: '', reportBookSharing: false });

function unlink(filePath) {
  if (!filePath) return;
  try { wx.getFileSystemManager().unlink({ filePath, fail() {} }); } catch { /* Native temp file already expired. */ }
}

function clearCanvas(surface) {
  if (surface) surface.context.clearRect(0, 0, surface.width, surface.height);
}

const reportBookMethods = {
  clearReportBook(resetPage = false) {
    this._bookGesture = this._bookTurn = this._bookImageLoad = this._bookShare = null;
    this._bookFrame?.();
    this._bookFrame = null;
    clearCanvas(this._bookSurface);
    if (resetPage) this._bookSurface = null;
    unlink(this.data.reportBookImage);
    return { ...initialBook(), reportBookPage: resetPage ? 0 : this.data.reportBookPage };
  },
  async loadReportBookImage(recheck = false) {
    const followups = this.followups, context = followups.state.followupContext, scope = this._boardScope;
    const report = this.data.reportBoardView?.detail;
    if (!context || !scope || !report?.ready || !followups.current()) return '';
    if (!recheck && this.data.reportBookImage) return this.data.reportBookImage;
    if (this._bookImageLoad) return this._bookImageLoad;
    const ticket = this._boardTicket, epoch = followups.epoch;
    const current = () => this._alive && this._shown && scope === this._boardScope
      && ticket === this._boardTicket && followups.current(epoch);
    const url = '/miniprogram/assistant/followups/' + context.bindingId + '/reports/' + report.reportId +
      '/image?revision=' + report.revision + (scope.projectId ? '&projectId=' + encodeURIComponent(scope.projectId) : '')
      + (report.readingKey ? '&readingKey=' + encodeURIComponent(report.readingKey) : '');
    if (!this.data.reportBookImage) this.setData({ reportBookImageState: 'loading' });
    const load = (async () => {
      try {
        const headers = await followups.headers();
        if (!current()) return '';
        const result = await api.downloadFile(url, { headers, suppressUnauthorized: true, timeout: 15000 });
        if (!current()) { unlink(result.tempFilePath); return ''; }
        if (this.data.reportBookImage !== result.tempFilePath) unlink(this.data.reportBookImage);
        this.setData({ reportBookImageState: 'ready', reportBookImage: result.tempFilePath });
        return result.tempFilePath;
      } catch (error) {
        if (current()) {
          const denied = [401, 403, 404].includes(error?.statusCode);
          const stale = error?.statusCode === 409;
          if (denied || stale) unlink(this.data.reportBookImage);
          this.setData(denied || stale ? { reportBookImageState: stale ? 'stale' : 'unavailable', reportBookImage: '' }
            : this.data.reportBookImage ? { reportBookImageState: 'ready' } : { reportBookImageState: 'error' });
        }
        return '';
      }
    })();
    this._bookImageLoad = load;
    try { return await load; }
    finally { if (this._bookImageLoad === load) this._bookImageLoad = null; }
  },
  retryReportBookImage() {
    return this.data.reportBookImageState === 'stale' ? this.refreshReportBoard() : this.loadReportBookImage();
  },
  reportBookImageFailed(e) {
    if (e.currentTarget.dataset.path !== this.data.reportBookImage) return;
    unlink(this.data.reportBookImage);
    this.setData({ reportBookImage: '', reportBookImageState: 'error' });
  },
  async previewReportBookImage() {
    if (this._bookShare || this.data.reportBookMoving || !this.data.reportBookImage || Date.now() < (this._bookSuppressTapUntil || 0)) return;
    const path = await this.loadReportBookImage(true);
    if (path && this.data.reportBookPage === 1 && path === this.data.reportBookImage)
      nativePreview.previewImage({ urls: [path], current: path });
    else if (!path && this.data.reportBookImage) wx.showToast({ title: '原图暂时无法打开', icon: 'none' });
  },
  async shareReportBookImage() {
    if (this._bookShare || this._bookImageLoad || this.data.reportBookPage !== 1 || this.data.reportBookMoving
      || !this.data.reportBookImage || Date.now() < (this._bookSuppressTapUntil || 0)) return;
    if (typeof wx.showShareImageMenu !== 'function') {
      wx.showToast({ title: '请打开原图保存后发朋友圈', icon: 'none' });
      return;
    }
    const share = this._bookShare = {};
    const current = () => this._bookShare === share && this._alive && this._shown
      && this.data.reportBookPage === 1 && !this.data.reportBookMoving;
    this.setData({ reportBookSharing: true });
    try {
      const path = await this.loadReportBookImage(true);
      if (!current()) return;
      if (!path || path !== this.data.reportBookImage) {
        if (this.data.reportBookImage) wx.showToast({ title: '海报暂时无法读取，请重试', icon: 'none' });
        return;
      }
      await new Promise((resolve, reject) => nativePreview.shareImage({ path, needShowEntrance: false,
        success: resolve, fail: reject }, this));
    } catch (error) {
      if (current() && !/cancel/i.test(error?.errMsg || ''))
        wx.showToast({ title: '分享未打开，可保存原图后再发', icon: 'none' });
    } finally {
      if (this._bookShare === share) {
        this._bookShare = null;
        if (this._alive && this._shown) this.setData({ reportBookSharing: false });
      }
    }
  },
  measureReportBook() {
    if (this._bookMeasuring || !this.data.reportBoard || typeof wx === 'undefined') return;
    const current = this._bookSurface;
    if (current && current.height === this.data.viewportHeight && current.width === this._windowInfo?.windowWidth) return;
    this._bookMeasuring = true;
    const query = this.createSelectorQuery ? this.createSelectorQuery() : wx.createSelectorQuery();
    query.select('#report-book-curl').fields({ node: true, size: true });
    query.exec(([area] = []) => {
      this._bookMeasuring = false;
      if (!this._alive || !this._shown || !area?.node || !area.width || !area.height) return;
      if (this._bookSurface?.node === area.node && this._bookSurface.width === area.width && this._bookSurface.height === area.height) return;
      const node = area.node;
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const density = Math.min(2, info.pixelRatio || 1);
      node.width = Math.round(area.width * density);
      node.height = Math.round(area.height * density);
      const context = node.getContext('2d');
      if (!context) return;
      context.scale(node.width / area.width, node.height / area.height);
      this._bookSurface = { node, context, width: area.width, height: area.height, density };
    });
  },
  queueReportBookFrame(callback) {
    if (this._bookFrame) return;
    const node = this._bookSurface?.node;
    const paint = () => {
      this._bookFrame = null;
      if (this._alive && this._shown) callback();
    };
    if (node?.requestAnimationFrame) {
      const id = node.requestAnimationFrame(paint);
      this._bookFrame = () => node.cancelAnimationFrame(id);
    } else {
      const id = setTimeout(paint, 16);
      this._bookFrame = () => clearTimeout(id);
    }
  },
  paintReportBook(amount, angle) {
    if (!this._bookSurface) return;
    const clip = drawPageCurl(this._bookSurface, clamp(amount, .001, .999), angle, this.data);
    this.setData({ reportBookMoving: true, reportBookClip: clip });
  },
  turnReportBook(target, from = this.data.reportBookPage, angle = topCornerAngle(this.data.reportBookPage), speed = 0) {
    if (this._bookTurn || target === 1 && !this.data.reportBoardView?.detail?.ready) return;
    this._bookFrame?.();
    this._bookFrame = null;
    const distance = Math.abs(target - from), changed = target !== this.data.reportBookPage;
    const settle = () => {
      this._bookTurn = null;
      clearCanvas(this._bookSurface);
      this.setData({ reportBookPage: target, reportBookMoving: false, reportBookClip: '' });
      if (target === 1 && !this.data.reportBookImage && !this.data.reportBookImageState) void this.loadReportBookImage();
    };
    if (!this._bookSurface || distance < .002) { settle(); return; }
    const turn = { start: Date.now(), duration: changed ? clamp(235 + distance * 208 - speed * 52, 215, 443)
      : clamp(155 + distance * 225, 155, 288), dragged: from !== this.data.reportBookPage };
    this._bookTurn = turn;
    const step = () => {
      if (this._bookTurn !== turn) return;
      const t = clamp((Date.now() - turn.start) / turn.duration, 0, 1);
      if (t >= 1) { settle(); return; }
      const eased = turn.dragged ? 1 - (1 - t) ** 2.7 : t * t * (3 - 2 * t);
      this.paintReportBook(from + (target - from) * eased, angle);
      this.queueReportBookFrame(step);
    };
    this.queueReportBookFrame(step);
  },
  tapReportBook(e) {
    if (Date.now() < (this._bookSuppressTapUntil || 0)) return;
    const target = Number(e.currentTarget.dataset.page);
    if ((target === 0 || target === 1) && target !== this.data.reportBookPage) this.turnReportBook(target);
  },
  startReportBookTouch(e) {
    if ((!this.data.reportBookPage && !this.data.reportBoardView?.detail?.ready) || this._bookTurn || e.touches.length !== 1) return;
    const { clientX: x, clientY: y } = e.touches[0];
    this._bookGesture = { x, y, sampleX: x, sampleTime: Date.now(), velocity: 0, amount: this.data.reportBookPage };
    this.measureReportBook();
  },
  moveReportBookTouch(e) {
    const gesture = this._bookGesture;
    if (!gesture) return;
    if (e.touches.length !== 1) return this.endReportBookTouch(e, true);
    const { clientX: x, clientY: y } = e.touches[0];
    const dx = x - gesture.x, dy = y - gesture.y, page = this.data.reportBookPage;
    if (!gesture.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { this._bookGesture = null; return; }
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2 || (page ? dx < 0 : dx > 0)) return;
      gesture.active = true;
    }
    const width = this._bookSurface?.width || this._windowInfo?.windowWidth || 390;
    const height = this._bookSurface?.height || this.data.viewportHeight;
    const now = Date.now(), velocity = (x - gesture.sampleX) / Math.max(8, now - gesture.sampleTime);
    gesture.velocity = clamp(.48 * gesture.velocity + .52 * velocity, -2.2, 2.2);
    gesture.sampleX = x;
    gesture.sampleTime = now;
    gesture.width = width;
    gesture.amount = clamp(page - dx / (width * .88), 0, 1);
    gesture.angle = topCornerAngle(page, dy / height);
    this.queueReportBookFrame(() => {
      if (this._bookGesture === gesture) this.paintReportBook(gesture.amount, gesture.angle);
    });
  },
  endReportBookTouch(e, cancelled = false) {
    const gesture = this._bookGesture;
    this._bookGesture = null;
    if (!gesture?.active) return;
    const now = Date.now(), page = this.data.reportBookPage, direction = page ? 1 : -1;
    this._bookSuppressTapUntil = now + 255;
    const x = e.changedTouches?.[0]?.clientX ?? gesture.sampleX;
    const travel = (x - gesture.x) * direction;
    const speed = now - gesture.sampleTime < 95 ? gesture.velocity * direction : 0;
    const change = !cancelled && (travel >= gesture.width * .23 || (travel >= 34 && speed > .52));
    this.turnReportBook(change ? 1 - page : page, gesture.amount, gesture.angle, Math.max(0, speed));
  },
  cancelReportBookTouch(e) { this.endReportBookTouch(e, true); },
};

module.exports = { initialBook, reportBookMethods };
