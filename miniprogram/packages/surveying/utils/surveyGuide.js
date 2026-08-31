function createGuide(key, title, body, target, extra) {
  return Object.assign({
    key,
    title,
    body,
    target,
    showCharacter: true,
    dynamicCursorLabel: false
  }, extra || {});
}

function hasCloseCandidate(session) {
  return !!(
    session &&
    (session.closeCandidateNodeId || session.closeCandidatePoint)
  );
}

function resolveCursorDropBody(input) {
  const label = input.cursorSnapLabel || '';
  if (input.cursorPlacementState !== 'dragging' || !label) {
    return '拖动底部光标到已有顶点或墙边可共墙续画，也可放到空白处新建墙链。';
  }
  return `${label}，松手确定下一空间起点。`;
}

function resolveSurveyGuide(input) {
  const opts = input || {};
  if (!opts.guideEnabled) return null;

  if (opts.completed) {
    return createGuide(
      'completed',
      '量房已完成',
      '点击“完成”提交本次正式量房。',
      'finish'
    );
  }

  if (opts.numberPadVisible || opts.componentEditorVisible || opts.angleMeasureVisible) {
    return null;
  }

  const floor = opts.floor || {};
  const session = opts.session || floor.session || {};
  const walls = Array.isArray(floor.walls) ? floor.walls : [];
  const state = session.state || 'idle';
  const closeCandidate = hasCloseCandidate(session);

  if (
    state === 'closing' ||
    state === 'mergeClosing' ||
    (closeCandidate && (state === 'wallPreview' || state === 'awaitingLength'))
  ) {
    return createGuide(
      'close-space',
      '闭合当前空间',
      '预览已吸附到闭合点时可直接松手闭合；否则确认闭合线后点击「合」即可闭合当前空间。',
      'close'
    );
  }

  if (state === 'wallPreview') {
    return createGuide(
      'confirm-direction',
      '确认墙体方向',
      session.mode === 'diagonal'
        ? '沿斜墙实际方向继续拖动，松手确认。'
        : '沿实际墙体方向继续拖动，松手确认。',
      'preview'
    );
  }

  if (state === 'awaitingLength' || state === 'remeasureAwaitingInput') {
    const body = opts.bleConnected
      ? '点击“测距”读取设备，或在右侧输入。'
      : '点击“测距”连接设备，或在右侧输入。';
    return createGuide(
      state === 'remeasureAwaitingInput' ? 'remeasure-length' : 'confirm-length',
      state === 'remeasureAwaitingInput' ? '录入复尺长度' : '录入这面墙的实测长度',
      body,
      'measure'
    );
  }

  if (opts.canSetInitialMeasurementSide) {
    return createGuide(
      'confirm-measure-side',
      '确认测量位置',
      '红线要与测距仪所在墙面一致，点箭头切换。',
      'measure-side'
    );
  }

  if (
    opts.cursorPlacementState === 'dragging' ||
    opts.cursorPlacementState === 'awaitingWallDrop' ||
    state === 'wallSnapPending'
  ) {
    return createGuide(
      'place-next-start',
      '放置下一空间起点',
      resolveCursorDropBody(opts),
      'dock-cursor',
      { dynamicCursorLabel: opts.cursorPlacementState === 'dragging' }
    );
  }

  if (state === 'wallSelected' && session.selectedOpeningId) {
    return createGuide(
      'edit-opening',
      '完善门窗信息',
      '核对门窗规格后收起，继续量房。',
      'object'
    );
  }

  if (state === 'wallSelected' && session.selectedWallId) {
    return createGuide(
      'edit-wall',
      '补充墙体信息',
      '可添门、添窗、复尺或调整墙厚。',
      'object'
    );
  }

  if (state === 'spaceClosed') {
    return createGuide(
      'room-closed',
      '检查并继续量房',
      '拖动底部光标，开始下一空间量房。',
      'dock-cursor'
    );
  }

  if ((state === 'idle' || state === 'cursorPlaced') && !walls.length) {
    if (opts.bleInputMode) {
      return createGuide(
        'ble-first-wall',
        '开启输入模式',
        '点选方向箭头锁定第一面墙，再用测距仪读数落墙。',
        'cursor'
      );
    }
    return createGuide(
      'first-wall',
      '拉出第一面墙',
      '从画布光标沿第一面墙方向拖动。',
      'cursor'
    );
  }

  if (state === 'cursorPlaced' || state === 'wallCommitted') {
    if (opts.bleInputMode) {
      if (opts.bleDirectionMode === 'auto') {
        return createGuide(
          'ble-auto-direction',
          '朝向选方向',
          '转动手机对准要量的墙，超过阈值后自动锁定方向。',
          'cursor'
        );
      }
      return createGuide(
        'ble-manual-direction',
        '点选方向',
        '点选光标旁的方向箭头，再用测距仪读数落墙。',
        'cursor'
      );
    }
    return createGuide(
      'next-wall',
      '继续下一面墙',
      '从当前端点沿下一面墙方向继续拖动。',
      'cursor'
    );
  }

  return null;
}

