function navigationMetrics() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let menuRect = null;
  try {
    menuRect = wx.getMenuButtonBoundingClientRect();
  } catch (error) {
    menuRect = null;
  }
  const menuLeft = Number((menuRect && menuRect.left) || windowInfo.windowWidth - 94);
  return {
    navigationTop: Number((menuRect && menuRect.top) || windowInfo.statusBarHeight || 24),
    navigationHeight: Number((menuRect && menuRect.height) || 32),
    navigationRight: Math.max(94, Number(windowInfo.windowWidth || 390) - menuLeft + 10),
  };
}

const api = require('../../utils/api.js');
const bluetooth = require('../../utils/bluetooth.js');

function withSelection(scannedDevices, selectedIds) {
  const selected = new Set(selectedIds || []);
  return (scannedDevices || []).map((item) => ({
    ...item,
    checked: selected.has(item.deviceId),
  }));
}

Component({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    loading: true,
    error: '',
    devices: [],
    enterprises: [],
    enterpriseNames: [],
    enterpriseIndex: 0,
    selectedEnterpriseId: '',
    scanning: false,
    assigning: false,
    scannedDevices: [],
    selectedIds: [],
    selectedCount: 0,
    allSelected: false,
    statusText: '待扫描附近 LDMStudio 4D',
    description: '',
  },

  lifetimes: {
    attached() {
      this.setData(navigationMetrics());
      this.load();
    },
  },

  methods: {
    syncSelectionState(scannedDevices, selectedIds) {
      const list = withSelection(scannedDevices, selectedIds);
      const selectedCount = selectedIds.length;
      this.setData({
        scannedDevices: list,
        selectedIds,
        selectedCount,
        allSelected: list.length > 0 && selectedCount === list.length,
      });
    },

    async load() {
      this.setData({ loading: true, error: '' });
      try {
        const result = await api.request('/miniprogram/devices', 'GET');
        if (!result.success) {
          throw new Error(result.error || '设备列表加载失败');
        }
        const enterprises = (result.data && result.data.enterprises) || [];
        const devices = (result.data && result.data.devices) || [];
        const enterpriseNames = enterprises.map(
          (item) => item.name || item.code || item._id
        );
        const selectedEnterpriseId =
          this.data.selectedEnterpriseId ||
          (enterprises[0] && enterprises[0]._id) ||
          '';
        const enterpriseIndex = Math.max(
          0,
          enterprises.findIndex((item) => item._id === selectedEnterpriseId)
        );
        this.setData({
          loading: false,
          devices,
          enterprises,
          enterpriseNames,
          enterpriseIndex: enterpriseIndex >= 0 ? enterpriseIndex : 0,
          selectedEnterpriseId,
        });
      } catch (error) {
        this.setData({
          loading: false,
          error: error instanceof Error ? error.message : '设备列表加载失败',
        });
      }
    },

    onEnterpriseChange(event) {
      const index = Number(event.detail.value || 0);
      const enterprise = this.data.enterprises[index];
      this.setData({
        enterpriseIndex: index,
        selectedEnterpriseId: enterprise ? enterprise._id : '',
      });
    },

    onDescriptionInput(event) {
      this.setData({ description: event.detail.value || '' });
    },

    onToggleDevice(event) {
      const deviceId = String(event.currentTarget.dataset.id || '');
      if (!deviceId) return;
      const selected = new Set(this.data.selectedIds || []);
      if (selected.has(deviceId)) selected.delete(deviceId);
      else selected.add(deviceId);
      this.syncSelectionState(this.data.scannedDevices, [...selected]);
    },

    onToggleSelectAll() {
      const list = this.data.scannedDevices || [];
      if (!list.length) return;
      if (this.data.allSelected) {
        this.syncSelectionState(list, []);
        return;
      }
      this.syncSelectionState(
        list,
        list.map((item) => item.deviceId)
      );
    },

    onScanNearby() {
      if (this.data.scanning) return;
      this.setData({
        scanning: true,
        statusText: '正在搜索附近 LDMStudio 4D...',
      });
      this.syncSelectionState([], []);

      bluetooth.scanBLEForEnrollment(
        (found) => {
          const next = [...(this.data.scannedDevices || [])];
          if (next.some((item) => item.deviceId === found.deviceId)) return;
          next.push(found);
          const selectedIds = [...(this.data.selectedIds || []), found.deviceId];
          this.syncSelectionState(next, selectedIds);
          this.setData({
            statusText: `已发现 ${next.length} 台，继续搜索中...`,
          });
        },
        (result) => {
          const devices = (result && result.devices) || this.data.scannedDevices || [];
          const selectedIds =
            this.data.selectedIds && this.data.selectedIds.length
              ? this.data.selectedIds
              : devices.map((item) => item.deviceId);
          this.syncSelectionState(devices, selectedIds);
          this.setData({
            scanning: false,
            statusText: devices.length
              ? `扫描完成，共 ${devices.length} 台，可勾选后分配`
              : '未发现设备，请靠近测距仪后重试',
          });
        },
        { scanMs: 10000 }
      );
    },

    async assignCodes(codes) {
      const enterpriseId = this.data.selectedEnterpriseId;
      if (!enterpriseId) {
        wx.showToast({ title: '请选择归属企业', icon: 'none' });
        return false;
      }
      if (!codes.length) {
        wx.showToast({ title: '请先勾选设备', icon: 'none' });
        return false;
      }
      this.setData({ assigning: true });
      try {
        const result = await api.request('/miniprogram/devices', 'POST', {
          enterpriseId,
          description: this.data.description || undefined,
          devices: codes.map((code) => ({ code })),
        });
        if (!result.success) {
          throw new Error(result.error || '分配失败');
        }
        const count =
          (result.data && result.data.assignedCount) ||
          codes.length;
        wx.showToast({ title: `已分配 ${count} 台`, icon: 'success' });
        this.setData({ description: '' });
        const remain = (this.data.scannedDevices || []).filter(
          (item) => !codes.includes(item.deviceId)
        );
        this.syncSelectionState(remain, []);
        await this.load();
        return true;
      } catch (error) {
        wx.showToast({
          title: error instanceof Error ? error.message : '分配失败',
          icon: 'none',
        });
        return false;
      } finally {
        this.setData({ assigning: false });
      }
    },

    onAssignSelected() {
      if (this.data.assigning || this.data.scanning) return;
      return this.assignCodes([...(this.data.selectedIds || [])]);
    },

    onAssignAll() {
      if (this.data.assigning || this.data.scanning) return;
      const codes = (this.data.scannedDevices || []).map((item) => item.deviceId);
      return this.assignCodes(codes);
    },
  },
});
