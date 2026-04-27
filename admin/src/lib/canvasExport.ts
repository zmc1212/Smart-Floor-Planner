/**
 * 提取户型图的 2D 轮廓并生成黑底白线的 Base64 图片
 * 供 ControlNet MLSD 预处理使用
 */

interface Point {
  x: number;
  y: number;
}

interface Opening {
  id: string;
  type: 'DOOR' | 'WINDOW';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

interface Room {
  id?: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  polygon?: Point[];
  polygonClosed?: boolean;
  openings?: Opening[];
}

export async function generateBaseMap(rooms: Room[]): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      if (!rooms || rooms.length === 0) {
        throw new Error('No rooms data provided');
      }

      // 1. Calculate bounding box
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      const allLines: { x1: number; y1: number; x2: number; y2: number }[] = [];

      rooms.forEach(room => {
        const rX = room.x || 0;
        const rY = room.y || 0;
        const rW = room.width || 0;
        const rH = room.height || 0;

        if (room.polygon && room.polygon.length > 0) {
          // Polygon rooms
          const pts = room.polygon;
          for (let i = 0; i < pts.length; i++) {
            const p1 = pts[i];
            const p2 = pts[(i + 1) % pts.length];
            
            if (i === pts.length - 1 && !room.polygonClosed) continue;

            const x1 = rX + p1.x;
            const y1 = rY + p1.y;
            const x2 = rX + p2.x;
            const y2 = rY + p2.y;

            allLines.push({ x1, y1, x2, y2 });

            minX = Math.min(minX, x1, x2);
            minY = Math.min(minY, y1, y2);
            maxX = Math.max(maxX, x1, x2);
            maxY = Math.max(maxY, y1, y2);
          }
        } else {
          // Rectangular rooms
          const x1 = rX;
          const y1 = rY;
          const x2 = rX + rW;
          const y2 = rY + rH;

          allLines.push({ x1, y1, x2, y1 }); // Top
          allLines.push({ x1: x2, y1, x2, y2 }); // Right
          allLines.push({ x1: x2, y1: y2, x2: x1, y2 }); // Bottom
          allLines.push({ x1, y1: y2, x2: x1, y2: y1 }); // Left

          minX = Math.min(minX, x1);
          minY = Math.min(minY, y1);
          maxX = Math.max(maxX, x2);
          maxY = Math.max(maxY, y2);
        }
      });

      if (allLines.length === 0) {
        throw new Error('No valid geometry found');
      }

      // Add padding
      const padding = 50;
      const width = (maxX - minX) + padding * 2;
      const height = (maxY - minY) + padding * 2;

      // Ensure a reasonable resolution (e.g. scale up if too small)
      const targetSize = 1024;
      const scale = Math.min(targetSize / width, targetSize / height);
      
      const canvasWidth = width * scale;
      const canvasHeight = height * scale;

      const canvas = document.createElement('canvas');
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to get 2d context');

      // 黑底
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // 白线
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 4; // ControlNet likes clear lines
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      allLines.forEach(line => {
        const drawX1 = (line.x1 - minX + padding) * scale;
        const drawY1 = (line.y1 - minY + padding) * scale;
        const drawX2 = (line.x2 - minX + padding) * scale;
        const drawY2 = (line.y2 - minY + padding) * scale;
        
        ctx.moveTo(drawX1, drawY1);
        ctx.lineTo(drawX2, drawY2);
      });
      ctx.stroke();

      resolve(canvas.toDataURL('image/png'));
    } catch (err) {
      reject(err);
    }
  });
}
