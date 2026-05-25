const openingGeometry = require('./openingGeometry.js');

function normalizeLayout(layoutOrRooms) {
  if (Array.isArray(layoutOrRooms)) {
    return { rooms: layoutOrRooms, homeOutline: null, partitions: [] };
  }
  if (layoutOrRooms && typeof layoutOrRooms === 'object') {
    return {
      rooms: Array.isArray(layoutOrRooms.rooms) ? layoutOrRooms.rooms : [],
      homeOutline: layoutOrRooms.homeOutline || null,
      partitions: Array.isArray(layoutOrRooms.partitions) ? layoutOrRooms.partitions : []
    };
  }
  return { rooms: [], homeOutline: null, partitions: [] };
}

/**
 * 专业导出服务
 * 支持生成 DXF (CAD) 格式文本及量房报告数据汇总
 */

/**
 * 生成 DXF (R12) 格式字符串
 * @param {Array} rooms 房间列表
 */
function generateDXF(layoutOrRooms) {
  const layout = normalizeLayout(layoutOrRooms);
  const rooms = layout.rooms;
  let dxf = "0\nSECTION\n2\nHEADER\n0\nENDSEC\n";
  dxf += "0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n2\n";
  dxf += "0\nLAYER\n2\nWALLS\n70\n64\n62\n7\n6\nCONTINUOUS\n";
  dxf += "0\nLAYER\n2\nOPENINGS\n70\n64\n62\n1\n6\nCONTINUOUS\n";
  dxf += "0\nENDTAB\n0\nENDSEC\n";
  dxf += "0\nSECTION\n2\nENTITIES\n";
  const wallKeys = {};

  function addWallLine(x1, y1, x2, y2) {
    const key = _lineKey(x1, y1, x2, y2);
    if (wallKeys[key]) return;
    wallKeys[key] = true;
    dxf += _writeLine(x1, y1, x2, y2, "WALLS");
  }

  if (layout.homeOutline && layout.homeOutline.polygon && layout.homeOutline.polygon.length >= 3) {
    const outline = layout.homeOutline;
    const ox = outline.x || 0;
    const oy = outline.y || 0;
    for (let i = 0; i < outline.polygon.length; i++) {
      const p1 = outline.polygon[i];
      const p2 = outline.polygon[(i + 1) % outline.polygon.length];
      addWallLine(ox + p1.x, -(oy + p1.y), ox + p2.x, -(oy + p2.y));
    }
  }

  (layout.partitions || []).forEach(partition => {
    const pts = partition.points || [];
    if (pts.length >= 2) {
      addWallLine(pts[0].x, -pts[0].y, pts[1].x, -pts[1].y);
    }
  });

  const exportRoomWalls = !(layout.homeOutline && layout.homeOutline.polygon && layout.homeOutline.polygon.length >= 3);

  rooms.forEach(room => {
    // 1. 导出墙体 (如果是矩形房间使用 width/height，如果是多边形使用 polygon)
    if (!exportRoomWalls) {
      // Whole-home layouts use homeOutline + partitions as the authoritative wall graph.
    } else if (room.polygon && room.polygon.length >= 3) {
      // 多边形房间
      for (let i = 0; i < room.polygon.length; i++) {
        const p1 = room.polygon[i];
        const p2 = room.polygon[(i + 1) % room.polygon.length];
        const rx = room.x || 0;
        const ry = room.y || 0;
        addWallLine(rx + p1.x, -(ry + p1.y), rx + p2.x, -(ry + p2.y));
      }
    } else {
      // 矩形房间
      const x = room.x, y = room.y, w = room.width, h = room.height;
      addWallLine(x, -y, x + w, -y);
      addWallLine(x + w, -y, x + w, -(y + h));
      addWallLine(x + w, -(y + h), x, -(y + h));
      addWallLine(x, -(y + h), x, -y);
    }

    // 2. 导出门窗
    if (room.openings) {
      room.openings.forEach(op => {
        // 计算门窗在全局坐标系下的起止点
        // 注意：这里简化逻辑，假设旋转为0或90，且依附于墙体
        // 实际 DXF 需要更精确的坐标转换，这里先记录基本线段
        const endpoints = openingGeometry.getOpeningEndpoints(room, op);
        dxf += _writeLine(endpoints.start.x, -endpoints.start.y, endpoints.end.x, -endpoints.end.y, "OPENINGS");
        
        // 如果是门，画个简单的 45 度虚线代表开启方向（可选）
      });
    }
    
    // 3. 导出房间名称文字
    dxf += "0\nTEXT\n8\nROOM_LABELS\n10\n" + (room.x + 2) + "\n20\n" + -(room.y + 5) + "\n40\n2.0\n1\n" + (room.name || "Room") + "\n";
  });

  dxf += "0\nENDSEC\n0\nEOF";
  return dxf;
}

