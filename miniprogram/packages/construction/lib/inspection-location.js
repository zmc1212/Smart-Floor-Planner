const api = require('../../../utils/api');

function readInspectionFix() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('inspection_location_unavailable')), 10000);
    wx.getLocation({ type: 'wgs84', isHighAccuracy: true, highAccuracyExpireTime: 5000,
      success(result) {
        clearTimeout(timer);
        const { latitude, longitude, horizontalAccuracy, accuracy } = result;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) { reject(Error('inspection_location_unavailable')); return; }
        resolve({ point: { latitude, longitude, coordinateSystem: 'wgs84' },
          accuracy: horizontalAccuracy > 0 ? horizontalAccuracy : accuracy });
      },
      fail() { clearTimeout(timer); reject(Error('inspection_location_unavailable')); },
    });
  });
}

async function confirmInspectionPin(stop, current) {
  const confirmed = await new Promise(resolve => wx.showModal({
    title: '确认工地入口', content: '请站在工地入口，用当前位置保存巡检点位。',
    confirmText: '确认位置', success: result => resolve(result.confirm), fail: () => resolve(false),
  }));
  if (!confirmed || !current()) return false;
  const fix = await readInspectionFix();
  if (!current()) return false;
  await api.request('/miniprogram/construction/inspection/projects/' + stop.projectId + '/pin', 'POST',
    { ...fix, name: '工地入口', expectedVersion: stop.projectVersion }, { suppressUnauthorized: true });
  return true;
}

module.exports = { readInspectionFix, confirmInspectionPin };
