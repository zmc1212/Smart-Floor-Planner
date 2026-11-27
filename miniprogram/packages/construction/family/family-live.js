const { normalizeCameraList, privateCameraLiveMethods } = require('../lib/private-camera-live');

function familyLiveMethods(api, sessionToken) {
  const playback = privateCameraLiveMethods(api, sessionToken, {
    current: page => page._visible,
    selection: page => ({ projectId: page.data.projectId, bindingId: page.data.cameras[page.data.cameraIndex]?.bindingId }),
    recheck: page => page.refreshProject(false),
    reset: page => page.load(),
  });

  return {
    ...playback,
    clearFamilyLive: playback.clearPrivateLive,
    startFamilyLive: playback.startPrivateLive,
    onLiveAdvance: playback.onPrivateLiveAdvance,
    onLiveError: playback.onPrivateLiveError,
    stopFamilyLive: playback.stopPrivateLive,

    switchFamilyCamera(event) {
      const cameraIndex = Number(event.detail.value);
      if (!this.data.cameras[cameraIndex] || this.data.cameraIndex === cameraIndex) return;
      this.clearFamilyLive();
      this.setData({ cameraIndex, liveSettings: false });
      void this.startFamilyLive();
    },

    toggleFamilyLiveSettings() {
      this.setData({ liveSettings: !this.data.liveSettings });
    },
  };
}

module.exports = { familyLiveMethods, normalizeFamilyCameras: normalizeCameraList };
