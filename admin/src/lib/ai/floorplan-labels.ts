export interface Point {
  x: number;
  y: number;
}

export interface Opening {
  id?: string;
  type?: 'DOOR' | 'WINDOW';
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
}

export interface RoomGeometry {
  id?: string;
  name?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  polygon?: Point[];
  polygonClosed?: boolean;
  openings?: Opening[];
}

export interface FloorPlanLayoutMetrics {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface LabelRenderData {
  roomId: string;
  roomName: string;
  centerX: number;
  centerY: number;
  widthLabel?: string;
  heightLabel?: string;
}

export function normalizeRooms(roomData: unknown): RoomGeometry[] {
  if (!Array.isArray(roomData)) {
    return [];
  }

  return roomData.filter((room): room is RoomGeometry => {
    return !!room && typeof room === 'object' && 'x' in room && 'y' in room;
  });
}

export function getLayoutMetrics(rooms: RoomGeometry[]): FloorPlanLayoutMetrics | null {
  if (!rooms.length) {
    return null;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const room of rooms) {
    const baseX = room.x || 0;
    const baseY = room.y || 0;

    if (room.polygon?.length) {
      for (const point of room.polygon) {
        minX = Math.min(minX, baseX + point.x);
        minY = Math.min(minY, baseY + point.y);
        maxX = Math.max(maxX, baseX + point.x);
        maxY = Math.max(maxY, baseY + point.y);
      }
    } else {
      minX = Math.min(minX, baseX);
      minY = Math.min(minY, baseY);
      maxX = Math.max(maxX, baseX + (room.width || 0));
      maxY = Math.max(maxY, baseY + (room.height || 0));
    }
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1),
  };
}

function getRoomCenter(room: RoomGeometry) {
  const baseX = room.x || 0;
  const baseY = room.y || 0;

  if (room.polygon?.length) {
    const points = room.polygon.map((point) => ({
      x: baseX + point.x,
      y: baseY + point.y,
    }));

    const total = points.reduce(
      (acc, point) => {
        acc.x += point.x;
        acc.y += point.y;
        return acc;
      },
      { x: 0, y: 0 }
    );

    return {
      x: total.x / points.length,
      y: total.y / points.length,
    };
  }

  return {
    x: baseX + (room.width || 0) / 2,
    y: baseY + (room.height || 0) / 2,
  };
}

function formatDimension(value?: number) {
  if (!value || !Number.isFinite(value)) {
    return undefined;
  }

  return `${Math.round(value * 100)}`;
}

export function buildLabelRenderData(rooms: RoomGeometry[]): LabelRenderData[] {
  return rooms.map((room, index) => {
    const center = getRoomCenter(room);
    return {
      roomId: room.id || `room-${index}`,
      roomName: room.name || `房间${index + 1}`,
      centerX: center.x,
      centerY: center.y,
      widthLabel: formatDimension(room.width),
      heightLabel: formatDimension(room.height),
    };
  });
}

export function scalePoint(
  x: number,
  y: number,
  metrics: FloorPlanLayoutMetrics,
  viewportWidth: number,
  viewportHeight: number,
  padding = 48
) {
  const usableWidth = Math.max(viewportWidth - padding * 2, 1);
  const usableHeight = Math.max(viewportHeight - padding * 2, 1);
  const scale = Math.min(usableWidth / metrics.width, usableHeight / metrics.height);
  const offsetX = (viewportWidth - metrics.width * scale) / 2;
  const offsetY = (viewportHeight - metrics.height * scale) / 2;

  return {
    x: offsetX + (x - metrics.minX) * scale,
    y: offsetY + (y - metrics.minY) * scale,
    scale,
  };
}

export function escapeSvgText(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
