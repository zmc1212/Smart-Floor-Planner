function shanghaiDay(value) {
  const date = new Date(Date.parse(value) + 8 * 3600000);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function todayInShanghai(now = Date.now()) {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}

/** Build the chat welcome state from the real owner-site projection. The
 * default welcome is returned as null so the caller keeps the existing page. */
function ownerSiteContext(project, report, now = Date.now()) {
  if (!project || !project.id || project.progressAccess !== true) return null;
  const name = String(project.name || '我家的工地');
  const stageName = String(project.stageName || '');
  const stageLabel = stageName ? stageName + '阶段' : '施工中';
  const hasReport = !!report;
  const hasTodayReport = hasReport && shanghaiDay(report.periodStart) === todayInShanghai(now);
  const siteGreeting = hasTodayReport
    ? `你好，我是小K。${name}的工地今天有新的进展，想先看今天的日报，还是聊聊下一步？`
    : hasReport
      ? `你好，我是小K。${name}的工地有新的日报，想先看日报，还是聊聊下一步？`
      : `你好，我是小K。${name}的工地目前在${stageLabel}，想了解哪方面？`;
  const siteTopics = [
    { title: '今天工地做了什么', helper: '看今日进展', icon: 'requirement-home', text: '今天工地做了什么？' },
    { title: stageName ? stageName + '阶段要注意什么' : '这个阶段要注意什么', helper: '关键提醒', icon: 'requirement-style', text: stageName ? stageName + '阶段要注意什么？' : '这个阶段要注意什么？' },
    { title: '下一步什么时候', helper: '看后续安排', icon: 'requirement-budget', text: '下一步什么时候？' }
  ];
  return {
    siteContext: { projectId: String(project.id), name, stageName, hasTodayReport, hasReport },
    siteTopics,
    siteGreeting
  };
}

module.exports = { ownerSiteContext, shanghaiDay, todayInShanghai };