function rectOverlapArea(first, second) {
  if (!first || !second) return 0;
  const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
  const height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
  return width * height;
}

function expandRect(rect, padding) {
  const gap = Number(padding) || 0;
  return {
    left: rect.left - gap,
    right: rect.right + gap,
    top: rect.top - gap,
    bottom: rect.bottom + gap
  };
}

function rectArea(rect) {
  return Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top);
}

function pointInRect(point, rect) {
  return !!point && !!rect &&
    point.x >= rect.left && point.x <= rect.right &&
    point.y >= rect.top && point.y <= rect.bottom;
}

function rectInside(rect, bounds) {
  return rect.left >= bounds.left && rect.right <= bounds.right &&
    rect.top >= bounds.top && rect.bottom <= bounds.bottom;
}

function createRect(left, top, width, height) {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height
  };
}

function scoreGuideBox(rect, obstacles) {
  const area = Math.max(1, rectArea(rect));
  return (obstacles || []).reduce((result, obstacle) => {
    if (result.invalid || !obstacle) return result;
    const collisionRect = expandRect(obstacle, obstacle.padding || 0);
    const overlap = rectOverlapArea(rect, collisionRect);
    if (!overlap) return result;
    if (obstacle.hard) {
      return { invalid: true, score: Number.POSITIVE_INFINITY };
    }
    return {
      invalid: false,
      score: result.score + overlap / area * (Number(obstacle.weight) || 100)
    };
  }, { invalid: false, score: 0 });
}

