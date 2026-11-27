Component({
  properties: {
    src: { type: String, observer: 'sourceChanged' },
    epoch: Number,
    phase: { type: String, value: 'idle' },
    message: String,
    audioAllowed: Boolean,
    pausable: Boolean,
    fill: Boolean,
    compactControls: Boolean,
    poster: String,
    posterMode: { type: String, value: 'aspectFit' },
    posterKey: String,
    disabled: Boolean,
    trackProgress: Boolean,
  },

  data: { muted: true, fullscreen: false },

  methods: {
    sourceChanged(src, previous) {
      if (src === previous) return;
      if (!src && this.data.fullscreen) wx.createVideoContext('site-live-video', this).exitFullScreen();
      this.setData({ muted: true, fullscreen: false });
    },

    onAdvance(event) {
      const currentTime = event.detail.currentTime;
      if (!Number.isFinite(currentTime) || currentTime <= 0) return;
      const detail = { epoch: Number(event.currentTarget.dataset.epoch) };
      if (this.data.trackProgress) detail.currentTime = currentTime;
      if (this.data.phase === 'connecting' || (this.data.trackProgress && this.data.phase === 'playing')) this.triggerEvent('advance', detail);
    },

    onError(event) {
      this.triggerEvent('playbackerror', { ...event.detail, epoch: Number(event.currentTarget.dataset.epoch) });
    },

    posterError(event) { this.triggerEvent('postererror', { key: event.currentTarget.dataset.key }); },

    play() { if (!this.data.disabled) this.triggerEvent('play'); },

    togglePause() {
      if (!this.data.pausable || !this.data.src) return;
      if (this.data.phase === 'paused') return this.play();
      if (this.data.phase !== 'playing') return;
      try { wx.createVideoContext('site-live-video', this).pause(); } catch (_) { return; }
      this.triggerEvent('pause', { epoch: this.data.epoch });
    },

    stop() {
      if (this.data.src) {
        const video = wx.createVideoContext('site-live-video', this);
        if (this.data.fullscreen) video.exitFullScreen();
        video.stop();
      }
      this.triggerEvent('stop');
    },

    toggleAudio() {
      if (this.data.audioAllowed && this.data.phase === 'playing') this.setData({ muted: !this.data.muted });
    },

    fullscreen() {
      if (!this.data.src || (this.data.phase !== 'playing' && this.data.phase !== 'paused')) return;
      wx.createVideoContext('site-live-video', this).requestFullScreen({ direction: 90 });
    },

    fullscreenChanged(event) {
      if (Number(event.currentTarget.dataset.epoch) === this.data.epoch) {
        this.setData({ fullscreen: Boolean(event.detail.fullScreen) });
      }
    },
  },
});
