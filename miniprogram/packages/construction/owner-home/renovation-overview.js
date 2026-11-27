const { rankCustomerProjects } = require('../../../utils/customerServiceHome');
const { sortSchemesByFirstPublished } = require('../../../utils/published-scheme-order');
const { displayName } = require('../lib/family-view');

const STEPS = ['预约', '量房', '方案', '施工'];
const BOOKING_ACTIONS = ['book', 'rebook'];
const SURVEY_ACTIVE = ['appointment_in_progress', 'survey_ready'];
const id = value => /^[1-9]\d{0,18}$/.test(String(value || ''));

function renovationProjects(leads, sites) {
  const byLead = new Map();
  const unlinked = [];
  for (const site of sites) {
    if (!id(site.leadId)) {
      unlinked.push(site);
      continue;
    }
    const previous = byLead.get(site.leadId);
    if (!previous || !previous.progressAccess && site.progressAccess) byLead.set(site.leadId, site);
  }
  const matched = rankCustomerProjects(leads).filter(lead => id(lead.leadId)).map(lead => {
    const site = byLead.get(lead.leadId);
    byLead.delete(lead.leadId);
    const name = displayName(site?.name || lead.communityName, '装修项目 ' + lead.leadId.slice(-4));
    return { key: 'lead-' + lead.leadId, lead, site: site || null, name };
  });
  for (const site of [...byLead.values(), ...unlinked]) {
    matched.push({ key: 'site-' + site.id, lead: null, site, name: displayName(site.name, '我家工地') });
  }
  return matched.sort((left, right) => Number(right.site?.progressAccess === true) - Number(left.site?.progressAccess === true));
}