function uniquePositions(items) {
  const seen = {};
  return items.filter((item) => {
    const key = `${Math.round(item.left * 10)}:${Math.round(item.top * 10)}`;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function buildGuideCardCandidates(input) {
  const opts = input || {};
  const target = opts.target;
  const safeArea = opts.safeArea;
  const width = Number(opts.cardWidth) || 0;
  const height = Number(opts.cardHeight) || 0;
  const gap = Number(opts.gap) || 24;
  const clampValue = (value, min, max) => Math.max(min, Math.min(max, value));
  const maxLeft = Math.max(safeArea.left, safeArea.right - width);
  const maxTop = Math.max(safeArea.top, safeArea.bottom - height);
  const horizontal = [
    target.x - width / 2,
    target.x - width * 0.28,
    target.x - width * 0.72,
    safeArea.left,
    maxLeft
  ].map((value) => clampValue(value, safeArea.left, maxLeft));
  const gaps = [gap, Math.max(24, gap * 0.72)];
  const vertical = [];
  gaps.forEach((candidateGap) => {
    vertical.push(target.y - height - candidateGap);
    vertical.push(target.y + candidateGap);
  });

  const previous = opts.previousLayout && opts.previousLayout.card;
  const positions = [];
  if (previous) {
    positions.push({
      left: clampValue(previous.left, safeArea.left, maxLeft),
      top: clampValue(previous.top, safeArea.top, maxTop),
      previous: true
    });
  }
  vertical.forEach((top) => {
    horizontal.forEach((left) => {
      positions.push({
        left,
        top: clampValue(top, safeArea.top, maxTop),
        previous: false
      });
    });
  });
  return uniquePositions(positions).map((position) => Object.assign(
    createRect(position.left, position.top, width, height),
    { previous: position.previous }
  ));
}

function resolveCharacterPose(box, target) {
  const centerX = box.left + box.width / 2;
  const targetBelow = target.y >= box.bottom + box.height * 0.12;
  const nearlyCentered = Math.abs(target.x - centerX) <= box.width * 0.45;
  if (targetBelow && nearlyCentered) return 'down';
  return target.x >= centerX ? 'right' : 'left';
}

function createGuideCharacter(box, target) {
  let pose = resolveCharacterPose(box, target);
  const offsets = {
    left: { x: 0.03, y: 0.47 },
    right: { x: 0.97, y: 0.47 },
    down: { x: 0.12, y: 0.62 }
  };
  let hand = offsets[pose];
  let handX = box.left + box.width * hand.x;
  if ((pose === 'right' && handX > target.x) || (pose === 'left' && handX < target.x)) {
    pose = pose === 'right' ? 'left' : 'right';
    hand = offsets[pose];
    handX = box.left + box.width * hand.x;
  }
  const handY = box.top + box.height * hand.y;
  const dx = target.x - handX;
  const dy = target.y - handY;
  const distance = Math.hypot(dx, dy);
  const targetInset = Math.min(12, Math.max(4, distance * 0.1));
  return {
    pose,
    left: box.left,
    top: box.top,
    size: box.width,
    pathLeft: handX,
    pathTop: handY,
    pathLength: Math.max(0, distance - targetInset),
    pathWidth: Math.max(1, Math.abs(dx)),
    pathHeight: Math.max(1, Math.abs(dy)),
    pathDirection: `${dy >= 0 ? 'down' : 'up'}-${dx >= 0 ? 'right' : 'left'}`,
    handX,
    handY,
    haloLeft: target.x - 24,
    haloTop: target.y - 24
  };
}

function buildGuideCharacterCandidates(card, target, safeArea, characterSize, previousLayout) {
  const size = Number(characterSize) || 0;
  const gap = Math.max(7, size * 0.11);
  const sideTop = card.top + card.height - size * 0.58;
  const top = card.top - size - gap;
  const bottom = card.bottom + gap;
  const positions = [
    { left: card.left - size - gap, top: sideTop },
    { left: card.right + gap, top: sideTop },
    { left: card.left, top },
    { left: card.right - size, top },
    { left: card.left, top: bottom },
    { left: card.right - size, top: bottom }
  ];
  if (previousLayout && previousLayout.character) {
    positions.unshift({
      left: previousLayout.character.left,
      top: previousLayout.character.top,
      previous: true
    });
  }

  return uniquePositions(positions).map((position) => {
    const box = createRect(position.left, position.top, size, size);
    if (!rectInside(box, safeArea)) return null;
    if (rectOverlapArea(expandRect(card, gap), box)) return null;
    return {
      box,
      character: createGuideCharacter(box, target),
      previous: !!position.previous
    };
  }).filter(Boolean);
}

function cubicPoint(start, controlOne, controlTwo, end, t) {
  const inverse = 1 - t;
  const inverse2 = inverse * inverse;
  const t2 = t * t;
  return {
    x: inverse2 * inverse * start.x + 3 * inverse2 * t * controlOne.x +
      3 * inverse * t2 * controlTwo.x + t2 * t * end.x,
    y: inverse2 * inverse * start.y + 3 * inverse2 * t * controlOne.y +
      3 * inverse * t2 * controlTwo.y + t2 * t * end.y
  };
}

function scoreConnectorPoints(points, obstacles) {
  let hardHits = 0;
  let score = 0;
  let length = 0;
  (points || []).forEach((point, index) => {
    if (index > 0) {
      length += Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y);
    }
    (obstacles || []).forEach((obstacle) => {
      if (!obstacle || !pointInRect(point, expandRect(obstacle, obstacle.pathPadding || 0))) return;
      if (obstacle.pathHard) hardHits += 1;
      const explicitPathWeight = Number(obstacle.pathWeight);
      score += Number.isFinite(explicitPathWeight)
        ? explicitPathWeight
        : (Number(obstacle.weight) || 100);
    });
  });
  return { hardHits, score, length };
}

function buildCubicConnector(start, target, obstacles) {
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const normal = { x: -dy / distance, y: dx / distance };
  const bend = Math.max(24, Math.min(76, distance * 0.28));
  const candidates = [0, bend, -bend, bend * 1.65, -bend * 1.65].map((offset) => ({
    controlOne: {
      x: start.x + dx * 0.34 + normal.x * offset,
      y: start.y + dy * 0.34 + normal.y * offset
    },
    controlTwo: {
      x: start.x + dx * 0.68 + normal.x * offset,
      y: start.y + dy * 0.68 + normal.y * offset
    }
  }));
  candidates.push(
    {
      controlOne: { x: start.x + dx * 0.62, y: start.y },
      controlTwo: { x: target.x, y: target.y - dy * 0.38 }
    },
    {
      controlOne: { x: start.x, y: start.y + dy * 0.62 },
      controlTwo: { x: target.x - dx * 0.38, y: target.y }
    }
  );

  return candidates.map((candidate) => {
    const sampleCount = Math.max(18, Math.ceil(distance / 6));
    const points = [];
    for (let index = 0; index <= sampleCount; index += 1) {
      points.push(cubicPoint(start, candidate.controlOne, candidate.controlTwo, target, index / sampleCount));
    }
    const result = scoreConnectorPoints(points.slice(1, -1), obstacles);
    return Object.assign({
      type: 'cubic',
      start,
      target,
      points,
      arrowFrom: points[points.length - 2]
    }, candidate, result);
  }).sort((first, second) => (
    first.hardHits - second.hardHits || first.score - second.score || first.length - second.length
  ))[0];
}

function buildDirectGuideConnector(start, target) {
  if (!start || !target) return null;
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 1) return null;

  return {
    type: 'cubic',
    start: { x: start.x, y: start.y },
    target: { x: target.x, y: target.y },
    controlOne: {
      x: start.x + dx / 3,
      y: start.y + dy / 3
    },
    controlTwo: {
      x: start.x + dx * 2 / 3,
      y: start.y + dy * 2 / 3
    },
    arrowFrom: {
      x: start.x + dx * 0.9,
      y: start.y + dy * 0.9
    },
    hardHits: 0,
    score: 0,
    length
  };
}

function simplifyGridRoute(points) {
  if (!points || points.length <= 2) return points || [];
  const result = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = result[result.length - 1];
    const current = points[index];
    const next = points[index + 1];
    const firstDx = Math.sign(current.x - previous.x);
    const firstDy = Math.sign(current.y - previous.y);
    const secondDx = Math.sign(next.x - current.x);
    const secondDy = Math.sign(next.y - current.y);
    if (firstDx !== secondDx || firstDy !== secondDy) result.push(current);
  }
  result.push(points[points.length - 1]);
  return result;
}