function _writeLine(x1, y1, x2, y2, layer) {
  x1 = _safeNumber(x1);
  y1 = _safeNumber(y1);
  x2 = _safeNumber(x2);
  y2 = _safeNumber(y2);
  let line = "0\nLINE\n8\n" + layer + "\n";
  line += "10\n" + x1.toFixed(2) + "\n20\n" + y1.toFixed(2) + "\n30\n0.0\n";
  line += "11\n" + x2.toFixed(2) + "\n21\n" + y2.toFixed(2) + "\n31\n0.0\n";
  return line;
}

function _lineKey(x1, y1, x2, y2) {
  const a = _pointKey(x1, y1);
  const b = _pointKey(x2, y2);
  return a < b ? a + '|' + b : b + '|' + a;
}

function _pointKey(x, y) {
  return (Math.round(_safeNumber(x) * 1000) / 1000) + ',' + (Math.round(_safeNumber(y) * 1000) / 1000);
}

function _safeNumber(value) {
  const number = parseFloat(value);
  return isFinite(number) ? number : 0;
}

/**
 * 汇总导出报告所需的数据 (增强型)
 */
function getReportSummary(layoutOrRooms) {
  const layout = normalizeLayout(layoutOrRooms);
  const rooms = layout.rooms;
  let totalArea = 0;
  
  const roomSummaries = rooms.map(r => {
    let area = 0;
    if (r.polygon && r.polygon.length >= 3) {
      // Shoelace Formula for polygon area
      let polyArea = 0;
      for (let i = 0; i < r.polygon.length; i++) {
        let j = (i + 1) % r.polygon.length;
        polyArea += r.polygon[i].x * r.polygon[j].y;
        polyArea -= r.polygon[j].x * r.polygon[i].y;
      }
      area = Math.abs(polyArea) / 200; // 这里的单位换算需要注意，假设坐标是0.1m级别
    } else {
      area = (r.width * r.height / 100);
    }
    
    totalArea += area;

    // 基础比例分析
    const ratio = Math.max(r.width / r.height, r.height / r.width);
    const isProportional = ratio < 1.5;

    return {
      name: r.name || '未命名房间',
      dimensions: `${(r.width/10).toFixed(1)}m x ${(r.height/10).toFixed(1)}m`,
      area: area.toFixed(2) + " ㎡",
      openingsCount: (r.openings || []).length,
      suggestions: [
        isProportional ? "采光比例均衡，适合对称布局" : "进深较长，建议增加横向照明或功能分区",
        (r.openings || []).length > 2 ? "门窗丰富，通透度高" : "开口适中，私密性较好"
      ]
    };
  });

  return {
    title: "智能量房大师 - 数字化量房报告",
    totalArea: totalArea.toFixed(2),
    roomCount: rooms.length,
    rooms: roomSummaries,
    summaryText: `该户型共包含 ${rooms.length} 个空间节点，总覆盖面积约 ${totalArea.toFixed(2)} ㎡。结构清晰，已完成数字化建模。`,
    date: new Date().toLocaleDateString()
  };
}

module.exports = {
  generateDXF,
  getReportSummary
};
