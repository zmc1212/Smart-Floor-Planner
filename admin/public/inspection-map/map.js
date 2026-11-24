(() => {
  const endpoint = new URL('../api/miniprogram/construction/inspection/map', location.href).href;
  const ticket = new URLSearchParams(location.hash.slice(1)).get('ticket');
  history.replaceState(null, '', location.pathname + location.search);
  const byId = id => document.getElementById(id);
  const status = byId('status'), plan = byId('plan'), choose = byId('choose'), onMap = byId('map');
  const messages = {
    Unauthorized: '本次地图会话已结束，请回到巡检页重新打开。',
    construction_forbidden: '当前账号的工地权限已变化，请回到巡检页。',
    inspection_pin_missing: '有工地缺少已确认点位，请回巡检页补位置。',
    inspection_map_quota: '今日可用的驾车算路额度已用完。工地待办仍可查看。',
    inspection_map_unconfigured: '天地图驾车服务还未启用。',
    inspection_route_unavailable: '暂时无法取得预计车程，请稍后重试。',
    inspection_route_changed: '工地位置或待办有变化，请按当前清单重新规划。',
  };
  const selected = new Set();
  let origin = null, originName = '', stops = [], first = null, map = null, route = null, picking = false;
  let busy = false, snapshot = null, accessLost = false, refreshing = false;

  async function request(body, requestId) {
    const response = await fetch(endpoint, { method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit',
      headers: { Authorization: 'Bearer ' + ticket, ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(requestId ? { 'X-Inspection-Request-Id': requestId } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (requestId && [502, 504].includes(response.status)) {
      throw Object.assign(new Error('inspection_route_unavailable'), { gatewayInterrupted: true });
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) throw Object.assign(new Error(result.error), { status: response.status });
    return result.data;
  }
  async function requestRoute(body) {
    const requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    const until = Date.now() + 150000;
    while (!accessLost && Date.now() < until) {
      try {
        const result = await request(body, requestId);
        if (result) return result;
      } catch (error) {
        if (!error.gatewayInterrupted && !(error instanceof TypeError)) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error('inspection_route_unavailable');
  }
  function clearRoute() {
    route = null;
    byId('result').hidden = true;
    byId('ordered').replaceChildren();
  }
  const lngLat = point => new T.LngLat(point.longitude, point.latitude);
  function paintMap(fit = false) {
    if (!map) return;
    map.clearOverLays();
    const points = [];
    if (origin) {
      const start = lngLat(origin);
      map.addOverLay(new T.Label({ position: start, text: '起点', offset: new T.Point(0, 0) }));
      points.push(start);
    }
    for (const [index, stop] of (route?.stops || stops.filter(stop => stop.pin)).entries()) {
      const position = lngLat(stop.pin);
      map.addOverLay(new T.Marker(position));
      map.addOverLay(new T.Label({ position, text: String(index + 1), offset: new T.Point(14, -20) }));
      points.push(position);
      if (route && stop.points?.length > 1 && stop.seconds > 0) {
        const leg = stop.points.map(lngLat);
        map.addOverLay(new T.Polyline(leg, { color: '#08674d', weight: 5, opacity: 0.9 }));
      }
    }
    if (fit && points.length > 1) map.setViewport(points);
    else if (fit && points.length === 1) map.centerAndZoom(points[0], 15);
  }
  function change() {
    status.textContent = '';
    clearRoute();
    render();
    paintMap();
  }
  function setOrigin(point, label) {
    origin = point; originName = label; picking = false;
    change(); paintMap(true);
  }
  function todoButton(projectId) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = '查看待办';
    button.addEventListener('click', () => window.wx?.miniProgram?.navigateTo({
      url: '/packages/construction/inspection/inspection?projectId=' + encodeURIComponent(projectId),
    }));
    return button;
  }
  function render() {
    byId('origin').textContent = picking ? '点按地图选择巡检起点' : originName || '请选择巡检起点';
    choose.hidden = !map;
    choose.disabled = busy;
    choose.textContent = picking ? '取消选点' : '地图选起点';
    plan.disabled = busy || !origin || !selected.size || accessLost;
    const list = byId('choices');
    list.replaceChildren();
    for (const stop of stops) {
      const row = document.createElement('div'), label = document.createElement('label');
      row.className = 'station';
      if (stop.pin) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox'; checkbox.checked = selected.has(stop.projectId); checkbox.disabled = busy;
        checkbox.addEventListener('change', () => {
          if (checkbox.checked && selected.size === 8) {
            checkbox.checked = false;
            status.textContent = '每次最多选择 8 个工地。';
            return;
          }
          if (checkbox.checked) selected.add(stop.projectId);
          else { selected.delete(stop.projectId); if (first === stop.projectId) first = null; }
          change();
        });
        label.append(checkbox);
      }
      const name = document.createElement('span');
      name.textContent = stop.name + ' · ' + stop.recordIds.length + ' 项' + (stop.pin ? '' : ' · 待补位置');
      if (stop.pin && !map) {
        const point = document.createElement('small');
        point.textContent = '经度 ' + stop.pin.longitude.toFixed(5) + ' · 纬度 ' + stop.pin.latitude.toFixed(5);
        name.append(point);
      }
      label.append(name);
      const actions = document.createElement('div');
      actions.className = 'station-actions';
      actions.append(todoButton(stop.projectId));
      row.append(label, actions);
      if (stop.pin && selected.has(stop.projectId)) {
        const priority = document.createElement('button');
        priority.type = 'button'; priority.disabled = busy;
        priority.setAttribute('aria-pressed', String(first === stop.projectId));
        priority.textContent = first === stop.projectId ? '优先到访' : '先去这里';
        priority.addEventListener('click', () => { first = first === stop.projectId ? null : stop.projectId; change(); });
        actions.append(priority);
      }
      list.append(row);
    }
  }
  function mapUnavailable() {
    onMap.hidden = true;
    byId('map-message').textContent = '地图底图暂不可用。可查看工地清单，或选择已确认的工地作为起点。';
    byId('site-origin')?.remove();
    const select = document.createElement('select');
    select.id = 'site-origin';
    select.setAttribute('aria-label', '选择工地起点');
    select.add(new Option('选择工地起点', ''));
    stops.filter(stop => stop.pin).forEach(stop => select.add(new Option(stop.name, stop.projectId)));
    select.addEventListener('change', () => {
      const stop = stops.find(item => item.projectId === select.value && item.pin);
      if (!busy && stop) setOrigin(stop.pin, stop.name + '出发');
    });
    byId('origin').after(select);
  }
  function showMap(key) {
    if (!key) { mapUnavailable(); return; }
    const script = document.createElement('script');
    script.src = 'https://api.tianditu.gov.cn/api?v=4.0&tk=' + encodeURIComponent(key);
    script.onerror = () => { if (!accessLost) mapUnavailable(); };
    script.onload = () => {
      if (accessLost) return;
      try {
        onMap.hidden = false;
        map = new T.Map('map');
        const start = origin || stops.find(stop => stop.pin)?.pin;
        map.centerAndZoom(lngLat(start || { longitude: 104.1954, latitude: 35.8617 }), start ? 13 : 4);
        map.addEventListener('click', event => {
          if (picking && !busy && event.lnglat) setOrigin({ latitude: event.lnglat.lat, longitude: event.lnglat.lng }, '从地图所选位置出发');
        });
        paintMap(true);
        render();
      } catch { map = null; mapUnavailable(); }
    };
    document.head.append(script);
  }
  function failure(error) {
    if ([401, 403, 404].includes(error.status)) {
      accessLost = true; stops = []; origin = null; originName = ''; map = null;
      selected.clear(); clearRoute(); render();
      onMap.hidden = true;
      byId('site-origin')?.remove();
    }
    status.textContent = messages[error.message] || '巡检地图暂不可用，请重试。';
  }
  async function refresh() {
    if (accessLost || refreshing || !ticket) return;
    refreshing = true;
    try {
      const data = await request(), next = JSON.stringify(data.stops), initial = snapshot === null;
      if (next === snapshot) return;
      snapshot = next;
      stops = data.stops;
      for (const project of selected) if (!stops.some(stop => stop.projectId === project && stop.pin)) selected.delete(project);
      if (first && !selected.has(first)) first = null;
      if (initial) {
        origin = data.origin;
        originName = origin ? '从当前位置出发' : '';
        stops.filter(stop => stop.pin).slice(0, 8).forEach(stop => selected.add(stop.projectId));
      }
      clearRoute(); render(); paintMap(true);
      if (initial) showMap(data.browserKey);
      else if (!map) mapUnavailable();
      status.textContent = stops.length ? (initial ? '' : messages.inspection_route_changed) : '目前没有待到场的工地。';
    } catch (error) { failure(error); }
    finally { refreshing = false; }
  }
  choose.addEventListener('click', () => { picking = !picking; render(); });
  plan.addEventListener('click', async () => {
    if (plan.disabled) return;
    const version = snapshot;
    busy = true; clearRoute(); render();
    status.textContent = '正在比较各工地间的驾车时间…';
    try {
      const result = await requestRoute({ projectIds: [...selected], firstProjectId: first,
        origin: { latitude: origin.latitude, longitude: origin.longitude, coordinateSystem: 'wgs84' } });
      if (accessLost || version !== snapshot) return;
      route = result;
      byId('estimate').textContent = '预计驾车 ' + Math.ceil(route.seconds / 60) + ' 分钟';
      for (const stop of route.stops) {
        const row = document.createElement('li');
        row.textContent = stop.name + ' · 本段 ' + Math.ceil(stop.seconds / 60) + ' 分钟 · ' + stop.recordIds.length + ' 项';
        row.append(todoButton(stop.projectId));
        byId('ordered').append(row);
      }
      byId('result').hidden = false;
      status.textContent = '';
      paintMap(true);
    } catch (error) {
      failure(error);
      if (error.message === 'inspection_route_changed') await refresh();
    } finally { busy = false; render(); }
  });
  if (ticket) {
    void refresh();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
    setInterval(() => { if (!document.hidden && !busy) void refresh(); }, 30000);
  } else { failure(Object.assign(new Error('Unauthorized'), { status: 401 })); }
})();
