const api = require('../../../utils/api');
const { openAIDesignTab, openAIDesignEntry } = require('../../../utils/aiDesignNavigation');
const { formatAppointmentDisplay } = require('../../../utils/appointmentTimeRange');
const { openSurveyingEditor } = require('../../../utils/surveyNavigation');
const { buildWorkbenchSurvey } = require('../../../utils/workbenchSurvey');
const { canAccessRoute } = require('../../../utils/identity-navigation');
const { loadSiteFont } = require('../lib/site-font');
const { inspectionJourneyKey, readInspectionJourney, shanghaiDay: shanghaiDateKey } = require('../lib/inspection-journey');
const { siteMessageTime, errorText } = require('../chat/site-client');

const base = '/miniprogram/construction/workbench';
const projects = '/packages/construction/projects/projects';
const chat = '/packages/construction/chat/chat';
const reportPage = '/packages/construction/report/report';
const inspectionPage = '/packages/construction/inspection/inspection';
const reviewPage = '/packages/construction/inspection-record/inspection-record';
const reports = '/packages/assistant/chat/chat?followup=1&reportBoard=1';
const aiDesign = '/pages/ai-design/ai-design';
const { isInitialPasswordRequired, staffPasswordRequiredMethods } = require('../../../utils/session');
const options = { suppressUnauthorized: true };
const titles = { worker: '我的工地', manager: '施工经理工作台', designer: '设计师工作台', boss: '老板工作台' };
const statusLabels = { organizing: '待整理', draft: '等经理核对', published: '已发布', changes_requested: '待补拍', withdrawn: '已撤回' };
const emptyProjects = {
  designer: {
    title: '暂未分配工地',
    lines: ['请联系项目负责人分配工地。', '分配后，可在这里回复现场问题、核对设计变更。'],
  },
  worker: {
    title: '暂未分配工地',
    lines: ['请联系项目负责人分配工地。', '分配后，可在这里查看进度和现场记录。'],
  },
  boss: {
    title: '暂无可查看的工地',
    lines: ['请在后台确认当前企业的工地关联。', '关联后，这里会汇总进度和待协调事项。'],
  },
};

function session() {
  const app = getApp(), global = app.globalData;
  const context = global.bootstrap?.current?.context || global.userInfo || {};
  return { token: global.token || wx.getStorageSync('token'),
    key: [context.enterpriseId, context.staffId || context.adminId].filter(Boolean).join(':'),
    enterpriseName: global.bootstrap?.enterprise?.name || context.enterpriseName || global.userInfo?.enterpriseName || '',
    identity: global.bootstrap || global.userInfo, inspectionKey: inspectionJourneyKey(context) };
}

function viewForRole(role) {
  return role === 'enterprise_admin' ? 'boss' : role === 'designer' ? 'designer' : 'worker';
}

