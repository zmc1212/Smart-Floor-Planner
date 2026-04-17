/**
 * 专业导出服务
 * 支持生成 DXF (CAD) 格式文本及量房报告数据汇总
 */

/**
 * 生成 DXF (R12) 格式字符串
 * @param {Array} rooms 房间列表
 */
function generateDXF(rooms) {
  let dxf = "0\nSECTION\n2\nHEADER\n0\nENDSEC\n";
  dxf += "0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n2\n";
  dxf += "0\nLAYER\n2\nWALLS\n70\n64\n62\n7\n6\nCONTINUOUS\n";
  dxf += "0\nLAYER\n2\nOPENINGS\n70\n64\n62\n1\n6\nCONTINUOUS\n";
  dxf += "0\nENDTAB\n0\nENDSEC\n";
  dxf += "0\nSECTION\n2\nENTITIES\n";

  rooms.forEach(room => {
    // 1. 导出墙体 (如果是矩形房间使用 width/height，如果是多边形使用 polygon)
    if (room.polygon && room.polygon.length >= 3) {
      // 多边形房间
      for (let i = 0; i < room.polygon.length; i++) {
        const p1 = room.polygon[i];
        const p2 = room.polygon[(i + 1) % room.polygon.length];
        dxf += _writeLine(p1.x, -p1.y, p2.x, -p2.y, "WALLS");
      }
    } else {
      // 矩形房间
      const x = room.x, y = room.y, w = room.width, h = room.height;
      dxf += _writeLine(x, -y, x + w, -y, "WALLS");
      dxf += _writeLine(x + w, -y, x + w, -(y + h), "WALLS");
      dxf += _writeLine(x + w, -(y + h), x, -(y + h), "WALLS");
      dxf += _writeLine(x, -(y + h), x, -y, "WALLS");
    }

    // 2. 导出门窗
    if (room.openings) {
      room.openings.forEach(op => {
        // 计算门窗在全局坐标系下的起止点
        // 注意：这里简化逻辑，假设旋转为0或90，且依附于墙体
        // 实际 DXF 需要更精确的坐标转换，这里先记录基本线段
        const startX = room.x + op.x;
        const startY = room.y + op.y;
        
        let endX = startX;
        let endY = startY;

        if (op.rotation === 0 || op.rotation === 180) {
          endX = startX + op.width;
        } else {
          endY = startY + op.width;
        }

        dxf += _writeLine(startX, -startY, endX, -endY, "OPENINGS");
        
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
  let line = "0\nLINE\n8\n" + layer + "\n";
  line += "10\n" + x1.toFixed(2) + "\n20\n" + y1.toFixed(2) + "\n30\n0.0\n";
  line += "11\n" + x2.toFixed(2) + "\n21\n" + y2.toFixed(2) + "\n31\n0.0\n";
  return line;
}

/**
 * 汇总导出报告所需的数据
 */
function getReportSummary(rooms) {
  let totalArea = 0;
  const roomSummaries = rooms.map(r => {
    const area = (r.width * r.height / 100);
    totalArea += area;
    return {
      name: r.name,
      dimensions: `${(r.width/10).toFixed(1)}m x ${(r.height/10).toFixed(1)}m`,
      area: area.toFixed(2) + " m²",
      openingsCount: (r.openings || []).length
    };
  });

  return {
    totalArea: totalArea.toFixed(2),
    roomCount: rooms.length,
    rooms: roomSummaries,
    date: new Date().toLocaleDateString()
  };
}

module.exports = {
  generateDXF,
  getReportSummary
};