function quadraticPoint(start, control, end, t) {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
    y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y
  };
}

function sampleRoundedRoute(points) {
  if (!points || points.length < 2) return points || [];
  const samples = [points[0]];
  let cursor = points[0];
  for (let index = 1; index < points.length - 1; index += 1) {
    const control = points[index];
    const next = points[index + 1];
    const midpoint = { x: (control.x + next.x) / 2, y: (control.y + next.y) / 2 };
    const segmentLength = Math.hypot(midpoint.x - cursor.x, midpoint.y - cursor.y);
    const count = Math.max(3, Math.ceil(segmentLength / 5));
    for (let sample = 1; sample <= count; sample += 1) {
      samples.push(quadraticPoint(cursor, control, midpoint, sample / count));
    }
    cursor = midpoint;
  }
  const end = points[points.length - 1];
  const finalLength = Math.hypot(end.x - cursor.x, end.y - cursor.y);
  const finalCount = Math.max(2, Math.ceil(finalLength / 5));
  for (let sample = 1; sample <= finalCount; sample += 1) {
    samples.push({
      x: cursor.x + (end.x - cursor.x) * sample / finalCount,
      y: cursor.y + (end.y - cursor.y) * sample / finalCount
    });
  }
  return samples;
}

function findGridConnector(start, target, safeArea, obstacles) {
  const step = 12;
  const routeTarget = {
    x: Math.max(safeArea.left, Math.min(safeArea.right, target.x)),
    y: Math.max(safeArea.top, Math.min(safeArea.bottom, target.y))
  };
  const columns = Math.max(2, Math.floor((safeArea.right - safeArea.left) / step) + 1);
  const rows = Math.max(2, Math.floor((safeArea.bottom - safeArea.top) / step) + 1);
  const toCell = (point) => ({
    x: Math.max(0, Math.min(columns - 1, Math.round((point.x - safeArea.left) / step))),
    y: Math.max(0, Math.min(rows - 1, Math.round((point.y - safeArea.top) / step)))
  });
  const toPoint = (cell) => ({
    x: safeArea.left + cell.x * step,
    y: safeArea.top + cell.y * step
  });
  const startCell = toCell(start);
  const endCell = toCell(routeTarget);
  const keyOf = (cell) => `${cell.x}:${cell.y}`;
  const startKey = keyOf(startCell);
  const endKey = keyOf(endCell);
  const open = [{ cell: startCell, g: 0, f: 0 }];
  const cameFrom = {};
  const bestCost = { [startKey]: 0 };
  const closed = {};
  const directions = [
    { x: 1, y: 0, cost: 1 }, { x: -1, y: 0, cost: 1 },
    { x: 0, y: 1, cost: 1 }, { x: 0, y: -1, cost: 1 },
    { x: 1, y: 1, cost: 1.42 }, { x: 1, y: -1, cost: 1.42 },
    { x: -1, y: 1, cost: 1.42 }, { x: -1, y: -1, cost: 1.42 }
  ];
  let found = false;

  while (open.length) {
    open.sort((first, second) => first.f - second.f);
    const current = open.shift();
    const currentKey = keyOf(current.cell);
    if (closed[currentKey]) continue;
    closed[currentKey] = true;
    if (currentKey === endKey) {
      found = true;
      break;
    }

    directions.forEach((direction) => {
      const next = { x: current.cell.x + direction.x, y: current.cell.y + direction.y };
      if (next.x < 0 || next.x >= columns || next.y < 0 || next.y >= rows) return;
      const nextKey = keyOf(next);
      if (closed[nextKey]) return;
      const point = toPoint(next);
      let blocked = false;
      let obstacleCost = 0;
      (obstacles || []).forEach((obstacle) => {
        if (!pointInRect(point, expandRect(obstacle, (obstacle.pathPadding || 0) + step * 0.75))) return;
        if (obstacle.pathHard) blocked = true;
        const pathWeight = Number(obstacle.pathWeight);
        obstacleCost += (Number.isFinite(pathWeight) ? pathWeight : 0) / 80;
      });
      if (blocked && nextKey !== endKey) return;
      const tentative = current.g + direction.cost + obstacleCost;
      if (bestCost[nextKey] !== undefined && tentative >= bestCost[nextKey]) return;
      cameFrom[nextKey] = currentKey;
      bestCost[nextKey] = tentative;
      const heuristic = Math.hypot(endCell.x - next.x, endCell.y - next.y);
      open.push({ cell: next, g: tentative, f: tentative + heuristic });
    });
  }

  if (!found) return null;
  const cells = [];
  let cursor = endKey;
  while (cursor) {
    const parts = cursor.split(':');
    cells.push({ x: Number(parts[0]), y: Number(parts[1]) });
    if (cursor === startKey) break;
    cursor = cameFrom[cursor];
  }
  cells.reverse();
  const points = simplifyGridRoute([start].concat(cells.slice(1, -1).map(toPoint), [routeTarget, target]));
  const pathSamples = sampleRoundedRoute(points);
  const result = scoreConnectorPoints(pathSamples.slice(1, -1), obstacles);
  return Object.assign({
    type: 'polyline',
    start,
    target,
    points,
    pathSamples,
    arrowFrom: pathSamples[pathSamples.length - 2]
  }, result);
}