function shanghaiDay(value) {
  const instant = new Date(value);
  const day = new Date(+instant + 8 * 3600000);
  return value && Number.isFinite(+day) ? (day.getUTCMonth() + 1) + '月' + day.getUTCDate() + '日' : '';
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
  return { ...data, date: shanghaiDay(data.asOf),
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
  const hasProjects = data.view === 'boss' ? decorated.items.length : data.project;
  if (!hasProjects) decorated.emptyProject = emptyProjects[data.view] || emptyProjects.worker;
  if (data.reports) decorated.reports = { ...data.reports, items: (data.reports.items || []).map(decorateReport) };
  if (data.pendingReport) decorated.pendingReport = { ...data.pendingReport,
    time: siteMessageTime(data.pendingReport.at).replace(/^今天 /, ''),
    mediaLabel: [data.pendingReport.photoCount && data.pendingReport.photoCount + ' 张照片',
      data.pendingReport.hasVoice && '1 段语音'].filter(Boolean).join(' · ') };
  return decorated;
}

function managerTask(model) {
  const onsite = model.onsiteTask;
  if (onsite) {
    const mode = onsite.inspection;
    const at = siteMessageTime(onsite.at).replace(/^今天 /, '');
    return { kind: model.resumeInspection ? 'inspection-route' : 'inspection', tone: 'amber',
      label: mode.source === 'ai' ? '建议到场' : '需到场', title: onsite.title,
      meta: [onsite.room, at && at + ' 上报'].filter(Boolean).join(' · '),
      note: mode.reason === onsite.title ? '' : mode.reason,
      button: model.resumeInspection ? '继续巡检' : '查看巡检任务' };
  }
  const report = model.pendingReport;
  if (report) {
    return { kind: 'approval', label: '待审核', title: report.title, button: '审核上报',
      meta: [(report.stageNames || []).join('、') || report.authorName, report.time && report.time + ' 上报'].filter(Boolean).join(' · '),
      note: report.mediaLabel, project: report.projectId, record: report.recordId };
  }
  if (model.review) {
    return { kind: 'recheck', label: '待复查', title: model.review.title,
      meta: model.review.recordId ? '已补交' : model.review.roomName, button: '查看复查' };
  }
  return null;
}

function notebookTask(model, canDesign) {
  if (model.view === 'worker' && model.canCapture) {
    const returned = model.latestReturn;
    if (returned) return { kind: 'return', tone: 'amber', label: '需补充', title: returned.returnReason || returned.title,
      meta: [returned.returnedByName && returned.returnedByName + '退回', siteMessageTime(returned.at) + '上报'].filter(Boolean).join(' · '),
      button: '继续补充', recordId: returned.recordId };
    return { kind: 'capture', label: '现场记录', title: '记录今天的施工', meta: model.project?.stageName, button: '现场上报' };
  }
  if (model.view === 'boss' && model.exceptions.length) {
    const item = model.exceptions[0];
    const late = item.kind === 'late';
    const start = shanghaiDay(item.plannedStart), end = shanghaiDay(item.plannedEnd);
    const dates = start && end && item.plannedStart !== item.plannedEnd ? `${start}至${end}` : end || start;
    return { kind: late ? 'node' : 'issue', tone: late ? 'red' : 'amber', label: late ? '进度落后' : '待协调',
      title: late ? item.title + '逾期' : item.title, meta: [item.name, dates && '原计划 ' + dates].filter(Boolean).join(' · '),
      note: item.waitingFor ? '负责人 · ' + item.waitingFor : '', button: late ? '查看落后节点' : '查看事项',
      project: item.id, node: item.nodeKey, issue: item.issueId };
  }
  if (model.view === 'manager') {
    const visit = model.survey?.task;
    if (visit?.startMs <= Date.now()) return visit;
    const task = managerTask(model);
    if (task || !model.combinedManager) return task;
  }
  if (model.view === 'designer' || model.combinedManager) {
    if (model.survey?.task) return model.survey.task;
    const issue = model.reply?.[0] || model.changes?.[0];
    if (issue) return { kind: 'issue', label: model.reply?.length ? '待我答复' : '待核对变更', title: issue.title,
      meta: [model.project?.name, issue.roomName].filter(Boolean).join(' · '),
      button: model.reply?.length ? '查看并回复' : '查看事项', issue: issue.issueId, record: issue.recordId };
    const delivery = model.deliveries?.[0];
    if (delivery) return { kind: 'delivery', label: '待交付', title: '交付设计方案', meta: delivery.communityName || delivery.title,
      note: '正式户型已归档', button: canDesign ? '继续方案交付' : '查看客户档案', delivery };
  }
  if (model.pendingReport && ['designer', 'boss'].includes(model.view)) {
    const report = model.pendingReport;
    return { kind: 'approval', label: '待审核上报', title: report.title,
      meta: [report.projectName, report.authorName, report.time].filter(Boolean).join(' · '), button: '审核上报',
      project: report.projectId, record: report.recordId };
  }
  return null;
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
  properties: {
    role: { type: String, observer() { if (this._visible) this.load(); } },
    aiEntriesEnabled: { type: Boolean, observer() { this.syncAIDesignEntry(); } },
  },
  data: { model: null, photo: '', loading: true, error: '', passwordRequired: false, notice: '', selectedIndex: 0, navTop: 46, navHeight: 32, navRight: 96,
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
    ...staffPasswordRequiredMethods,
    syncAIDesignEntry() {
      const canDesign = this.data.role === 'designer' && canAccessRoute(aiDesign, session().identity);
      const model = this.data.model;
      this.setData({ canDesign, ...(model ? { 'model.notebookTask': notebookTask(model, canDesign) } : {}) });
    },
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
      this.setData({ model: null, photo: '', loading: true, error: '', passwordRequired: false, notice: '', showCalendar: false });
    },
    current(generation, binding) {
      const current = session();
      return this._visible && this._generation === generation && current.token === binding.token && current.key === binding.key;
    },
    async load(projectId, range, config = {}) {
      let silent = config.silent === true;
      const generation = this._generation = (this._generation || 0) + 1;
      if (!silent) discardPhoto(this.data.photo);
      if (silent) this.setData({ reportLoading: true, reportError: '' });
      else this.setData({ model: null, photo: '', loading: true, error: '', passwordRequired: false, notice: '', reportLoading: true, reportError: '', title: titles[viewForRole(this.data.role)] });
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
          if (silent) {
            silent = false;
            discardPhoto(this.data.photo);
            this.setData({ model: null, photo: '', loading: true, error: '', notice: '' });
          }
          ({ data } = await api.request(base, 'GET', {}, options));
          notice = '原工地已不可访问，已更新工地列表。';
        }
        if (!current()) return;
        if (data.project) wx.setStorageSync(key, data.project.id);
        const model = decorate(data);
        model.combinedManager = model.view === 'manager' && this.data.role === 'designer';
        if (model.onsiteTask && model.view === 'manager') {
          const route = readInspectionJourney(binding.inspectionKey)?.route;
          model.resumeInspection = Boolean(route?.active && route.stops.some(stop => stop.projectId === model.project.id));
        }
        const canDesign = this.data.role === 'designer' && canAccessRoute(aiDesign, binding.identity);
        if ((model.view === 'designer' || model.combinedManager) && this.data.role === 'designer'
          && canAccessRoute('/packages/enterprise/lead-detail/lead-detail', binding.identity)) {
          model.enterpriseName = binding.enterpriseName;
          model.date = shanghaiDay(Date.now());
          try {
            const tasks = (await api.request('/miniprogram/workbench', 'GET', {}, options)).data;
            if (!current()) return;
            if (tasks?.role === 'designer') {
              model.deliveries = (tasks.pendingDeliveries || []).filter(item => item.leadId && item.floorPlanId);
              const appointments = (tasks.appointments || []).filter(item => item.leadId && item.appointmentId);
              if (canAccessRoute('/packages/surveying/editor/surveying-editor', binding.identity)) {
                model.survey = buildWorkbenchSurvey(appointments, tasks.recentFloorPlans || []);
              }
              const now = Date.now();
              const today = shanghaiDateKey(now), tomorrow = shanghaiDateKey(now + 86400000);
              model.appointments = appointments.map(item => {
                const time = formatAppointmentDisplay(item.timeRange);
                const day = time.dateKey === today ? '今天' : time.dateKey === tomorrow ? '明日' : time.dateLabel;
                return { ...item, startMs: time.startMs,
                  timeLabel: [time.dateLabel, time.startMs ? time.timeText : '时间待确认'].filter(Boolean).join(' · '),
                  serviceTime: time.startMs ? day + ' ' + time.timeText.slice(0, 5) : '时间待确认' };
              }).sort((a, b) => (a.startMs || Infinity) - (b.startMs || Infinity)).slice(0, 3);
            }
          } catch (error) {
            if (!current()) return;
            model.customerTasksError = error.statusCode === 403 ? '当前身份不可查看客户任务' : '客户任务暂时无法读取';
          }
        }
        model.latestReturn = data.latestReturn === undefined && model.canCapture
          ? model.reports?.items.find(item => item.status === 'returned' && !item.resubmittedRecordId) : data.latestReturn;
        model.notebookTask = notebookTask(model, canDesign);
        const nextRange = data.reports
          ? { ...(activeRange || rangeForKey('today')), from: data.reports.from, to: data.reports.to }
          : (this.data.reportRange || rangeForKey('today'));
        this.setData({
          model,
          canDesign,
          title: titles[model.combinedManager ? 'designer' : model.view],
          selectedIndex: Math.max(0, (model.choices || []).findIndex(item => item.id === model.project?.id)),
          reports: model.reports?.items || data.reports?.items || [],
          todaySummary: data.todaySummary || { total: 0, pending: 0, approved: 0, returned: 0 },
          reportRange: nextRange,
          loading: false,
          reportLoading: false,
          passwordRequired: false,
          notice,
        });
        const photoId = !silent && model.view !== 'manager' && model.receipt?.photoId;
        if (photoId) {
          try {
            const file = await api.downloadFile('/miniprogram/construction/projects/' + model.project.id + '/chat/media/' + photoId, options);
            if (current()) this.setData({ photo: file.tempFilePath });
            else discardPhoto(file.tempFilePath);
          } catch { /* The source record stays accessible through its authorized detail. */ }
        }
      } catch (error) {
        if (!current()) return;
        const accessLost = [401, 403, 404].includes(error?.statusCode);
        if (silent && !accessLost) {
          this.setData({ reportLoading: false, reportError: '暂时无法读取上报' });
        } else {
          discardPhoto(this.data.photo);
          const passwordRequired = isInitialPasswordRequired(error);
          this._passwordRequiredToken = passwordRequired ? binding.token : null;
          this.setData({ model: null, photo: '', loading: false, reportLoading: false,
            passwordRequired, error: accessLost ? errorText(error) : '暂时无法读取工地', notice: '' });
        }
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
    runNotebookTask() {
      if (!this._binding || !this.current(this._generation, this._binding)) return;
      const task = this.data.model?.notebookTask;
      if (!task) return;
      const event = { currentTarget: { dataset: task } };
      if (task.kind === 'capture') return this.capture();
      if (task.kind === 'issue') return this.openIssue(event);
      if (task.kind === 'node') return this.openNode(event);
      if (task.kind === 'approval') return this.openApproval(event);
      if (task.kind === 'inspection') return this.openProjectInspection();
      if (task.kind === 'inspection-route') return this.openInspectionRoute();
      if (task.kind === 'recheck') return this.openManagerRecheck();
      if (task.kind === 'survey') return this.openSurveyTask(task.item);
      if (task.kind === 'appointment') return this.openCustomerAppointment({
        currentTarget: { dataset: { lead: task.item.leadId, appointment: task.item.appointmentId } },
      });
      if (task.kind === 'return' && this.data.model.canCapture && task.recordId) {
        this.navigate(`${reviewPage}?projectId=${this.data.model.project.id}&recordId=${encodeURIComponent(task.recordId)}`);
      }
      if (task.kind === 'delivery') {
        return this.openDeliveryTask(task.delivery);
      }
    },
    openCustomerLead(leadId) {
      if (leadId && canAccessRoute('/packages/enterprise/lead-detail/lead-detail', session().identity)) {
        this.navigate('/packages/enterprise/lead-detail/lead-detail?id=' + encodeURIComponent(leadId));
      }
    },
    openDelivery(event) { this.openCustomerLead(event.currentTarget.dataset.lead); },
    continueDelivery(event) {
      const lead = event.currentTarget.dataset.lead;
      const delivery = this.data.model?.deliveries?.find(item => item.leadId === lead);
      if (delivery) this.openDeliveryTask(delivery);
    },
    openDeliveryTask({ leadId, floorPlanId }) {
      if (!this._binding || !this.current(this._generation, this._binding)) return;
      if (canAccessRoute(aiDesign, session().identity)) return openAIDesignEntry({ leadId, floorPlanId });
      this.openCustomerLead(leadId);
    },
    openSurveyTask(item) {
      if (!item?.canPerformSurvey || this.data.role !== 'designer'
        || !this._binding || !this.current(this._generation, this._binding)) return;
      return openSurveyingEditor({ leadId: item.leadId, floorPlanId: item.floorPlanId, communityName: item.communityName });
    },
    openSurveyRecord(event) {
      if (this.data.role !== 'designer' || !this._binding || !this.current(this._generation, this._binding)) return;
      const entry = this.data.model?.survey?.records[event.currentTarget.dataset.index];
      if (entry?.action === 'survey') return this.openSurveyTask(entry.item);
      if (entry?.action === 'plan') return openSurveyingEditor({ floorPlanId: entry.item.floorPlanId });
    },
    openCustomerAppointment(event) {
      const { lead, appointment } = event.currentTarget.dataset;
      const route = '/packages/enterprise/appointment-detail/appointment-detail';
      if (lead && appointment && canAccessRoute(route, session().identity)) {
        this.navigate(`${route}?leadId=${encodeURIComponent(lead)}&appointmentId=${encodeURIComponent(appointment)}`);
      }
    },
    capture() {
      const { project, canCapture } = this.data.model || {};
      if (!canCapture || !project) return;
      this._reloadTodayOnShow = true;
      this.navigate(reportPage + '?projectId=' + project.id);
    },
    selectRange(event) {
      const key = event.currentTarget.dataset.key;
      if (!['today', 'yesterday', 'week'].includes(key)) return;
      if (this.data.reportRange?.key === key) return;
      const range = rangeForKey(key);
      this.setData({ reportRange: range }, () => this.load(null, range, { silent: true }));
    },
    notifySheet(open) {
      const app = getApp();
      if (app?.globalData) app.globalData.siteWorkbenchSheetOpen = Boolean(open);
      this.triggerEvent('sheetchange', { open: Boolean(open) });
    },
    openCalendar() {
      const range = this.data.reportRange || rangeForKey('today');
      const month = String(range.from || dateKey(new Date())).slice(0, 7);
      const from = range.from || '', to = range.to || '';
      this._calendarMonth = month;
      this.setData({ showCalendar: true, calendar: this.calendarState(month, from, to) });
      this.notifySheet(true);
    },
    closeCalendar() { this.notifySheet(false); this.setData({ showCalendar: false }); },
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
      this.notifySheet(false);
      this.setData({ showCalendar: false, reportRange: range }, () => this.load(null, range, { silent: true }));
    },
    openRecord(event) {
      const project = this.data.model?.project, id = event.currentTarget.dataset.record;
      if (project && id) {
        this._detailProjectId = project.id;
        this.setData({ showDetail: true, detailLoading: true, detail: null, detailError: '', detailPhotos: [] }, () => {
          void this.loadDetail(project.id, id);
        });
        this.notifySheet(true);
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
            approvedByName: record.approved_by ? String(record.approved_name || history?.approvedByName || '') : '',
            approvedAt: record.approved_by && record.published_at ? siteMessageTime(record.published_at) : '',
            inspectionNote: status === 'approved' ? String(record.inspection_receipt?.note || '') : '',
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
      if (this.data.showDetail || force) {
        this.notifySheet(false);
        this.setData({ showDetail: false, detail: null, detailPhotos: [], detailLoading: false, detailError: '' });
      }
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
        this.navigate(reviewPage + '?projectId=' + projectId + '&recordId=' + recordId);
      }
    },
    openApproval(event) {
      const report = this.data.model?.pendingReport || {};
      const projectId = event.currentTarget.dataset.project || report.projectId;
      const recordId = event.currentTarget.dataset.record || report.recordId;
      if (projectId && recordId) this.navigate(reviewPage + '?projectId=' + projectId + '&recordId=' + recordId);
    },
    openInspection() {
      if (this.data.model?.inspection) this.navigate(inspectionPage);
    },
    openProjectInspection() {
      const model = this.data.model;
      if (model?.view === 'manager' && model.onsiteTask) {
        this.navigate(inspectionPage + '?projectId=' + model.project.id + '&onsite=1&fromWorkbench=1');
      }
    },
    openInspectionRoute() {
      if (this.data.model?.view === 'manager' && this.data.model.inspection) this.navigate('/packages/construction/inspection-map/inspection-map');
    },
    openManagerRecheck() {
      const model = this.data.model;
      if (model?.view !== 'manager' || !model.review) return;
      const { issueId, recordId } = model.review;
      const event = { currentTarget: { dataset: { project: model.project.id, issue: issueId, record: recordId } } };
      return recordId ? this.openApproval(event) : this.openIssue(event);
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
      if (this.data.role === 'designer' && canAccessRoute(aiDesign, session().identity)) openAIDesignTab();
    },
  },
});
