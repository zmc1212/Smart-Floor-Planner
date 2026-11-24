const api = require('../../../utils/api');

function listenForReply(runId, receive, close) {
  if (typeof wx === 'undefined' || typeof wx.request !== 'function') return null;
  const app = getApp();
  const token = app?.globalData?.token || wx.getStorageSync('token');
  let buffer = '';
  const task = wx.request({
    url: api.getBaseUrls()[0] + '/miniprogram/assistant/runs/' + encodeURIComponent(runId) + '/answer-stream',
    method: 'GET', enableChunked: true, responseType: 'arraybuffer', dataType: 'text', timeout: 30000,
    header: { Authorization: token ? 'Bearer ' + token : '' },
    complete: close,
  });
  if (typeof task?.onChunkReceived !== 'function') { task?.abort(); return null; }
  const chunks = event => {
    const bytes = new Uint8Array(event.data);
    for (let offset = 0; offset < bytes.length; offset += 4096) {
      buffer += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 4096));
    }
    const lines = buffer.split('\n');
    buffer = lines.pop();
    if (buffer.length > 100000) { task.abort(); return; }
    for (const line of lines) {
      if (!line || line.length > 100000) continue;
      let value;
      try { value = JSON.parse(line); } catch { continue; }
      if (value.type === 'preview') receive(value.text);
      else if (value.type === 'refresh') receive('');
    }
  };
  task.onChunkReceived(chunks);
  return () => { task.offChunkReceived?.(chunks); task.abort(); };
}

class LiveAnswer {
  constructor(emit, listen = listenForReply) {
    this.emit = emit;
    this.listen = listen;
    this.text = '';
  }

  sync(run) {
    if (!run?.answerStreaming || !['queued', 'running'].includes(run.status)) { this.stop(); return; }
    if (run.id !== this.id) { this.stop(); this.id = run.id; }
    if (!this.connection?.receiving) this.receive(run.answerPreview?.text || '');
    if (!this.connection && !this.pollOnly) {
      const connection = this.connection = {};
      try {
        connection.abort = this.listen(run.id, text => {
          if (this.connection !== connection) return;
          connection.receiving = true;
          this.receive(text);
        }, () => {
          if (this.connection === connection) this.connection = null;
        });
        if (!connection.abort) { this.pollOnly = true; this.connection = null; }
      } catch { this.pollOnly = true; this.connection = null; }
    }
  }

  finish(messageId, text) {
    this.disconnect();
    this.finalId = messageId;
    this.receive(text);
    if (this.text === this.target) this.stop();
    else this.emit(this.text, messageId, this.target);
  }

  receive(value) {
    if (typeof value !== 'string' || value.length > 16000) return;
    this.target = value;
    if (!value.startsWith(this.text)) this.show('');
    if (!this.timer && this.text !== value) this.advance();
  }

  advance() {
    this.timer = null;
    if (!this.target.startsWith(this.text) || this.text === this.target) return;
    const remaining = Array.from(this.target.slice(this.text.length));
    this.show(this.text + remaining.slice(0, Math.max(2, Math.ceil(remaining.length / 26))).join(''));
    if (this.text !== this.target) this.timer = setTimeout(() => this.advance(), 24);
    else if (this.finalId) this.stop();
  }

  show(text) {
    if (this.text !== text) { this.text = text; this.emit(text, this.finalId || '', this.target); }
  }

  disconnect() {
    const connection = this.connection;
    this.connection = null;
    connection?.abort?.();
  }

  stop() {
    this.disconnect();
    clearTimeout(this.timer);
    this.timer = null;
    this.id = null;
    this.target = '';
    this.pollOnly = false;
    const displayed = !!(this.text || this.finalId);
    this.text = '';
    this.finalId = '';
    if (displayed) this.emit('', '');
  }
}

module.exports = { LiveAnswer };
