const { initialCameraLive, normalizeCameraList, privateCameraLiveMethods } = require('../lib/private-camera-live');

const initialStaffCamera = { ...initialCameraLive, liveProjectId: '', liveCameras: [], liveCameraIndex: 0, liveListLoading: false, liveListError: '' };

function staffCameraMethods(api, token, navigate) {
  const cameraPath = '/miniprogram/construction/staff-video/projects/';
  return {
    ...privateCameraLiveMethods(api, token, {
      endpoint: 'staff-video', current: page => page.current(),
      selection: page => ({ projectId: page.data.liveProjectId, bindingId: page.data.liveCameras[page.data.liveCameraIndex]?.bindingId }),
    }),

    closeSiteLive() {
      const { liveProjectId, liveListLoading } = this.data;
      if (!liveProjectId && !liveListLoading) return;
      this.clearPrivateLive({ liveProjectId: '', liveCameras: [], liveCameraIndex: 0, liveListLoading: false, liveListError: '' });
    },

    async showSiteLive(projectId) {
      if (!this.current() || !/^[1-9]\d{0,18}$/.test(projectId)) return;
      if (this.data.liveProjectId === projectId) {
        if (this.data.liveListLoading) return;
        if (this.data.liveCameras.length) return this.startPrivateLive();
      }
      this.clearPrivateLive({ liveProjectId: projectId, liveCameras: [], liveCameraIndex: 0, liveListLoading: true, liveListError: '' });
      const epoch = this._liveEpoch, viewer = token();
      const valid = () => this.current() && viewer === token() && this._liveEpoch === epoch;
      try {
        const { data } = await api.request(cameraPath + projectId + '/cameras', 'GET', {}, { suppressUnauthorized: true });
        if (!valid()) return;
        const liveCameras = normalizeCameraList(data?.items);
        this.setData({ liveCameras, liveListLoading: false });
        if (liveCameras.length) return this.startPrivateLive();
      } catch (error) {
        if (valid()) this.setData({ liveListLoading: false,
          liveListError: [401, 403, 404].includes(error?.statusCode) ? '直播权限或会话已失效。' : '监控信息暂时无法读取' });
      }
    },

    retrySiteLive() { return this.showSiteLive(this.data.liveProjectId); },

    selectSiteCamera(event) {
      const liveCameraIndex = Number(event.detail.value);
      if (!this.data.liveCameras[liveCameraIndex] || liveCameraIndex === this.data.liveCameraIndex) return;
      this.clearPrivateLive({ liveCameraIndex });
      return this.startPrivateLive();
    },

    openCompatibleSiteCamera() {
      const projectId = this.data.liveProjectId;
      if (!projectId || !this.current()) return;
      this.closeSiteLive();
      navigate('/packages/construction/camera/camera?projectId=' + encodeURIComponent(projectId) + '&staff=1');
    },
  };
}
module.exports = { initialStaffCamera, staffCameraMethods };