function softenGuideObstacles(obstacles) {
  return (obstacles || []).map((obstacle) => {
    if (!obstacle || (!obstacle.hard && !obstacle.pathHard)) return obstacle;
    return Object.assign({}, obstacle, {
      hard: false,
      pathHard: false,
      weight: Math.max(Number(obstacle.weight) || 100, Number(obstacle.pathWeight) || 0, 420),
      pathWeight: Math.max(Number(obstacle.pathWeight) || 0, 180)
    });
  });
}

function buildForcedDockGuideLayout(input) {
  const opts = input || {};
  const target = opts.target;
  const safeArea = opts.safeArea;
  const cardWidth = Number(opts.cardWidth) || 0;
  const cardHeight = Number(opts.cardHeight) || 0;
  const characterSize = Number(opts.characterSize) || 0;
  if (!target || !safeArea || !cardWidth || !cardHeight || !characterSize) return null;

  const clampValue = (value, min, max) => Math.max(min, Math.min(max, value));
  const gap = Math.max(7, characterSize * 0.11);
  const maxLeft = Math.max(safeArea.left, safeArea.right - cardWidth);
  const maxCharacterTop = Math.max(
    safeArea.top,
    Math.min(safeArea.bottom - characterSize, target.y - characterSize - 8)
  );
  const characterTop = clampValue(maxCharacterTop, safeArea.top, safeArea.bottom - characterSize);
  const preferredCardTop = characterTop - gap - cardHeight;
  const cardTop = clampValue(preferredCardTop, safeArea.top, Math.max(safeArea.top, preferredCardTop));
  const cardLeft = clampValue(safeArea.left, safeArea.left, maxLeft);
  const characterLeft = clampValue(cardLeft, safeArea.left, safeArea.right - characterSize);
  const card = createRect(cardLeft, cardTop, cardWidth, cardHeight);
  const characterBox = createRect(
    characterLeft,
    Math.max(card.bottom + gap, Math.min(characterTop, safeArea.bottom - characterSize)),
    characterSize,
    characterSize
  );
  if (!rectInside(card, safeArea) || !rectInside(characterBox, safeArea)) return null;

  const character = createGuideCharacter(characterBox, target);
  return {
    card: {
      left: card.left,
      top: card.top,
      width: cardWidth,
      height: cardHeight
    },
    placement: {
      left: card.left,
      top: card.top,
      pointerDirection: card.bottom <= target.y ? 'down' : 'up',
      pointerLeft: clampValue(target.x - card.left, 24, cardWidth - 24)
    },
    character,
    connector: buildDirectGuideConnector(
      { x: character.handX, y: character.handY },
      {
        x: target.x,
        y: target.y - Math.max(8, (target.height || 0) / 2)
      }
    )
  };
}