function shanghaiDate(value, includeTime = false) {
  const date = new Date(Date.parse(value) + 8 * 3600000);
  if (Number.isNaN(date.getTime())) return '';
  const day = `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
  return includeTime ? day + ' ' + date.toISOString().slice(11, 16) : day;
}

function latestScheme(project) {
  const schemes = sortSchemesByFirstPublished(project.publishedSchemes).filter(scheme => scheme.id && scheme.images?.length);
  const active = schemes.find(scheme => scheme.id === project.featuredScheme?.id) || schemes.at(-1);
  if (!active) return null;
  const cover = active.images.at(-1);
  const day = shanghaiDate(cover.publishedAt || active.publishedAt || active.firstPublishedAt);
  return { id: String(active.id), title: String(active.title || '设计方案'),
    meta: ['第 ' + (schemes.indexOf(active) + 1) + ' 版', day && day + '发布'].filter(Boolean).join(' · '),
    endpoint: cover.imageEndpoint || '' };
}

function serviceCard(project) {
  const stage = project.serviceStage;
  const appointment = project.appointment;
  const advisor = displayName(project.designer?.displayName, '');
  const rows = [{ key: 'archive', icon: 'file', label: '查看服务档案', meta: '服务进度' }];
  if (stage !== 'referrer_withdrawn' && (advisor || project.designer)) rows.push({ key: 'contact', icon: 'person', label: '联系设计顾问', meta: advisor });
  let card;
  if (['referrer_withdrawn', 'closed'].includes(stage)) {
    card = { step: -1, badge: project.serviceStageLabel || '服务已结束', title: '查看服务记录', action: 'archive', label: '查看服务档案', rows: [] };
  } else if (BOOKING_ACTIONS.includes(project.nextActionKind)) {
    const rebook = project.nextActionKind === 'rebook';
    card = { step: 0, badge: rebook ? '待重新预约' : '待预约', tone: 'warm', title: '预约上门量房',
      subtitle: '选择你方便的上门时间', note: (advisor || '设计顾问') + '会在上门前与你确认',
      action: 'book', label: rebook ? '重新预约' : '预约量房', art: true, rows };
  } else if (appointment?.id && (stage === 'appointment_confirmed' || SURVEY_ACTIVE.includes(stage))) {
    if (project.canReschedule) rows.splice(1, 0, { key: 'reschedule', icon: 'calendar', label: '改期' });
    card = { step: stage === 'appointment_confirmed' ? 0 : 1, badge: project.serviceStageLabel || '已预约量房',
      title: stage === 'appointment_confirmed' ? '已预约上门量房' : '量房进行中',
      subtitle: project.appointmentSummary, action: 'appointment', label: '查看预约', art: true, rows };
  } else {
    const scheme = latestScheme(project);
    if (scheme) {
      if (project.formalFloorPlan?.previewEndpoint) rows[0] = { key: 'floorplan', icon: 'ruler', label: '查看正式户型' };
      card = { step: 2, badge: '方案已发布', title: scheme.title, subtitle: scheme.meta,
        action: 'scheme', label: '查看方案', scheme, rows };
    } else if (stage === 'survey_completed' || project.formalFloorPlan) {
      if (project.formalFloorPlan?.previewEndpoint) rows[0] = { key: 'floorplan', icon: 'ruler', label: '查看正式户型' };
      card = { step: 2, badge: '量房已完成', title: '设计方案制作中', subtitle: '发布后可在这里查看',
        action: advisor ? 'contact' : 'archive', label: advisor ? '联系设计顾问' : '查看服务档案',
        rows: rows.filter(row => row.key !== (advisor ? 'contact' : 'archive')) };
    } else {
      card = { step: 0, badge: project.serviceStageLabel || '服务准备中', title: '等待顾问确认',
        subtitle: '确认服务安排后即可预约上门量房', action: 'archive', label: '查看服务档案',
        rows: rows.filter(row => row.key !== 'archive') };
    }
  }
  return card;
}

function overviewCard({ service, project, report, decision, live, site }) {
  const progress = project?.progressAccess === true;
  let card;
  if (progress) {
    const actionablePlan = id(decision?.id);
    const actionableLive = live?.canDecide === true;
    const hasConfirmation = actionablePlan || actionableLive;
    const date = actionablePlan ? shanghaiDate(decision.publishedAt) : '';
    const digest = (report?.progress || []).slice(0, 1).join('') || (report ? '这份日报暂无进展摘要' : '暂无已发布的日报');
    const reportDate = shanghaiDate(report?.publishedAt || report?.periodStart);
    const rows = [
      { key: 'schedule', icon: 'calendar', label: hasConfirmation ? '查看施工排期' : '施工排期' },
      { key: 'family', icon: 'person', label: '家人查看', meta: '邀请与管理' },
    ];
    if (hasConfirmation) {
      rows.push({ key: 'site', icon: 'file', label: '查看我家工地' });
    } else {
      rows.unshift({ key: 'report', icon: 'file', label: '日报与周报',
        meta: report ? reportDate : '暂无日报', summary: report ? digest : '' });
    }
    card = { step: 3, ordinaryConstruction: !hasConfirmation, badge: hasConfirmation ? '待我确认' : '施工中',
      tone: hasConfirmation ? 'warm' : '', stage: project.stageName,
      title: actionablePlan ? decision.title : actionableLive ? '直播公开申请' : (project.stageName || '查看当前施工进展'),
      subtitle: actionablePlan ? ['施工团队', date && date + '发布'].filter(Boolean).join(' · ')
        : actionableLive ? displayName(live.alias, '查看直播公开范围') : '',
      action: actionablePlan ? 'decision' : actionableLive ? 'live' : 'site',
      label: hasConfirmation ? '查看待确认事项' : '查看施工进展',
      digest, date: reportDate, rows,
    };
  } else if (service) {
    card = serviceCard(service);
    if (site) card.rows.push({ key: 'site', icon: 'file', label: '查看我家工地' });
  } else {
    card = { step: -1, badge: '工地已关联', title: '查看我家工地', action: 'site', label: '查看工地', rows: [] };
  }

  const appointment = service?.appointment?.status;
  const surveyed = Boolean(service?.formalFloorPlan) || appointment === 'completed';
  const known = [
    surveyed || appointment === 'confirmed',
    surveyed,
    Boolean(service?.publishedSchemes?.some(scheme => scheme.images?.length)),
    false,
  ];
  card.steps = STEPS.map((label, index) => ({
    label,
    tone: index === card.step ? 'current' : known[index] ? 'done' : 'upcoming',
  }));
  card.stepFill = known.findIndex(value => !value);
  return card;
}

module.exports = { renovationProjects, overviewCard, shanghaiDate };
