const EDGE = 2;

function replyScrollPosition({ view, bubble, end, held, jump, contentBottom = bubble.bottom, anchorShift = 0 }) {
  const offset = Math.max(0, view.scrollTop);
  const bottom = Math.max(0, offset + end.bottom - view.bottom);
  const roomAbove = bubble.top - view.top;
  const hidden = Math.max(bubble.bottom, contentBottom) - view.bottom;
  let top = offset;
  if (jump) top = bottom;
  else if (held) top += anchorShift;
  else top += Math.min(roomAbove, Math.max(0, hidden));
  top = Math.round(Math.min(bottom, Math.max(0, top)));
  const stopped = held || jump || roomAbove - (top - offset) <= EDGE;
  return { top, held: stopped, showEnd: contentBottom - view.bottom - (top - offset) > EDGE };
}

/** Only handles the on-screen reply of a run observed in this view. */
class ReplyScroll {
  constructor(host) { this.host = host; }

  sync() {
    const { conversation, run, generating, followupActive, staffTab, professionalFollowup, ownerSiteReport, fatal } = this.host.data;
    if (!conversation?.id || !run?.id || followupActive || staffTab || professionalFollowup || ownerSiteReport || fatal) {
      this.reset();
      return false;
    }
    if (this.turn && (this.turn.conversation !== conversation.id || this.turn.id !== run.id)) this.reset();
    if (!this.turn && generating) this.turn = { conversation: conversation.id, id: run.id, held: !!this.host._holdAutoScroll };
    this.request();
    return !!this.turn;
  }

  bubble() {
    const { conversation, run, generating, revealingReplyId, liveAnswerText } = this.host.data;
    if (run?.id !== this.turn?.id || conversation?.id !== this.turn?.conversation) return null;
    if ((generating || revealingReplyId) && liveAnswerText)
      return { id: 'answer-stream-message', phase: generating ? 'streaming' : 'revealing' };
    const latest = conversation.latestRun?.id === run.id ? conversation.latestRun : run;
    return latest?.outputMessageId ? { id: 'message-' + latest.outputMessageId, phase: 'saved', outputId: latest.outputMessageId } : null;
  }

  hold() { if (this.turn) this.turn.held = true; }

  jump() {
    if (!this.turn) return;
    this.hold();
    this.turn.jump = true;
    this.request();
  }

  show(value) {
    if (this.host._alive && this.host.data.showReplyEnd !== value) this.host.setData({ showReplyEnd: value });
  }

  suspend() {
    if (this.turn) this.turn = { ...this.turn, held: true, jump: false };
    this.clearTimer();
    this.show(false);
  }

  reset() {
    this.turn = null;
    this.clearTimer();
    this.show(false);
  }

  clearTimer() {
    clearTimeout(this.timer);
    this.timer = null;
    this.repeat = false;
  }

  request() {
    if (!this.turn || !this.host._alive || !this.host._shown) return;
    const immediate = this.turn.sample && this.turn.sample.phase !== this.bubble()?.phase;
    if (this.timer && !immediate) return;
    if (this.timer) this.clearTimer();
    if (this.measuring) { this.repeat = true; return; }
    this.timer = setTimeout(() => { this.timer = null; this.measure(); }, immediate ? 0 : 40);
  }

  measure() {
    const turn = this.turn, reply = turn && this.bubble(), host = this.host;
    if (!reply || !host._shown) { this.show(false); return; }
    const query = host.createSelectorQuery ? host.createSelectorQuery() : wx.createSelectorQuery();
    const message = '#' + reply.id;
    query.select('.conversation-scroll').fields({ rect: true, size: true, scrollOffset: true });
    query.select(message + ' .bubble').boundingClientRect();
    query.select('#conversation-end').boundingClientRect();
    query.selectAll(message + ' .bubble .message-block').boundingClientRect();
    if (reply.outputId) {
      query.select(message + ' .designer-cards').boundingClientRect();
      query.select(message + ' .designer-discovery-card').boundingClientRect();
      query.select('#discovery-' + reply.outputId).boundingClientRect();
    }
    this.measuring = true;
    query.exec(([view, bubble, end, textBlocks, ...cards] = []) => {
      this.measuring = false;
      const again = this.repeat;
      this.repeat = false;
      const current = this.turn && this.bubble();
      if (host._shown && turn === this.turn && current?.phase === reply.phase && current.id === reply.id) {
        if (view && bubble && end && Number.isFinite(view.scrollTop)) {
          const contentBottom = Math.max(textBlocks?.at(-1)?.bottom ?? bubble.bottom, ...cards.map(card => card?.bottom ?? -Infinity));
          this.layout(turn, reply, view, bubble, end, contentBottom);
        }
        else this.show(false);
      }
      if (again) this.request();
    });
  }

  layout(turn, reply, view, bubble, end, contentBottom) {
    const screenTop = bubble.top - view.top;
    const contentTop = screenTop + view.scrollTop;
    const previous = turn.sample;
    // Moving between the typing and saved bubbles also replaces the process
    // row above them. The native view can already compensate, so correct only
    // the remaining visible movement when that row changes the layout.
    const changedRow = previous && previous.phase !== reply.phase && Math.abs(contentTop - previous.contentTop) > EDGE;
    const anchorShift = changedRow ? screenTop - previous.screenTop : 0;
    const position = replyScrollPosition({ view, bubble, end, held: turn.held, jump: turn.jump, contentBottom, anchorShift });
    const jumped = turn.jump;
    turn.jump = false;
    turn.held = position.held;
    turn.sample = { phase: reply.phase, contentTop, screenTop: contentTop - position.top };
    if (Math.abs(position.top - view.scrollTop) > (jumped ? 0 : 1)) this.move(turn, view.scrollTop, position.top);
    this.show(position.showEnd);
  }

  move(turn, from, top) {
    const host = this.host;
    if (host.data.replyScrollTop !== top) { host.setData({ scrollTarget: '', replyScrollTop: top }); return; }
    host.setData({ scrollTarget: '', replyScrollTop: from }, () => {
      if (this.turn === turn && host._shown) host.setData({ replyScrollTop: top });
    });
  }
}

module.exports = { ReplyScroll, replyScrollPosition };