function solveGuideLayout(input) {
  const opts = input || {};
  const target = opts.target;
  const safeArea = opts.safeArea;
  const cardWidth = Number(opts.cardWidth) || 0;
  const cardHeight = Number(opts.cardHeight) || 0;
  const characterSize = Number(opts.characterSize) || 0;
  if (!target || !safeArea || !cardWidth || !cardHeight || !characterSize) return null;

  const targetRect = createRect(
    target.x - Math.max(24, (target.width || 0) / 2),
    target.y - Math.max(24, (target.height || 0) / 2),
    Math.max(48, target.width || 0),
    Math.max(48, target.height || 0)
  );
  const obstacles = (opts.obstacles || []).concat([Object.assign(targetRect, {
    hard: true,
    padding: 8,
    pathHard: false,
    pathWeight: 0,
    kind: 'guide-target'
  })]);
  const previous = opts.previousLayout || null;
  const cards = buildGuideCardCandidates(Object.assign({}, opts, { previousLayout: previous }));
  const candidates = [];

  cards.forEach((card) => {
    const cardScore = scoreGuideBox(card, obstacles);
    if (cardScore.invalid) return;
    const characters = buildGuideCharacterCandidates(card, target, safeArea, characterSize, previous);
    characters.forEach((entry) => {
      const characterScore = scoreGuideBox(entry.box, obstacles);
      if (characterScore.invalid) return;
      const start = { x: entry.character.handX, y: entry.character.handY };
      const pathObstacles = (opts.obstacles || []).concat([Object.assign({}, card, {
        pathHard: true,
        pathPadding: 4,
        pathWeight: 1200,
        kind: 'guide-card'
      })]);
      const connector = buildCubicConnector(start, target, pathObstacles);
      const movement = previous
        ? Math.abs(card.left - previous.card.left) + Math.abs(card.top - previous.card.top) +
          Math.abs(entry.character.left - previous.character.left) +
          Math.abs(entry.character.top - previous.character.top)
        : 0;
      const directionPenalty = card.bottom <= target.y || card.top >= target.y ? 0 : 10000;
      const characterDirectionPenalty = opts.preferCharacterBelowCard && entry.box.top < card.bottom
        ? 50000
        : 0;
      const score = cardScore.score + characterScore.score +
        connector.hardHits * 100000 + connector.score * 0.5 + connector.length * 0.02 +
        movement * 0.08 + directionPenalty + characterDirectionPenalty +
        (card.previous && entry.previous ? -18 : 0);
      candidates.push({ card, character: entry.character, connector, score, pathObstacles });
    });
  });

  candidates.sort((first, second) => first.score - second.score);
  const selected = candidates[0];
  if (!selected) {
    // Closed-room dimension labels can fill the canvas so no hard-avoiding
    // placement remains. Reset-cursor / dock tips must still appear.
    if (opts.preferCharacterBelowCard && !opts.dockGuideFallback) {
      const softened = solveGuideLayout(Object.assign({}, opts, {
        obstacles: softenGuideObstacles(opts.obstacles),
        dockGuideFallback: 'soft'
      }));
      if (softened) return softened;
      return buildForcedDockGuideLayout(opts);
    }
    return null;
  }
  if (selected.connector.hardHits > 0) {
    const routed = findGridConnector(
      { x: selected.character.handX, y: selected.character.handY },
      target,
      safeArea,
      selected.pathObstacles
    );
    if (routed && routed.hardHits === 0) {
      selected.connector = routed;
    } else {
      selected.connector = null;
    }
  }

  const clampValue = (value, min, max) => Math.max(min, Math.min(max, value));
  const pointerDirection = selected.card.bottom <= target.y ? 'down' : 'up';
  return {
    card: {
      left: selected.card.left,
      top: selected.card.top,
      width: cardWidth,
      height: cardHeight
    },
    placement: {
      left: selected.card.left,
      top: selected.card.top,
      pointerDirection,
      pointerLeft: clampValue(target.x - selected.card.left, 24, cardWidth - 24)
    },
    character: selected.character,
    connector: selected.connector
  };
}

