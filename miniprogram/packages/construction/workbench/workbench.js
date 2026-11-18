const api = require('../../../utils/api');
const { openAIDesignTab } = require('../../../utils/aiDesignNavigation');
const { canAccessRoute } = require('../../../utils/identity-navigation');
const { loadSiteFont } = require('../lib/site-font');
const { siteMessageTime, errorText } = require('../chat/site-client');

const base = '/miniprogram/construction/workbench';
const projects = '/packages/construction/projects/projects';
const chat = '/packages/construction/chat/chat';
const reportPage = '/packages/construction/report/report';
const reports = '/packages/assistant/chat/chat?followup=1';
const options = { suppressUnauthorized: true };
const titles = { worker: '施工工作台', manager: '项目经理工作台', designer: '设计师工作台', boss: '老板工作台' };
const statusLabels = { organizing: '待整理', draft: '等经理核对', published: '已发布', changes_requested: '待补拍', withdrawn: '已撤回' };

function session() {
  const app = getApp(), global = app.globalData;
  const context = global.bootstrap?.current?.context || global.userInfo || {};
  return { token: global.token || wx.getStorageSync('token'),
    key: [context.enterpriseId, context.staffId || context.adminId].filter(Boolean).join(':'),
    identity: global.bootstrap || global.userInfo };
}

function viewForRole(role) {
  return role === 'enterprise_admin' ? 'boss' : role === 'designer' ? 'designer' : 'worker';
}

function dashboard(data) {
  const items = data.items || [];
  const late = items.filter(item => item.late);
  const exceptions = [
    ...late.map(item => ({ ...item.late, id: item.projectId, name: item.name, kind: 'late', key: 'late-' + item.projectId })),
    ...items.flatMap(item => (item.coordination || []).map(issue => ({
      ...issue, id: item.projectId, name: item.name, kind: 'coordination', key: 'issue-' + issue.issueId,
    }))),
  ];
  const day = new Date(Date.parse(data.asOf) + 8 * 3600000);
  return { ...data, date: Number.isNaN(+day) ? '' : (day.getUTCMonth() + 1) + '月' + day.getUTCDate() + '日',
    totals: [items.filter(item => item.status === 'active').length, late.length,
      items.reduce((count, item) => count + (item.coordinationCount || 0), 0)], exceptions: exceptions.slice(0, 4),
    unverified: items.some(item => item.status === 'active' && item.progress?.overall?.color === 'gray') };
}

function decorateReport(item) {
  const stageText = (item.stages || []).map(stage => stage.name).filter(Boolean).join('、');
  return { ...item,
    time: siteMessageTime(item.at).replace(/^今天 /, ''),
    stageText,
    meta: [siteMessageTime(item.at).replace(/^今天 /, ''), stageText,
      item.photoCount ? item.photoCount + '张照片' : '', item.hasVoice ? '1段语音' : ''].filter(Boolean).join(' · '),
    statusClass: item.status === 'approved' ? 'done' : item.status === 'returned' ? 'returned' : item.status === 'withdrawn' ? 'withdrawn' : 'pending',
    returnShort: item.returnReason ? item.returnReason.slice(0, 40) : '',
  };
}

function decorate(data) {
  const record = item => item ? { ...item, time: siteMessageTime(item.at).replace(/^今天 /, ''), label: statusLabels[item.status] || '' } : null;
  const decorated = data.view === 'boss' ? dashboard(data)
    : { ...data, draft: record(data.draft), receipt: record(data.receipt) };
  if (data.reports) decorated.reports = { ...data.reports, items: (data.reports.items || []).map(decorateReport) };
  if (data.pendingReport) decorated.pendingReport = { ...data.pendingReport,
    time: siteMessageTime(data.pendingReport.at).replace(/^今天 /, '') };
  return decorated;
}

function pad(value) { return String(value).padStart(2, '0'); }
function dateKey(date) { return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()); }
function parseDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}
function addDays(value, count) {
  const date = parseDay(value) || new Date();
  return dateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + count));
}
function monthLabel(value) {
  const date = parseDay(value) || new Date();
  return date.getFullYear() + '年' + (date.getMonth() + 1) + '月';
}
function shortDate(value) {
  const date = parseDay(value);
  return date ? (date.getMonth() + 1) + '月' + date.getDate() + '日' : '';
}
function rangeForKey(key) {
  const today = dateKey(new Date());
  if (key === 'yesterday') {
    const day = addDays(today, -1);
    return { key, from: day, to: day, label: '昨天 · ' + shortDate(day) };
  }
  if (key === 'week') {
    const from = addDays(today, -6);
    return { key, from, to: today, label: '近7天 · ' + shortDate(from) + '–' + shortDate(today) };
  }
  return { key: 'today', from: today, to: today, label: '今天 · ' + shortDate(today) };
}
function customRange(from, to) {
  const same = from === to;
  return { key: 'custom', from, to, label: same ? shortDate(from) : shortDate(from) + '–' + shortDate(to) };
}

