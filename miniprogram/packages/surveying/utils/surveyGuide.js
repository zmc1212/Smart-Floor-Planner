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
      '确认闭合线正确后，点击“可闭合”。',
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
    return createGuide(
      'first-wall',
      '拉出第一面墙',
      '从画布光标沿第一面墙方向拖动。',
      'cursor'
    );
  }

  if (state === 'cursorPlaced' || state === 'wallCommitted') {
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
  const downTop = card.top + card.height + 6;
  const canSitBelow = downTop + characterSize <= safeArea.bottom;
  const targetBelowCard = target.y > card.top + card.height + 12;

  let pose = 'down';
  let left = clampValue(target.x - characterSize * 1.25, safeArea.left, maxLeft);
  let top = clampValue(downTop, safeArea.top, maxTop);

  if (left + characterSize + 12 > target.x) {
    left = clampValue(target.x + characterSize * 0.28, safeArea.left, maxLeft);
  }

  if (!targetBelowCard || !canSitBelow) {
    pose = target.x < cardCenterX ? 'left' : 'right';
    left = pose === 'left'
      ? clampValue(card.left - characterSize * 0.58, safeArea.left, maxLeft)
      : clampValue(card.left + card.width - characterSize * 0.42, safeArea.left, maxLeft);
    top = sideTop;
  }

  const handOffsets = {
    left: { x: 0.03, y: 0.47 },
    right: { x: 0.97, y: 0.47 },
    down: { x: 0.12, y: 0.62 }
  };
  const hand = handOffsets[pose];
  const startX = left + characterSize * hand.x;
  const startY = top + characterSize * hand.y;
  const dx = target.x - startX;
  const dy = target.y - startY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const targetInset = Math.min(12, Math.max(4, distance * 0.1));
  const pathLength = Math.max(0, distance - targetInset);

  return {
    pose,
    left,
    top,
    size: characterSize,
    pathLeft: startX,
    pathTop: startY,
    pathLength,
    pathAngle: Math.atan2(dy, dx) * 180 / Math.PI,
    haloLeft: target.x - 24,
    haloTop: target.y - 24
  };
}

module.exports = {
  resolveSurveyGuide,
  chooseGuidePlacement,
  chooseGuideCharacter,
  wrapGuideBody
};