function wrapGuideBody(text, maxChars) {
  const chars = Array.from(String(text || '').trim());
  const limit = Math.max(8, Number(maxChars) || 18);
  const lines = [];
  let line = '';
  const sentenceEnd = /[，。；：！？]/;

  chars.forEach((char, index) => {
    line += char;
    const nextChar = chars[index + 1] || '';
    const closesSentence = sentenceEnd.test(char) && line.length >= 6;
    const reachesLimit = line.length >= limit && !sentenceEnd.test(nextChar);
    if (closesSentence || reachesLimit) {
      lines.push(line);
      line = '';
    }
  });
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function chooseGuidePlacement(input) {
  const opts = input || {};
  const target = opts.target;
  const safeArea = opts.safeArea;
  const cardWidth = Number(opts.cardWidth) || 0;
  const cardHeight = Number(opts.cardHeight) || 0;
  const gap = Number(opts.gap) || 0;
  if (!target || !safeArea || !cardWidth || !cardHeight) return null;

  const clampValue = (value, min, max) => Math.max(min, Math.min(max, value));
  const maxLeft = Math.max(safeArea.left, safeArea.right - cardWidth);
  const maxTop = Math.max(safeArea.top, safeArea.bottom - cardHeight);
  const centeredLeft = clampValue(target.x - cardWidth / 2, safeArea.left, maxLeft);
  const aboveTop = clampValue(target.y - cardHeight - gap, safeArea.top, maxTop);
  const belowTop = clampValue(target.y + gap, safeArea.top, maxTop);
  const horizontalPositions = [centeredLeft, safeArea.left, maxLeft]
    .filter((value, index, values) => values.indexOf(value) === index);
  const verticalPositions = [aboveTop, belowTop]
    .filter((value, index, values) => values.indexOf(value) === index);
  const obstacles = Array.isArray(opts.obstacles) ? opts.obstacles : [];
  const candidates = [];

  verticalPositions.forEach((top) => {
    horizontalPositions.forEach((left) => {
      const rect = {
        left,
        top,
        right: left + cardWidth,
        bottom: top + cardHeight
      };
      const overlap = obstacles.reduce((total, obstacle) => total + rectOverlapArea(rect, obstacle), 0);
      const distance = Math.abs(left - centeredLeft) + Math.abs(top - aboveTop) * 0.2;
      candidates.push({ left, top, overlap, distance });
    });
  });

  candidates.sort((first, second) => first.overlap - second.overlap || first.distance - second.distance);
  const placement = candidates[0];
  const pointerDirection = placement.top + cardHeight <= target.y ? 'down' : 'up';
  return {
    left: placement.left,
    top: placement.top,
    pointerDirection,
    pointerLeft: clampValue(target.x - placement.left, 24, cardWidth - 24)
  };
}

function chooseGuideCharacter(input) {
  const opts = input || {};
  const card = opts.card;
  const target = opts.target;
  const safeArea = opts.safeArea;
  const characterSize = Number(opts.characterSize) || 0;
  if (!card || !target || !safeArea || !characterSize) return null;

  const clampValue = (value, min, max) => Math.max(min, Math.min(max, value));
  const cardCenterX = card.left + card.width / 2;
  const maxLeft = Math.max(safeArea.left, safeArea.right - characterSize);
  const maxTop = Math.max(safeArea.top, safeArea.bottom - characterSize);
  const sideTop = clampValue(card.top + card.height - characterSize * 0.42, safeArea.top, maxTop);
  const designScale = characterSize / 70;
  const downTop = card.top + card.height + 16 * designScale;
  const canSitBelow = downTop + characterSize <= safeArea.bottom;
  // A pointing pose must always be selected from the real target geometry.
  // Never reuse a state-specific pose: a guide can move above/below its card
  // between states, while the hand still has to face the target horizontally.
  let pose = target.x >= cardCenterX ? 'right' : 'left';
  let left = pose === 'right'
    ? clampValue(target.x - characterSize * 1.8, safeArea.left, maxLeft)
    : clampValue(target.x + characterSize * 0.35, safeArea.left, maxLeft);
  let top = clampValue(canSitBelow ? downTop : sideTop, safeArea.top, maxTop);

  const handOffsets = {
    left: { x: 0.03, y: 0.47 },
    right: { x: 0.97, y: 0.47 },
    down: { x: 0.12, y: 0.62 }
  };
  let hand = handOffsets[pose];
  let handX = left + characterSize * hand.x;
  // Safe-area clamping can move the character past the target. Swap to the
  // other pointing asset when it is the only pose whose hand still faces it.
  if ((pose === 'right' && handX > target.x) || (pose === 'left' && handX < target.x)) {
    const alternatePose = pose === 'right' ? 'left' : 'right';
    const alternateLeft = alternatePose === 'right'
      ? clampValue(target.x - characterSize * 1.8, safeArea.left, maxLeft)
      : clampValue(target.x + characterSize * 0.35, safeArea.left, maxLeft);
    const alternateHandX = alternateLeft + characterSize * handOffsets[alternatePose].x;
    const alternateFacesTarget = alternatePose === 'right'
      ? alternateHandX <= target.x
      : alternateHandX >= target.x;
    if (alternateFacesTarget) {
      pose = alternatePose;
      left = alternateLeft;
      hand = handOffsets[pose];
      handX = alternateHandX;
    }
  }
  const startX = left + characterSize * hand.x;
  const startY = top + characterSize * hand.y;
  const dx = target.x - startX;
  const dy = target.y - startY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const targetInset = Math.min(12, Math.max(4, distance * 0.1));
  const pathLength = Math.max(0, distance - targetInset);
  const pathDx = target.x - startX;
  const pathDy = target.y - startY;

  return {
    pose,
    left,
    top,
    size: characterSize,
    pathLeft: startX,
    pathTop: startY,
    pathLength,
    pathWidth: Math.max(1, Math.abs(pathDx)),
    pathHeight: Math.max(1, Math.abs(pathDy)),
    pathDirection: `${pathDy >= 0 ? 'down' : 'up'}-${pathDx >= 0 ? 'right' : 'left'}`,
    handX,
    haloLeft: target.x - 24,
    haloTop: target.y - 24
  };
}

module.exports = {
  resolveSurveyGuide,
  chooseGuidePlacement,
  chooseGuideCharacter,
  wrapGuideBody,
  solveGuideLayout,
  buildDirectGuideConnector
};