function discardPhoto(path) {
  if (path) wx.getFileSystemManager?.().unlink({ filePath: path, fail() {} });
}

Component({
  properties: { role: { type: String, observer() { if (this._visible) this.load(); } } },
  data: { model: null, photo: '', loading: true, error: '', notice: '', selectedIndex: 0, navTop: 46, navHeight: 32, navRight: 96,
    reports: [], todaySummary: { total: 0, pending: 0, approved: 0, returned: 0 }, reportRange: rangeForKey('today'),
    reportLoading: false, reportError: '',
    showCalendar: false, calendar: { month: '', monthLabel: '', weeks: [], from: '', to: '', rangeLabel: '请选择起止日期' },
    showDetail: false, detailLoading: false, detailError: '', detail: null, detailPhotos: [], detailPlaying: false },
  lifetimes: {
    attached() { this.measure(); void loadSiteFont(); this.show(); },
    detached() { this.hide(); },
  },
  pageLifetimes: {
    show() { this.show(); },
    hide() { this.hide(); },
    resize() { this.measure(); },
  },
  methods: {
    measure() {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      let capsule;
      try { capsule = wx.getMenuButtonBoundingClientRect(); } catch { /* The fallback still reserves the capsule lane. */ }
      this.setData({ navTop: Math.max(info.statusBarHeight || 24, capsule?.top || 46),
        navHeight: capsule?.height || 32, navRight: info.windowWidth - (capsule?.left || info.windowWidth - 94) + 10 });
    },
    show() {
      if (!this._visible) {
        this._visible = true;
        const range = this._reloadTodayOnShow ? rangeForKey('today') : (this.data.reportRange || rangeForKey('today'));
        this._reloadTodayOnShow = false;
        return this.load(null, range);
      }
    },
    hide() {
      this._visible = false;
      this._generation = (this._generation || 0) + 1;
      discardPhoto(this.data.photo);
      this.closeDetail(true);
      this.setData({ model: null, photo: '', loading: true, error: '', notice: '', showCalendar: false });
    },
    current(generation, binding) {
      const current = session();
      return this._visible && this._generation === generation && current.token === binding.token && current.key === binding.key;
    },
    async load(projectId, range, config = {}) {
      const silent = config.silent === true;
      const generation = this._generation = (this._generation || 0) + 1;
      if (!silent) discardPhoto(this.data.photo);
      if (silent) this.setData({ reportLoading: true, reportError: '' });
      else this.setData({ model: null, photo: '', loading: true, error: '', notice: '', reportLoading: true, reportError: '', title: titles[viewForRole(this.data.role)] });
      await getApp().globalData.sessionHydrationPromise;
      const binding = session(), current = () => this.current(generation, binding);
      if (!current()) return;
      this._binding = binding;
      if (!binding.token || !canAccessRoute(projects, binding.identity)) {
        this.setData({ loading: false, reportLoading: false, error: '请使用有工地权限的员工身份登录。' }); return;
      }
      const key = 'site-workbench:project:' + binding.key + ':' + this.data.role;
      const saved = projectId || wx.getStorageSync(key);
      const selected = this.data.role !== 'enterprise_admin' && /^[1-9]\d*$/.test(String(saved)) ? saved : '';
      const activeRange = range || this.data.reportRange || rangeForKey('today');
      const query = [];
      if (selected) query.push('projectId=' + encodeURIComponent(selected));
      if (selected && this.data.role !== 'enterprise_admin' && activeRange?.from && activeRange?.to) {
        query.push('from=' + encodeURIComponent(activeRange.from), 'to=' + encodeURIComponent(activeRange.to));
      }
      try {
        let data, notice = '';
        const url = base + (query.length ? '?' + query.join('&') : '');
        try {
          ({ data } = await api.request(url, 'GET', {}, options));
        } catch (error) {
          if (!current() || !selected || error.statusCode !== 404) throw error;
          wx.removeStorageSync(key);
          ({ data } = await api.request(base, 'GET', {}, options));
          notice = '原工地已不可访问，已更新工地列表。';
        }
        if (!current()) return;
        if (data.project) wx.setStorageSync(key, data.project.id);
        const model = decorate(data);
        const nextRange = data.reports
          ? { ...(activeRange || rangeForKey('today')), from: data.reports.from, to: data.reports.to }
          : (this.data.reportRange || rangeForKey('today'));
        this.setData({
          model,
          title: titles[model.view],
          selectedIndex: Math.max(0, (model.choices || []).findIndex(item => item.id === model.project?.id)),
          reports: data.reports?.items || [],
          todaySummary: data.todaySummary || { total: 0, pending: 0, approved: 0, returned: 0 },
          reportRange: nextRange,
          loading: false,
          reportLoading: false,
          notice,
        });
        const photoId = !silent && (model.draft || model.receipt)?.photoId;
        if (photoId) {
          try {
            const file = await api.downloadFile('/miniprogram/construction/projects/' + model.project.id + '/chat/media/' + photoId, options);
            if (current()) this.setData({ photo: file.tempFilePath });
            else discardPhoto(file.tempFilePath);
          } catch { /* The source record stays accessible through its authorized detail. */ }
        }
      } catch (error) {
        if (!current()) return;
        if (silent) this.setData({ reportLoading: false, reportError: errorText(error) });
        else this.setData({ loading: false, reportLoading: false, error: errorText(error) });
      }
    },
    retry() { return this.load(null, this.data.reportRange); },
    async refresh() {
      this.setData({ refreshing: true });
      try { await this.load(null, this.data.reportRange); }
      finally { if (this._visible) this.setData({ refreshing: false }); }
    },
    changeProject(event) {
      const choice = this.data.model?.choices[Number(event.detail.value)];
      if (choice && choice.id !== this.data.model.project.id) {
        const range = rangeForKey('today');
        this.setData({ reportRange: range });
        return this.load(choice.id, range);
      }
    },
    navigate(url, captureAction) {
      if (!this._binding || !this.current(this._generation, this._binding) || this._navigating) return;
      this._navigating = true;
      wx.navigateTo({ url, success: ({ eventChannel }) => { if (captureAction) eventChannel?.emit('workbenchCapture', captureAction); },
        fail: () => wx.showToast({ title: '暂时无法打开，请重试', icon: 'none' }),
        complete: () => { this._navigating = false; } });
    },
    openProject() { const id = this.data.model?.project?.id; if (id) this.navigate(projects + '?project=' + id); },
    openAll() { this.navigate(projects); },
    openTask() {
      const task = this.data.model?.task;
      if (task?.issueId) this.openIssue({ currentTarget: { dataset: { issue: task.issueId } } });
      else if (task) this.openProject();
    },
    capture(event) {
      const { project, canCapture } = this.data.model || {};
      const action = event.currentTarget.dataset.action;
      if (canCapture && ['photo', 'voice'].includes(action)) {
        this._reloadTodayOnShow = true;
        this.navigate(reportPage + '?projectId=' + project.id + '&mode=' + action);
      }
    },
    selectRange(event) {
      const key = event.currentTarget.dataset.key;
      if (!['today', 'yesterday', 'week'].includes(key)) return;
      if (this.data.reportRange?.key === key) return;
      const range = rangeForKey(key);
      this.setData({ reportRange: range }, () => this.load(null, range, { silent: true }));
    },
    openCalendar() {
      const range = this.data.reportRange || rangeForKey('today');
      const month = String(range.from || dateKey(new Date())).slice(0, 7);
      const from = range.from || '', to = range.to || '';
      this._calendarMonth = month;
      this.setData({ showCalendar: true, calendar: this.calendarState(month, from, to) });
    },
    closeCalendar() { this.setData({ showCalendar: false }); },
    calendarPrev() { this.shiftCalendar(-1); },
    calendarNext() { this.shiftCalendar(1); },
    shiftCalendar(offset) {
      const current = this._calendarMonth || dateKey(new Date()).slice(0, 7);
      const [year, month] = current.split('-').map(Number);
      const date = new Date(year, month - 1 + offset, 1);
      this._calendarMonth = date.getFullYear() + '-' + pad(date.getMonth() + 1);
      this.setData({ calendar: this.calendarState(this._calendarMonth, this.data.calendar.from, this.data.calendar.to) });
    },
    calendarState(month, from, to) {
      const [year, monthNumber] = month.split('-').map(Number);
      const first = new Date(year, monthNumber - 1, 1);
      const days = new Date(year, monthNumber, 0).getDate();
      const today = dateKey(new Date());
      const padCount = (first.getDay() + 6) % 7;
      const cells = [];
      for (let index = 0; index < padCount; index += 1) cells.push({ key: 'pad-' + index, day: '', date: '', disabled: true });
      for (let day = 1; day <= days; day += 1) {
        const date = year + '-' + pad(monthNumber) + '-' + pad(day);
        const inRange = Boolean(from && to && date >= from && date <= to);
        cells.push({ key: date, day, date, disabled: date > today, today: date === today, inRange,
          start: date === from, end: date === to });
      }
      while (cells.length % 7) cells.push({ key: 'tail-' + cells.length, day: '', date: '', disabled: true });
      const weeks = [];
      for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
      return { month, monthLabel: year + '年' + monthNumber + '月', weeks, from: from || '', to: to || '',
        rangeLabel: from ? (to && to !== from ? shortDate(from) + '–' + shortDate(to) : shortDate(from)) : '请选择起止日期' };
    },
    pickCalendar(event) {
      const date = event.currentTarget.dataset.date;
      if (!date || date > dateKey(new Date())) return;
      const current = this.data.calendar;
      let from = current.from, to = current.to;
      if (!from || (from && to)) { from = date; to = ''; }
      else if (date < from) { from = date; to = ''; }
      else { to = date; }
      this.setData({ calendar: this.calendarState(this._calendarMonth, from, to) });
    },
    pickCalendarQuick(event) {
      const key = event.currentTarget.dataset.key;
      const range = key === 'month' ? (() => {
        const today = new Date();
        const from = dateKey(new Date(today.getFullYear(), today.getMonth(), 1));
        return { from, to: dateKey(today) };
      })() : rangeForKey(key);
      this._calendarMonth = range.from.slice(0, 7);
      this.setData({ calendar: this.calendarState(this._calendarMonth, range.from, range.to) });
    },
    resetCalendar() {
      this.setData({ calendar: this.calendarState(this._calendarMonth, '', '') });
    },
    applyCalendar() {
      const { from, to } = this.data.calendar;
      if (!from) { wx.showToast({ title: '请选择开始日期', icon: 'none' }); return; }
      const end = to || from;
      const startMs = Date.parse(from + 'T00:00:00Z'), endMs = Date.parse(end + 'T00:00:00Z');
      if (endMs - startMs > 92 * 86400000) { wx.showToast({ title: '最多可查近3个月', icon: 'none' }); return; }
      const range = customRange(from, end);
      this.setData({ showCalendar: false, reportRange: range }, () => this.load(null, range, { silent: true }));
    },
    openRecord(event) {
      const project = this.data.model?.project, id = event.currentTarget.dataset.record;
      if (project && id) {
        this._detailProjectId = project.id;
        this.setData({ showDetail: true, detailLoading: true, detail: null, detailError: '', detailPhotos: [] }, () => {
          void this.loadDetail(project.id, id);
        });
      }
    },
    async loadDetail(projectId, recordId) {
      try {
        const result = await api.request('/miniprogram/construction/projects/' + projectId + '/chat?recordId=' + encodeURIComponent(recordId) + '&limit=1', 'GET', {}, options);
        if (!this.data.showDetail) return;
        const items = result.data?.items || [];
        const item = items.find(candidate => candidate.record && String(candidate.record.id) === String(recordId));
        if (!item) throw new Error('record_missing');
        const record = item.record;
        const history = (this.data.reports || []).find(candidate => candidate.recordId === String(recordId)) || null;
        const stages = Array.isArray(record.stage_snapshot) ? record.stage_snapshot.filter(stage => stage && stage.name).map(stage => stage.name) : [];
        const status = history?.status || (record.status === 'published' ? 'approved' : record.status === 'changes_requested' ? 'returned' : record.status === 'withdrawn' ? 'withdrawn' : 'pending');
        this.setData({
          detailLoading: false,
          detail: {
            recordId: String(recordId),
            title: history?.title || record.data?.title || '现场上报',
            status,
            statusLabel: history?.statusLabel || (status === 'approved' ? '审核通过' : status === 'returned' ? '需补充' : status === 'withdrawn' ? '已撤回' : '待审核'),
            statusClass: status === 'approved' ? 'done' : status === 'returned' ? 'returned' : status === 'withdrawn' ? 'withdrawn' : 'pending',
            time: siteMessageTime(record.published_at || item.message?.created_at || record.created_at),
            stages,
            stageText: stages.join('、'),
            completed: String(record.data?.completed || ''),
            pending: String(record.data?.pending || ''),
            coordination: String(record.data?.coordination || ''),
            note: String(record.data?.note || ''),
            reviewRequirements: String(record.review_requirements || history?.returnReason || ''),
            approvedByName: String(record.approved_name || history?.approvedByName || ''),
            approvedAt: record.published_at ? siteMessageTime(record.published_at) : '',
            speech: record.speech || null,
            speechSeconds: record.speech?.duration_ms ? Math.max(1, Math.ceil(record.speech.duration_ms / 1000)) : 0,
            media: Array.isArray(record.media) ? record.media.slice(0, 9) : [],
          },
        });
        void this.downloadDetailPhotos(projectId, record.media || []);
      } catch (error) {
        if (this.data.showDetail) this.setData({ detailLoading: false, detailError: '这条上报暂时无法读取，请稍后重试。' });
      }
    },
    async downloadDetailPhotos(projectId, media) {
      this.clearDetailPhotos();
      const photos = [];
      for (const item of (media || []).slice(0, 9)) {
        try {
          const file = await api.downloadFile('/miniprogram/construction/projects/' + projectId + '/chat/media/' + item.id, options);
          if (!this.data.showDetail) { discardPhoto(file.tempFilePath); break; }
          this._detailPaths.add(file.tempFilePath);
          photos.push({ id: String(item.id), path: file.tempFilePath });
          this.setData({ detailPhotos: photos.slice() });
        } catch { /* A withdrawn original stays unavailable; the detail keeps its text. */ }
      }
    },
    clearDetailPhotos() {
      if (!this._detailPaths) this._detailPaths = new Set();
      for (const path of this._detailPaths) discardPhoto(path);
      this._detailPaths = new Set();
    },
    closeDetail(force = false) {
      this.stopDetailVoice();
      this.clearDetailPhotos();
      if (this.data.showDetail || force) this.setData({ showDetail: false, detail: null, detailPhotos: [], detailLoading: false, detailError: '' });
    },
    previewDetail(event) {
      const path = event.currentTarget.dataset.path;
      if (path) wx.previewImage({ current: path, urls: this.data.detailPhotos.map(photo => photo.path) });
    },
    async playDetailVoice() {
      if (this._detailAudio) { this.stopDetailVoice(); return; }
      const speech = this.data.detail?.speech, projectId = this._detailProjectId;
      if (!speech?.id || !projectId) return;
      try {
        const file = await api.downloadFile('/miniprogram/construction/projects/' + projectId + '/chat/speech/' + speech.id, options);
        this._detailPaths.add(file.tempFilePath);
        const audio = wx.createInnerAudioContext();
        this._detailAudio = audio;
        audio.src = file.tempFilePath;
        audio.onEnded(() => this.stopDetailVoice());
        audio.onError(() => { this.stopDetailVoice(); wx.showToast({ title: '语音暂时无法回听', icon: 'none' }); });
        audio.play();
        this.setData({ detailPlaying: true });
      } catch { wx.showToast({ title: '语音暂时无法回听', icon: 'none' }); }
    },
    stopDetailVoice() {
      if (this._detailAudio) {
        try { this._detailAudio.stop(); } catch { /* Already stopped. */ }
        try { this._detailAudio.destroy(); } catch { /* Already destroyed. */ }
        this._detailAudio = null;
      }
      if (this.data.detailPlaying) this.setData({ detailPlaying: false });
    },
    openDetailRework() {
      const projectId = this._detailProjectId, recordId = this.data.detail?.recordId;
      if (projectId && recordId) {
        this.closeDetail();
        this.navigate(chat + '?projectId=' + projectId + '&recordId=' + recordId + '&mode=review');
      }
    },
    openApproval(event) {
      const report = this.data.model?.pendingReport || {};
      const projectId = event.currentTarget.dataset.project || report.projectId;
      const recordId = event.currentTarget.dataset.record || report.recordId;
      if (projectId && recordId) this.navigate(chat + '?projectId=' + projectId + '&recordId=' + recordId + '&mode=review');
    },
    openIssue(event) {
      const { issue, project, record } = event.currentTarget.dataset;
      const id = project || this.data.model?.project?.id;
      if (record && id) { this.navigate(chat + '?projectId=' + id + '&recordId=' + record); return; }
      if (issue && id) this.navigate(chat + '?projectId=' + id + '&issueId=' + issue + '&mode=review');
    },
    openNode(event) {
      const { project, node } = event.currentTarget.dataset;
      if (project && node) this.navigate(projects + '?project=' + project + '&scheduleNode=' + encodeURIComponent(node));
    },
    openReports() {
      const project = this.data.model?.project?.id;
      this.navigate(reports + (project ? '&staffProjectId=' + project : ''));
    },
    openDesign() {
      if (this.data.role === 'designer' && canAccessRoute('/pages/ai-design/ai-design', session().identity)) openAIDesignTab();
    },
  },
});
