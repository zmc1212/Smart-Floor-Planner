/* eslint-disable @typescript-eslint/no-require-imports -- Shared deterministic Stable native driver. */
const assert = require('node:assert/strict');

function liveTargetSelectors(messageId, kind) {
  assert.match(String(messageId), /^[1-9]\d*$/);
  const suffix = { action: ['.owner-live-primary', '.owner-live-primary'], scope: ['.owner-live-preview', '.owner-live-primary'], approve: ['.owner-live-approve', '.owner-live-approve'], stop: ['.owner-live-stop', '.owner-live-stop'] }[kind];
  assert.ok(suffix, 'Unknown live target kind');
  return suffix.map(child => '#message-' + messageId + ' ' + child);
}

function liveScrollPlan(m) {
  for (const r of [m.container, m.start, m.end]) {
    assert.ok(r && ['left', 'right', 'top', 'bottom'].every(k => Number.isFinite(r[k])), 'Missing live target geometry');
    assert.ok(r.right > r.left && r.bottom > r.top, 'Empty live target geometry');
  }
  assert.ok(Number.isFinite(m.offset?.scrollTop) && m.offset.scrollTop >= 0, 'Missing scroll offset');
  assert.ok(m.window?.windowWidth === 390 && m.window.windowHeight === 844, 'Unexpected logical viewport');
  const clip = { left: Math.max(0, m.container.left) + 8, right: Math.min(390, m.container.right) - 8,
    top: Math.max(0, m.container.top) + 8, bottom: Math.min(844, m.container.bottom, m.composer?.top ?? 844) - 8 };
  const target = { left: Math.min(m.start.left, m.end.left), right: Math.max(m.start.right, m.end.right), top: m.start.top, bottom: m.end.bottom };
  assert.ok(target.left >= clip.left && target.right <= clip.right, 'Live target clipped horizontally');
  assert.ok(target.bottom > target.top && target.bottom - target.top <= clip.bottom - clip.top, 'Live target cannot fit the scroll viewport');
  const delta = target.top < clip.top ? target.top - clip.top : target.bottom > clip.bottom ? target.bottom - clip.bottom : 0;
  const requested = m.offset.scrollTop + delta;
  // Stable applies integer offsets. Round toward the direction of travel so
  // a fractional target can clear the measured clip instead of stalling.
  const scrollTop = delta > 0 ? Math.ceil(requested) : delta < 0 ? Math.floor(requested) : requested;
  return { visible: delta === 0, scrollTop: Math.max(0, scrollTop), clip, target };
}

async function revealLiveTarget({ measure, scroll }) {
  const observations = [];
  for (let i = 0; i < 3; i++) {
    const measurement = await measure(), plan = liveScrollPlan(measurement);
    observations.push({ measurement, plan });
    if (plan.visible) return { observations, final: plan };
    if (i < 2) await scroll(plan.scrollTop);
  }
  throw Object.assign(new Error('Current live target remains outside the visible scroll viewport'), { observations });
}

async function revealNativeLiveTarget(cli, project, liveId, messageId, kind, wait) {
  const selectors = liveTargetSelectors(messageId, kind); let serial = 0;
  const measure = async () => {
    const options = { selectors, liveId, messageId, nonce: 'live-target.' + Date.now() + '.' + serial++ };
    const collect = () => {
      const o = JSON.parse('__LIVE_TARGET__'), p = getCurrentPages().at(-1), s = getApp().__qaPublicLive;
      if (p.route !== 'packages/assistant/chat/chat' || p.data.liveCards[o.messageId]?.id !== o.liveId) throw Error('Current live message is missing');
      wx.createSelectorQuery().select('.conversation-scroll').boundingClientRect().select('.conversation-scroll').scrollOffset()
        .select(o.selectors[0]).boundingClientRect().select(o.selectors[1]).boundingClientRect().select('.composer-dock').boundingClientRect()
        .exec(rects => { s.liveTargetMetrics = { nonce: o.nonce, window: wx.getWindowInfo(), container: rects[0], offset: rects[1], start: rects[2], end: rects[3], composer: rects[4] }; });
      return { requested: true };
    };
    await cli.evaluateSource(collect.toString().replace("'__LIVE_TARGET__'", JSON.stringify(JSON.stringify(options))));
    return wait(async () => { const m = await cli.evaluate(() => getApp().__qaPublicLive.liveTargetMetrics || null); return m?.nonce === options.nonce ? m : null; }, 'current live target bounds');
  };
  return revealLiveTarget({ measure, scroll: y => cli.call('automation_element_action', { project, selector: '.conversation-scroll', action: 'scrollTo', x: 0, y }) });
}

module.exports = { liveTargetSelectors, liveScrollPlan, revealLiveTarget, revealNativeLiveTarget };
