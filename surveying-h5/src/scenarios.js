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

  function innerStartInnerFaceClosure() {
    // Screenshot regression: 6000 mm inner / 6400 mm outer source room;
    // start from the inner measurement edge, then measure the 1800 x 3000 chain
    // and close its orange edge onto the source room's inner right face.
    let draft = rectangle(6000, 4000, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });
    draft = snapCursor(draft, { xMm: 3000, yMm: 0 });
    draft = commitWall(draft, { xMm: 3000, yMm: -2000 });
    draft = commitWall(draft, { xMm: 6000, yMm: -2000 });
    draft = commitWall(draft, { xMm: 6000, yMm: 100 });
    return surveyGraph.confirmClosure(draft);
  }

  function outerStartInnerFaceClosure() {
    // Same geometry and inner-face close as above, but the cursor begins on
    // the visible outer face. Its live red edge uses the outer wall face.
    let draft = rectangle(6000, 4000, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });
    draft = snapCursor(draft, { xMm: 3000, yMm: -200 });
    draft = commitWall(draft, { xMm: 3000, yMm: -2000 });
    draft = commitWall(draft, { xMm: 6000, yMm: -2000 });
    draft = commitWall(draft, { xMm: 6000, yMm: 100 });
    return surveyGraph.confirmClosure(draft);
  }

  function outerFaceCornerMergeClosure() {
    // Exact outer-face continuation: 6000 mm inner / 6400 mm outer source
    // room, 1800 mm first reading and 3000 mm top reading. The final cursor
    // is on the right wall's outer face (x=6200), so the short bridge must be
    // inferred without moving the visible closing wall to x=6400.
    let draft = rectangle(6000, 4000, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });
    draft = snapCursor(draft, { xMm: 3000, yMm: -200 });
    draft = commitWall(draft, { xMm: 3000, yMm: -2000 });
    draft = commitWall(draft, { xMm: 6200, yMm: -2000 });
    draft = surveyGraph.startPreview(draft, { xMm: 6200, yMm: 100 });
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

  function outerFaceMidWallClosure() {
    // Regression: Room 2 starts at the outer top-right corner of Room 1
    // (shared outer corner), draws 3 walls (right → down → left), and the
    // final wall preview ends on the MID-SECTION of Room 1's right outer face
    // at y=1569 — matching the "X 3329 / Y 1569" cursor position in image 1.
    // Before the fix this walked mergeClosing and picked the wrong node,
    // shifting Room 2 by a full wall thickness (image 2 result).
    // After the fix: shared-wall insertion splits the boundary wall at the
    // topology projection, lastWall.endNodeId is redirected to the topology
    // node so the chain connects, and the correct L-shape (image 3) is formed.
    //
    // Room 1: 3129 wide × 3565 tall, wall thickness 200.
    //   Outer top-right corner: (3329, -200)
    //   Outer right face: x=3329, y ∈ [-200, 3765]
    // Room 2 path from outer top-right corner:
    //   → right  : (3329, -200) → (5783, -200)   [2454 mm wide]
    //   → down   : (5783, -200) → (5783,  1569)  [1769 mm tall]
    //   → left   : (5783, 1569) → (3329,  1569)  preview ending on right outer face
    const thk = 200;
    const room1W = 3129;
    const room1H = 3565;
    let draft = rectangle(room1W, room1H, { xMm: 0, yMm: 0 }, { thicknessMm: thk });
    // Start at the outer top-right corner of Room 1.
    draft = snapCursor(draft, { xMm: room1W + thk, yMm: -thk });
    // Wall 1: horizontal right.
    draft = commitWall(draft, { xMm: room1W + thk + 2454, yMm: -thk });
    // Wall 2: vertical down.
    draft = commitWall(draft, { xMm: room1W + thk + 2454, yMm: 1569 });
    // Wall 3 preview: horizontal left, ending on Room 1's right outer face mid-section.
    draft = surveyGraph.startPreview(draft, { xMm: room1W + thk, yMm: 1569 });
    return surveyGraph.confirmClosure(draft);
  }

  function outerFaceMidWallDeletion() {
    let draft = outerFaceMidWallClosure();
    const floor = draft.floors[0];
    const spaces = floor.spaces || [];
    if (spaces.length === 2) {
      const room2 = spaces[1];
      const sharedWallId = spaces[0].wallIds.find(id => room2.wallIds.includes(id));
      if (sharedWallId) {
        draft = surveyGraph.deleteWall(draft, sharedWallId);
      }
    }
    return draft;
  }

  function mergedRoomAfterDeletion() {
    // Regression test for deleting a shared wall between two adjacent rooms
    // Room 1: 3129 wide × 3565 tall, wall thickness 200.
    const thk = 200;
    const room1W = 3129;
    const room1H = 3565;
    let draft = rectangle(room1W, room1H, { xMm: 0, yMm: 0 }, { thicknessMm: thk });
    // Start at the outer top-right corner of Room 1.
    draft = snapCursor(draft, { xMm: room1W + thk, yMm: -thk });
    // Wall 1: horizontal right.
    draft = commitWall(draft, { xMm: room1W + thk + 2454, yMm: -thk });
    // Wall 2: vertical down.
    draft = commitWall(draft, { xMm: room1W + thk + 2454, yMm: 1569 });
    // Wall 3 preview: horizontal left, ending on Room 1's right outer face mid-section.
    draft = surveyGraph.startPreview(draft, { xMm: room1W + thk, yMm: 1569 });
    draft = surveyGraph.confirmClosure(draft);
    
    // Now delete the shared wall
    const floor = draft.floors[0];
    const spaces = floor.spaces || [];
    if (spaces.length === 2) {
      const room2 = spaces[1];
      const sharedWallId = spaces[0].wallIds.find(id => room2.wallIds.includes(id));
      if (sharedWallId) {
        draft = surveyGraph.deleteWall(draft, sharedWallId);
      }
    }
    return draft;
  }

  function mergedRoomMiddleDeletion() {
    let draft = rectangle(3000, 4000, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });
    // draw room attached to the middle of the right wall
    draft = snapCursor(draft, { xMm: 3200, yMm: 1000 });
    draft = commitWall(draft, { xMm: 6200, yMm: 1000 });
    draft = commitWall(draft, { xMm: 6200, yMm: 3000 });
    draft = surveyGraph.startPreview(draft, { xMm: 3200, yMm: 3000 });
    draft = surveyGraph.confirmClosure(draft);
    
    const floor = draft.floors[0];
    const spaces = floor.spaces || [];
    if (spaces.length === 2) {
      const sharedWallId = spaces[0].wallIds.find(id => spaces[1].wallIds.includes(id));
      if (sharedWallId) {
        draft = surveyGraph.deleteWall(draft, sharedWallId);
      }
    }
    return draft;
  }

  function mergedRoomWithThirdRoom() {
    let draft = rectangle(3000, 4000, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });
    // Room 2 attached to the right
    draft = snapCursor(draft, { xMm: 3200, yMm: 0 });
    draft = commitWall(draft, { xMm: 6200, yMm: 0 });
    draft = commitWall(draft, { xMm: 6200, yMm: 2000 });
    draft = surveyGraph.startPreview(draft, { xMm: 3200, yMm: 2000 });
    draft = surveyGraph.confirmClosure(draft);
    
    // Room 3 attached to the right of Room 1, below Room 2
    draft = snapCursor(draft, { xMm: 3200, yMm: 2000 });
    draft = commitWall(draft, { xMm: 6200, yMm: 2000 });
    draft = commitWall(draft, { xMm: 6200, yMm: 4000 });
    draft = surveyGraph.startPreview(draft, { xMm: 3200, yMm: 4000 });
    draft = surveyGraph.confirmClosure(draft);

    const floor = draft.floors[0];
    const spaces = floor.spaces || [];
    if (spaces.length === 3) {
      // Delete shared wall between Room 1 and Room 2
      const sharedWallId = spaces[0].wallIds.find(id => spaces[1].wallIds.includes(id));
      if (sharedWallId) {
        draft = surveyGraph.deleteWall(draft, sharedWallId);
      }
    }
    return draft;
  }

  function mergedRoomCollinearRight() {
    // Room 1: 4000x4000.
    let draft = rectangle(4000, 4000, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });
    // Room 2: 2000x2000, attached to the right part of Room 1's top wall.
    // So the right walls are collinear!
    draft = snapCursor(draft, { xMm: 2000, yMm: -200 });
    draft = commitWall(draft, { xMm: 2000, yMm: -2200 });
    draft = commitWall(draft, { xMm: 4200, yMm: -2200 });
    draft = surveyGraph.startPreview(draft, { xMm: 4200, yMm: -200 });
    draft = surveyGraph.confirmClosure(draft);

    const floor = draft.floors[0];
    const spaces = floor.spaces || [];
    if (spaces.length === 2) {
      const sharedWallId = spaces[0].wallIds.find(id => spaces[1].wallIds.includes(id));
      if (sharedWallId) {
        draft = surveyGraph.deleteWall(draft, sharedWallId);
      }
    }
    return draft;
  }

  function mergedRoomMiddleTopAttachment() {
    let draft = rectangle(6000, 4000, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });
    // Room 2: 2000x2000, attached to the middle of Room 1's top wall.
    // Room 1 top wall goes from 0 to 6000 at y=0.
    // Room 2 attaches at x=2000 to x=4000 on y=0.
    draft = snapCursor(draft, { xMm: 2000, yMm: 0 });
    draft = commitWall(draft, { xMm: 2000, yMm: -2000 });
    draft = commitWall(draft, { xMm: 4000, yMm: -2000 });
    draft = surveyGraph.startPreview(draft, { xMm: 4000, yMm: 0 });
    draft = surveyGraph.confirmClosure(draft);

    const floor = draft.floors[0];
    const spaces = floor.spaces || [];
    if (spaces.length === 2) {
      const sharedWallId = spaces[0].wallIds.find(id => spaces[1].wallIds.includes(id));
      if (sharedWallId) {
        draft = surveyGraph.deleteWall(draft, sharedWallId);
      }
    }
    return draft;
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
    const floor = surveyGraph.getActiveFloor(draft);
    const sourceWall = floor.walls[0];
    const sourceGeometry = surveyGraph.buildWallSnapGeometry(floor, sourceWall);
    const snapPoint = options.snapLine === 'outer'
      ? {
        xMm: Math.round((sourceGeometry.outerStart.xMm + sourceGeometry.outerEnd.xMm) / 2),
        yMm: Math.round((sourceGeometry.outerStart.yMm + sourceGeometry.outerEnd.yMm) / 2)
      }
      : { xMm: 3000, yMm: 0 };
    draft = snapCursor(draft, snapPoint);
    if (options.branchThicknessMm) {
      draft = surveyGraph.setThickness(draft, options.branchThicknessMm);
    }
    return commitWall(draft, { xMm: 3000, yMm: -2200 });
  }

  function exteriorTRightwardContinuation() {
    // Outer snapping selects the source wall's far boundary. The branch itself
    // keeps the same graph-side working face and body side through the turn.
    let draft = rectangle(6000, 4000, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });
    draft = snapCursor(draft, { xMm: 3000, yMm: -200 });
    draft = commitWall(draft, { xMm: 3000, yMm: -2000 });
    draft = commitWall(draft, { xMm: 6200, yMm: -2000 });
    return surveyGraph.startPreview(draft, { xMm: 6200, yMm: -900 });
  }

  function exteriorTRightwardPreview() {
    let draft = rectangle(6000, 4000, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });
    draft = snapCursor(draft, { xMm: 3000, yMm: -200 });
    draft = commitWall(draft, { xMm: 3000, yMm: -2000 });
    return surveyGraph.startPreview(draft, { xMm: 4800, yMm: -2000 });
  }

  function interiorTRightwardContinuation() {
    // The confirmed first wall fixes the local body side. Turning right keeps
    // that first wall in place and puts the continuation below its red edge.
    let draft = rectangle(6000, 4000, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });
    draft = snapCursor(draft, { xMm: 3000, yMm: 0 });
    draft = commitWall(draft, { xMm: 3000, yMm: -2000 });
    draft = commitWall(draft, { xMm: 6000, yMm: -2000 });
    return surveyGraph.startPreview(draft, { xMm: 6000, yMm: -900 });
  }

  function interiorTRightwardPreview() {
    let draft = rectangle(6000, 4000, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });
    draft = snapCursor(draft, { xMm: 3000, yMm: 0 });
    draft = commitWall(draft, { xMm: 3000, yMm: -2000 });
    return surveyGraph.startPreview(draft, { xMm: 4800, yMm: -2000 });
  }

  function exteriorTLeftwardContinuation() {
    let draft = rectangle(6000, 4000, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });
    draft = snapCursor(draft, { xMm: 3000, yMm: -200 });
    draft = commitWall(draft, { xMm: 3000, yMm: -2000 });
    draft = commitWall(draft, { xMm: -200, yMm: -2000 });
    return surveyGraph.startPreview(draft, { xMm: -200, yMm: -900 });
  }

  function interiorTLeftwardContinuation() {
    let draft = rectangle(6000, 4000, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });
    draft = snapCursor(draft, { xMm: 3000, yMm: 0 });
    draft = commitWall(draft, { xMm: 3000, yMm: -2000 });
    draft = commitWall(draft, { xMm: -200, yMm: -2000 });
    return surveyGraph.startPreview(draft, { xMm: -200, yMm: -900 });
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
    floor = surveyGraph.getActiveFloor(draft);
    draft = surveyGraph.updateOpening(draft, floor.openings[0].id, {
      centerOffsetMm: 1200
    });
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
      key: 'inner-start-inner-face-closure', category: '共墙多空间', label: '图示：内起外量、内边闭合',
      description: '6000/6400 源房；红线为 1800 × 3000，最后橙线吸附右内边。确认后墙体仍在橙线左侧。', expected: { walls: 8, spaces: 2, openings: 0 },
      build: innerStartInnerFaceClosure
    },
    {
      key: 'outer-start-inner-face-closure', category: '共墙多空间', label: '图示：外起外量、内边闭合',
      description: '同一 1800 × 3000 链路改为外边起步；确认后必须与内边起步保持同一实体侧。', expected: { walls: 8, spaces: 2, openings: 0 },
      build: outerStartInnerFaceClosure
    },
    {
      key: 'outer-face-corner-merge-closure', category: '共墙多空间', label: '图示：外起外合、右外边闭合',
      description: '红线 1800 × 3000，最后橙线落在右墙外边；闭合时保留该竖线并在左侧生成墙体。', expected: { walls: 9, spaces: 2, openings: 0 },
      build: outerFaceCornerMergeClosure
    },
    {
      key: 'staggered-adjacent', category: '共墙多空间', label: '错层共墙（示例图）',
      description: '底边对齐、上沿错层、右房更高的共享竖墙双房。', expected: { walls: 8, spaces: 2, openings: 0 },
      build: photographedStaggeredRooms
    },
    {
      key: 'outer-face-mid-wall-closure', category: '共墙多空间', label: '外壁中段闭合（图1→图3）',
      description: '房间2从房间1右上外角出发，3面墙后闭合到右壁外侧中段（非端点）。修复前产生偏移，修复后应得到正确L型。',
      expected: { walls: 8, spaces: 2, openings: 0 },
      build: outerFaceMidWallClosure
    },
    {
      key: 'merged-room-after-deletion', category: '共墙多空间', label: '删除共墙后合并',
      description: '删除两相邻房间的共享墙后，两个闭合房间打通合并成一个闭合房间。', expected: { walls: 7, spaces: 1, openings: 0 },
      build: mergedRoomAfterDeletion
    },
    {
      key: 'outer-face-mid-wall-deletion', category: '共墙多空间', label: '图1中段删除合并',
      description: '外壁中段闭合后删除共墙，两个闭合房间打通合并成一个 L 型闭合房间。', expected: { walls: 7, spaces: 1, openings: 0 },
      build: outerFaceMidWallDeletion
    },
    {
      key: 'merged-room-middle-deletion', category: '共墙多空间', label: '中段删除合并',
      description: '删除中间共墙后，剩余墙段组成一个打通后的闭合房间。', expected: { walls: 8, spaces: 1, openings: 0 },
      build: mergedRoomMiddleDeletion
    },
    {
      key: 'merged-room-collinear-right', category: '共墙多空间', label: '右壁共线合并',
      description: '删除共墙后，共线外墙保留为打通后闭合房间的一部分。', expected: { walls: 8, spaces: 1, openings: 0 },
      build: mergedRoomCollinearRight
    },
    {
      key: 'merged-room-middle-top', category: '共墙多空间', label: '顶壁中段合并',
      description: '删除顶壁中段共墙后，两个闭合房间打通合并成一个闭合房间。', expected: { walls: 8, spaces: 1, openings: 0 },
      build: mergedRoomMiddleTopAttachment
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
      key: 't-junction', category: '交点与分支', label: '外墙 T：内边起步',
      description: '首段红线沿分支墙内边显示；拓扑锚点与外边起步共用。', expected: { walls: 6, spaces: 1, openings: 0 },
      build: exteriorTJunction
    },
    {
      key: 'outer-start-t-junction', category: '交点与分支', label: '外墙 T：外边起步',
      description: '首段红线沿分支墙外边显示，与内边起步相差一个墙厚。', expected: { walls: 6, spaces: 1, openings: 0 },
      build: () => exteriorTJunction({ snapLine: 'outer' })
    },
    {
      key: 'outer-t-rightward-continuation', category: '交点与分支', label: '外墙 T：外起右拉后续',
      description: '外边只决定源墙远侧起步；向右转后绿光标、红线与墙体保持首段的局部工作侧。', expected: { walls: 7, spaces: 1, openings: 0 },
      build: exteriorTRightwardContinuation
    },
    {
      key: 'outer-t-rightward-preview', category: '交点与分支', label: '外墙 T：外起右拉预览',
      description: '首段确认后向右拉出第二段时，光标不跳墙厚，橙线从上一段红线端点连续起步。', expected: { walls: 6, spaces: 1, openings: 0 },
      build: exteriorTRightwardPreview
    },
    {
      key: 'inner-t-rightward-continuation', category: '交点与分支', label: '外墙 T：内起右拉后续',
      description: '内边起步后向右转，首段墙体不翻面，右拉墙体沿首段相同局部侧续接。', expected: { walls: 7, spaces: 1, openings: 0 },
      build: interiorTRightwardContinuation
    },
    {
      key: 'inner-t-rightward-preview', category: '交点与分支', label: '外墙 T：内起右拉预览',
      description: '首段确认后刚向右拉出第二段时，首段墙体保持原侧，预览墙体位于红线下方。', expected: { walls: 6, spaces: 1, openings: 0 },
      build: interiorTRightwardPreview
    },
    {
      key: 'outer-t-leftward-continuation', category: '交点与分支', label: '外墙 T：外起左拉后续',
      description: '外边起步后向左转，后续黑线、红线、橙线和光标保持连续，不得跳动一个墙厚。', expected: { walls: 7, spaces: 1, openings: 0 },
      build: exteriorTLeftwardContinuation
    },
    {
      key: 'inner-t-leftward-continuation', category: '交点与分支', label: '外墙 T：内起左拉后续',
      description: '内边起步后向左转，红线保持内侧，墙体实体始终在红线的外侧。', expected: { walls: 7, spaces: 1, openings: 0 },
      build: interiorTLeftwardContinuation
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
      description: '门洞避开节点保护区时，宿主墙切分后仍映射到正确墙段。', expected: { walls: 6, spaces: 1, openings: 1 },
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
