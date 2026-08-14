const CATEGORY_ORDER = [
  '单空间轮廓',
  '连续测量',
  '共墙多空间',
  '交点与分支',
  '墙体与构件'
];

function createScenarioCatalog(surveyGraph) {
  function commitWall(draft, point, source = 'h5-scenario') {
    const preview = surveyGraph.startPreview(draft, point);
    const floor = surveyGraph.getActiveFloor(preview);
    return surveyGraph.commitPreviewLength(
      preview,
      floor.session.previewLengthMm,
      source
    );
  }

  function buildClosedPolygon(points, options = {}) {
    let draft = surveyGraph.resetCursor(surveyGraph.createSurveyDraft());
    if (options.mode === 'diagonal') draft = surveyGraph.setMode(draft, 'diagonal');
    if (options.thicknessMm) draft = surveyGraph.setThickness(draft, options.thicknessMm);
    draft = surveyGraph.placeCursor(draft, points[0]);
    points.slice(1).forEach((point) => {
      draft = commitWall(draft, point);
    });
    return surveyGraph.confirmClosure(draft);
  }

  function buildOpenChain(points, options = {}) {
    let draft = surveyGraph.resetCursor(surveyGraph.createSurveyDraft());
    if (options.mode === 'diagonal') draft = surveyGraph.setMode(draft, 'diagonal');
    if (options.thicknessMm) draft = surveyGraph.setThickness(draft, options.thicknessMm);
    draft = surveyGraph.placeCursor(draft, points[0]);
    points.slice(1).forEach((point) => {
      draft = commitWall(draft, point);
    });
    return draft;
  }

  function snapCursor(draft, point) {
    const floor = surveyGraph.getActiveFloor(draft);
    const target = surveyGraph.getCursorPlacementTarget(
      floor,
      point,
      surveyGraph.CLOSE_TOLERANCE_MM
    );
    if (!target || !target.pointMm || target.type === 'free') {
      throw new Error(`场景吸附失败：${point.xMm},${point.yMm}`);
    }
    return surveyGraph.snapCursorToWall(
      surveyGraph.startWallSnap(draft),
      target.pointMm,
      target
    );
  }

  function closeIfAvailable(draft) {
    const state = surveyGraph.getActiveFloor(draft).session.state;
    return state === 'closing' || state === 'mergeClosing'
      ? surveyGraph.confirmClosure(draft)
      : draft;
  }

  function addPartition(draft, start, end, options = {}) {
    let next = snapCursor(draft, start);
    if (options.thicknessMm) next = surveyGraph.setThickness(next, options.thicknessMm);
    next = commitWall(next, end);
    return closeIfAvailable(next);
  }

  function rectangle(widthMm = 4000, heightMm = 3000, origin = { xMm: 0, yMm: 0 }, options = {}) {
    const { xMm, yMm } = origin;
    return buildClosedPolygon([
      { xMm, yMm },
      { xMm: xMm + widthMm, yMm },
      { xMm: xMm + widthMm, yMm: yMm + heightMm },
      { xMm, yMm: yMm + heightMm },
      { xMm, yMm }
    ], options);
  }

  function sideBySideSharedRooms() {
    let draft = rectangle(3000, 3600);
    draft = snapCursor(draft, { xMm: 3000, yMm: 0 });
    draft = commitWall(draft, { xMm: 6200, yMm: 0 });
    draft = commitWall(draft, { xMm: 6200, yMm: 3600 });
    draft = commitWall(draft, { xMm: 3000, yMm: 3600 });
    return surveyGraph.confirmClosure(draft);
  }

  function stackedSharedRooms() {
    let draft = rectangle(4200, 2600);
    draft = snapCursor(draft, { xMm: 0, yMm: 2600 });
    draft = commitWall(draft, { xMm: 0, yMm: 5200 });
    draft = commitWall(draft, { xMm: 4200, yMm: 5200 });
    draft = commitWall(draft, { xMm: 4200, yMm: 2600 });
    return surveyGraph.confirmClosure(draft);
  }

  function photographedStaggeredRooms() {
    // The supplied reference: aligned bottom edge, stepped top edge, one shared wall.
    let draft = rectangle(3082, 4120, { xMm: 2761, yMm: 0 });
    draft = snapCursor(draft, { xMm: 2761, yMm: 4120 });
    draft = commitWall(draft, { xMm: -200, yMm: 4120 });
    draft = commitWall(draft, { xMm: -200, yMm: 897 });
    draft = commitWall(draft, { xMm: 2761, yMm: 897 });
    return surveyGraph.confirmClosure(draft);
  }

  function partitionedRoom() {
    return addPartition(
      rectangle(6400, 3600),
      { xMm: 3000, yMm: 0 },
      { xMm: 3000, yMm: 3600 }
    );
  }

  function threeRoomsInRow() {
    let draft = addPartition(
      rectangle(9000, 3600),
      { xMm: 3000, yMm: 0 },
      { xMm: 3000, yMm: 3600 }
    );
    draft = addPartition(draft, { xMm: 6000, yMm: 0 }, { xMm: 6000, yMm: 3600 });
    return draft;
  }

  function threeRoomTLayout() {
    let draft = rectangle(4200, 2400, { xMm: 3000, yMm: 0 });

    draft = snapCursor(draft, { xMm: 3000, yMm: 2400 });
    draft = commitWall(draft, { xMm: 3000, yMm: 4800 });
    draft = commitWall(draft, { xMm: 7200, yMm: 4800 });
    draft = commitWall(draft, { xMm: 7200, yMm: 2400 });
    draft = surveyGraph.confirmClosure(draft);

    draft = snapCursor(draft, { xMm: 3000, yMm: 4800 });
    draft = commitWall(draft, { xMm: 0, yMm: 4800 });
    draft = commitWall(draft, { xMm: 0, yMm: 0 });
    draft = commitWall(draft, { xMm: 3000, yMm: 0 });
    return surveyGraph.confirmClosure(draft);
  }

  function fourRoomGrid() {
    let draft = addPartition(
      rectangle(7200, 4800),
      { xMm: 3600, yMm: 0 },
      { xMm: 3600, yMm: 4800 }
    );
    draft = addPartition(draft, { xMm: 0, yMm: 2400 }, { xMm: 3600, yMm: 2400 });
    draft = addPartition(draft, { xMm: 3600, yMm: 2400 }, { xMm: 7200, yMm: 2400 });
    return draft;
  }

  function exteriorTJunction(options = {}) {
    let draft = rectangle(6000, 4000, { xMm: 0, yMm: 0 }, {
      thicknessMm: options.sourceThicknessMm || 200
    });
    draft = snapCursor(draft, { xMm: 3000, yMm: 0 });
    if (options.branchThicknessMm) {
      draft = surveyGraph.setThickness(draft, options.branchThicknessMm);
    }
    return commitWall(draft, { xMm: 3000, yMm: -2200 });
  }

  function crossJunction() {
    let draft = buildOpenChain([
      { xMm: -3200, yMm: 0 },
      { xMm: 3200, yMm: 0 }
    ]);
    draft = snapCursor(draft, { xMm: 0, yMm: 0 });
    draft = commitWall(draft, { xMm: 0, yMm: -2200 });
    draft = snapCursor(draft, { xMm: 0, yMm: 0 });
    return commitWall(draft, { xMm: 0, yMm: 2200 });
  }

  function diagonalTJunction() {
    let draft = buildOpenChain([
      { xMm: -2800, yMm: -1600 },
      { xMm: 2800, yMm: 1600 }
    ], { mode: 'diagonal' });
    draft = snapCursor(draft, { xMm: 0, yMm: 0 });
    draft = surveyGraph.setMode(draft, 'diagonal');
    return commitWall(draft, { xMm: -1400, yMm: 2400 });
  }

  function doorAndWindowRoom() {
    let draft = rectangle(5200, 3600);
    let floor = surveyGraph.getActiveFloor(draft);
    draft = surveyGraph.addOpeningToWall(draft, floor.walls[0].id, 'door');
    floor = surveyGraph.getActiveFloor(draft);
    draft = surveyGraph.addOpeningToWall(draft, floor.walls[2].id, 'window');
    return draft;
  }

  function openingSplitBranch() {
    let draft = rectangle(6000, 4000);
    let floor = surveyGraph.getActiveFloor(draft);
    draft = surveyGraph.addOpeningToWall(draft, floor.walls[0].id, 'door');
    draft = snapCursor(draft, { xMm: 3000, yMm: 0 });
    return commitWall(draft, { xMm: 3000, yMm: -2200 });
  }

  function mixedThicknessRoom() {
    let draft = rectangle(5200, 3600);
    let floor = surveyGraph.getActiveFloor(draft);
    [100, 200, 300, 400].forEach((thicknessMm, index) => {
      draft = surveyGraph.setThickness(draft, thicknessMm, floor.walls[index].id);
      floor = surveyGraph.getActiveFloor(draft);
    });
    return draft;
  }

  const catalog = [
    {
      key: 'rectangle', category: '单空间轮廓', label: '矩形闭合',
      description: '最常见的四边正交房间。', expected: { walls: 4, spaces: 1, openings: 0 },
      build: () => rectangle()
    },
    {
      key: 'l-shape', category: '单空间轮廓', label: 'L 型内凹',
      description: '带一个内凹转角的异形房间。', expected: { walls: 6, spaces: 1, openings: 0 },
      build: () => buildClosedPolygon([
        { xMm: 0, yMm: 0 }, { xMm: 4800, yMm: 0 }, { xMm: 4800, yMm: 1800 },
        { xMm: 2900, yMm: 1800 }, { xMm: 2900, yMm: 3600 }, { xMm: 0, yMm: 3600 },
        { xMm: 0, yMm: 0 }
      ])
    },
    {
      key: 'u-shape', category: '单空间轮廓', label: 'U 型双内凹',
      description: '带两个内凹转角的 U 型空间或深凹槽。', expected: { walls: 8, spaces: 1, openings: 0 },
      build: () => buildClosedPolygon([
        { xMm: 0, yMm: 0 }, { xMm: 6000, yMm: 0 }, { xMm: 6000, yMm: 4400 },
        { xMm: 4300, yMm: 4400 }, { xMm: 4300, yMm: 1800 }, { xMm: 1700, yMm: 1800 },
        { xMm: 1700, yMm: 4400 }, { xMm: 0, yMm: 4400 }, { xMm: 0, yMm: 0 }
      ])
    },
    {
      key: 'stepped-room', category: '单空间轮廓', label: '多级错台',
      description: '连续多个正交进退位的阶梯形空间。', expected: { walls: 8, spaces: 1, openings: 0 },
      build: () => buildClosedPolygon([
        { xMm: 0, yMm: 0 }, { xMm: 5600, yMm: 0 }, { xMm: 5600, yMm: 1600 },
        { xMm: 4300, yMm: 1600 }, { xMm: 4300, yMm: 2900 }, { xMm: 3000, yMm: 2900 },
        { xMm: 3000, yMm: 4200 }, { xMm: 0, yMm: 4200 }, { xMm: 0, yMm: 0 }
      ])
    },
    {
      key: 'trapezoid-room', category: '单空间轮廓', label: '梯形斜墙',
      description: '两侧为斜墙的非正交房间。', expected: { walls: 4, spaces: 1, openings: 0 },
      build: () => buildClosedPolygon([
        { xMm: 0, yMm: 0 }, { xMm: 5200, yMm: 0 }, { xMm: 4600, yMm: 3200 },
        { xMm: 600, yMm: 3200 }, { xMm: 0, yMm: 0 }
      ], { mode: 'diagonal' })
    },
    {
      key: 'chamfered-room', category: '单空间轮廓', label: '单角切斜',
      description: '一处斜切角的五边形房间。', expected: { walls: 5, spaces: 1, openings: 0 },
      build: () => buildClosedPolygon([
        { xMm: 0, yMm: 0 }, { xMm: 4200, yMm: 0 }, { xMm: 5000, yMm: 800 },
        { xMm: 5000, yMm: 3200 }, { xMm: 0, yMm: 3200 }, { xMm: 0, yMm: 0 }
      ], { mode: 'diagonal' })
    },
    {
      key: 'bay-window-room', category: '单空间轮廓', label: '斜边飘窗位',
      description: '带外凸飘窗或斜边阳台的混合轮廓。', expected: { walls: 8, spaces: 1, openings: 0 },
      build: () => buildClosedPolygon([
        { xMm: 0, yMm: 0 }, { xMm: 4800, yMm: 0 }, { xMm: 4800, yMm: 3000 },
        { xMm: 3500, yMm: 3000 }, { xMm: 3300, yMm: 3600 }, { xMm: 1500, yMm: 3600 },
        { xMm: 1300, yMm: 3000 }, { xMm: 0, yMm: 3000 }, { xMm: 0, yMm: 0 }
      ], { mode: 'diagonal' })
    },
    {
      key: 'open-chain', category: '连续测量', label: '开放正交墙链',
      description: '尚未闭合的连续直墙测量过程。', expected: { walls: 3, spaces: 0, openings: 0 },
      build: () => buildOpenChain([
        { xMm: 0, yMm: 0 }, { xMm: 3600, yMm: 0 }, { xMm: 3600, yMm: 2400 },
        { xMm: 1200, yMm: 2400 }
      ])
    },
    {
      key: 'angled-open-chain', category: '连续测量', label: '开放混合墙链',
      description: '直墙和斜墙混合、尚未闭合的现场量测。', expected: { walls: 4, spaces: 0, openings: 0 },
      build: () => buildOpenChain([
        { xMm: 0, yMm: 0 }, { xMm: 3000, yMm: 0 }, { xMm: 4200, yMm: 1200 },
        { xMm: 4200, yMm: 3200 }, { xMm: 1800, yMm: 3800 }
      ], { mode: 'diagonal' })
    },
    {
      key: 'adjacent-rooms', category: '共墙多空间', label: '等高共墙双房',
      description: '先量一间，再沿现有墙闭合相邻房间。', expected: { walls: 7, spaces: 2, openings: 0 },
      build: sideBySideSharedRooms
    },
    {
      key: 'stacked-rooms', category: '共墙多空间', label: '上下共墙双房',
      description: '上下排列、共享水平墙的两个房间。', expected: { walls: 7, spaces: 2, openings: 0 },
      build: stackedSharedRooms
    },
    {
      key: 'staggered-adjacent', category: '共墙多空间', label: '错层共墙（示例图）',
      description: '底边对齐、上沿错层、右房更高的共享竖墙双房。', expected: { walls: 8, spaces: 2, openings: 0 },
      build: photographedStaggeredRooms
    },
    {
      key: 'partition', category: '共墙多空间', label: '单房贯穿分割',
      description: '在一个已闭合空间内新增贯穿隔墙。', expected: { walls: 7, spaces: 2, openings: 0 },
      build: partitionedRoom
    },
    {
      key: 'three-room-row', category: '共墙多空间', label: '横排三房',
      description: '两道贯穿隔墙形成三个连续房间。', expected: { walls: 10, spaces: 3, openings: 0 },
      build: threeRoomsInRow
    },
    {
      key: 'three-room-t', category: '共墙多空间', label: 'T 型三房',
      description: '一条贯穿墙加一条半幅隔墙形成三房。', expected: { walls: 10, spaces: 3, openings: 0 },
      build: threeRoomTLayout
    },
    {
      key: 'four-room-grid', category: '共墙多空间', label: '十字四房',
      description: '分段测量十字交点并形成四个闭合房间。', expected: { walls: 12, spaces: 4, openings: 0 },
      build: fourRoomGrid
    },
    {
      key: 't-junction', category: '交点与分支', label: '外墙 T 型分支',
      description: '从既有墙中点向外拉出一条分支墙。', expected: { walls: 6, spaces: 1, openings: 0 },
      build: exteriorTJunction
    },
    {
      key: 'cross-junction', category: '交点与分支', label: '开放十字交点',
      description: '四向墙体在同一内部节点相交。', expected: { walls: 4, spaces: 0, openings: 0 },
      build: crossJunction
    },
    {
      key: 'diagonal-t-junction', category: '交点与分支', label: '斜墙 T 型分支',
      description: '从斜向源墙中点继续拉出斜向分支。', expected: { walls: 3, spaces: 0, openings: 0 },
      build: diagonalTJunction
    },
    {
      key: 'door-window-room', category: '墙体与构件', label: '门窗闭合房',
      description: '闭合房间的不同墙上分别放置门和窗。', expected: { walls: 4, spaces: 1, openings: 2 },
      build: doorAndWindowRoom
    },
    {
      key: 'opening-split-branch', category: '墙体与构件', label: '带门墙体分支',
      description: '带门墙被交点切分后，开口仍映射到正确墙段。', expected: { walls: 6, spaces: 1, openings: 1 },
      build: openingSplitBranch
    },
    {
      key: 'mixed-thickness-room', category: '墙体与构件', label: '四边不同墙厚',
      description: '同一闭合房间包含 100/200/300/400 mm 墙厚。', expected: { walls: 4, spaces: 1, openings: 0 },
      build: mixedThicknessRoom
    },
    {
      key: 'unequal-thickness-t', category: '墙体与构件', label: '异厚 T 型墙',
      description: '400 mm 源墙连接 100 mm 分支墙。', expected: { walls: 6, spaces: 1, openings: 0 },
      build: () => exteriorTJunction({ sourceThicknessMm: 400, branchThicknessMm: 100 })
    }
  ];

  return catalog;
}

module.exports = { CATEGORY_ORDER, createScenarioCatalog };
