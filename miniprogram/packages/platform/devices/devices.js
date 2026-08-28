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

const api = require('../../../utils/api.js');
const bluetooth = require('../../../utils/bluetooth.js');

function withSelection(scannedDevices, selectedIds) {
  const selected = new Set(selectedIds || []);
  return (scannedDevices || []).map((item) => ({
    ...item,
    checked: selected.has(item.deviceId),
  }));
}

const ALL_ENTERPRISES_LABEL = '全部企业';

function buildListEnterpriseNames(enterprises) {
  return [
    ALL_ENTERPRISES_LABEL,
    ...(enterprises || []).map((item) => item.name || item.code || item._id),
  ];
}

Page({
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
    listEnterpriseNames: [ALL_ENTERPRISES_LABEL],
    listEnterpriseIndex: 0,
    listEnterpriseId: '',
    scanning: false,
    assigning: false,
    scannedDevices: [],
    selectedIds: [],
    selectedCount: 0,
    allSelected: false,
    statusText: '待扫描附近 LDMStudio 4D',
    description: '',
    serialNumber: '',
  },

  onLoad() {
    this.setData(navigationMetrics());
    this.load();
  },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
    if (tabBar && typeof tabBar.syncSelected === 'function') {
      tabBar.syncSelected();
    }
  },

  onUnload() {
    if (this.data.scanning) {
      bluetooth.cancelBLEEnrollmentScan();
    }
  },

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

  async load(requestedListEnterpriseId) {
    const listEnterpriseId =
      typeof requestedListEnterpriseId === 'string'
        ? requestedListEnterpriseId
        : String(this.data.listEnterpriseId || '');
    this.setData({ loading: true, error: '' });
    try {
      const query = listEnterpriseId
        ? `?enterpriseId=${encodeURIComponent(listEnterpriseId)}`
        : '';
      const result = await api.request(`/miniprogram/devices${query}`, 'GET');
      if (!result.success) {
        throw new Error(result.error || '设备列表加载失败');
      }
      const enterprises = (result.data && result.data.enterprises) || [];
      const devices = (result.data && result.data.devices) || [];
      const enterpriseNames = enterprises.map(
        (item) => item.name || item.code || item._id
      );
      const listEnterpriseNames = buildListEnterpriseNames(enterprises);
      const retainedAssignId = String(this.data.selectedEnterpriseId || '');
      const selectedEnterpriseId = enterprises.some(
        (item) => item._id === retainedAssignId
      )
        ? retainedAssignId
        : (enterprises[0] && enterprises[0]._id) || '';
      const enterpriseIndex = Math.max(
        0,
        enterprises.findIndex((item) => item._id === selectedEnterpriseId)
      );
      const listEnterpriseIdNext =
        listEnterpriseId &&
        enterprises.some((item) => item._id === listEnterpriseId)
          ? listEnterpriseId
          : '';
      const listEnterpriseIndex = listEnterpriseIdNext
        ? Math.max(
            1,
            enterprises.findIndex((item) => item._id === listEnterpriseIdNext) + 1
          )
        : 0;
      this.setData({
        loading: false,
        devices,
        enterprises,
        enterpriseNames,
        enterpriseIndex: enterpriseIndex >= 0 ? enterpriseIndex : 0,
        selectedEnterpriseId,
        listEnterpriseNames,
        listEnterpriseIndex,
        listEnterpriseId: listEnterpriseIdNext,
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

  onListEnterpriseChange(event) {
    const index = Number(event.detail.value || 0);
    const enterprise = index > 0 ? this.data.enterprises[index - 1] : null;
    const listEnterpriseId = enterprise ? enterprise._id : '';
    this.setData({
      listEnterpriseIndex: index,
      listEnterpriseId,
      devices: [],
    });
    void this.load(listEnterpriseId);
  },

  onDescriptionInput(event) {
    this.setData({ description: event.detail.value || '' });
  },

  onSerialNumberInput(event) {
    this.setData({ serialNumber: event.detail.value || '' });
  },

  onDeviceSerialInput(event) {
    const deviceId = String(event.currentTarget.dataset.id || '');
    if (!deviceId) return;
    const serialNumber = event.detail.value || '';
    const scannedDevices = (this.data.scannedDevices || []).map((item) =>
      item.deviceId === deviceId ? { ...item, serialNumber } : item
    );
    this.setData({ scannedDevices });
  },

  onStopTap() {},

  onCancelScan() {
    if (!this.data.scanning) return;
    bluetooth.cancelBLEEnrollmentScan();
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
        next.push({ ...found, serialNumber: '' });
        const selectedIds = [...(this.data.selectedIds || []), found.deviceId];
        this.syncSelectionState(next, selectedIds);
        this.setData({
          statusText: `已发现 ${next.length} 台，继续搜索中...`,
        });
      },
      (result) => {
        const incoming = (result && result.devices) || this.data.scannedDevices || [];
        const existingById = new Map(
          (this.data.scannedDevices || []).map((item) => [item.deviceId, item])
        );
        const devices = incoming.map((item) => {
          const existing = existingById.get(item.deviceId);
          return {
            ...item,
            serialNumber:
              (existing && existing.serialNumber) || item.serialNumber || '',
          };
        });
        const selectedIds =
          this.data.selectedIds && this.data.selectedIds.length
            ? this.data.selectedIds
            : devices.map((item) => item.deviceId);
        this.syncSelectionState(devices, selectedIds);
        const reason = result && result.reason;
        const error = result && result.error;
        this.setData({
          scanning: false,
          statusText: reason === 'cancelled'
            ? devices.length
              ? `已停止搜索，已发现 ${devices.length} 台，可勾选后分配`
              : '已停止搜索，尚未发现设备'
            : error === 'bluetooth_off' || reason === 'bluetooth_off'
              ? '蓝牙未开启，请开启后重试'
              : error === 'permission_denied' || reason === 'permission_denied'
                ? '蓝牙或定位权限不足，请开启后重试'
                : devices.length
            ? `扫描完成，共 ${devices.length} 台，可勾选后分配`
            : '未发现设备，请靠近测距仪后重试',
        });
      },
      // Do not use wx.showLoading({ mask: true }): the page must keep its
      // cancel control available throughout platform enrollment scanning.
      { scanMs: 10000, silent: true }
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
    const scannedById = new Map(
      (this.data.scannedDevices || []).map((item) => [item.deviceId, item])
    );
    const sharedSerialNumber = String(this.data.serialNumber || '').trim();
    if (codes.length > 1 && sharedSerialNumber) {
      const missingOwnSn = codes.some((code) => {
        const item = scannedById.get(code);
        return !String((item && item.serialNumber) || '').trim();
      });
      if (missingOwnSn) {
        wx.showToast({
          title: '多台设备请分别填写 SN，或清空共用 SN',
          icon: 'none',
        });
        return false;
      }
    }
    this.setData({ assigning: true });
    try {
      const result = await api.request('/miniprogram/devices', 'POST', {
        enterpriseId,
        description: this.data.description || undefined,
        serialNumber: codes.length === 1 ? sharedSerialNumber || undefined : undefined,
        devices: codes.map((code) => {
          const item = scannedById.get(code);
          const serialNumber = String((item && item.serialNumber) || '').trim();
          return {
            code,
            serialNumber: serialNumber || undefined,
          };
        }),
      });
      if (!result.success) {
        throw new Error(result.error || '分配失败');
      }
      const count =
        (result.data && result.data.assignedCount) ||
        codes.length;
      wx.showToast({ title: `已分配 ${count} 台`, icon: 'success' });
      this.setData({ description: '', serialNumber: '' });
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
});
