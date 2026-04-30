export type SoftFurnishingPlacementRole =
  | 'primary_seating'
  | 'center_table'
  | 'accent_seating'
  | 'storage_tall'
  | 'sleeping'
  | 'ceiling_light'
  | 'surface_finish';

export type SoftFurnishingSizeClass = 'small' | 'medium' | 'large';

export interface FurnitureSelection {
  id: string;
  name: string;
  category: string;
  typePrompt: string;
  stylePrompt: string;
  placementRole: SoftFurnishingPlacementRole;
  sizeClass: SoftFurnishingSizeClass;
}

export interface SceneBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SceneAnalysis {
  sceneType: 'frontal_room_v1';
  roomKind: 'living_room' | 'bedroom';
  imageWidth: number;
  imageHeight: number;
  openingZone: SceneBox;
  floorZone: SceneBox;
  leftWallZone: SceneBox;
  rightWallZone: SceneBox;
  ceilingZone: SceneBox;
  safePlacementZones: SceneBox[];
}

export interface PlacementPlanItem {
  furnitureId: string;
  furnitureName: string;
  role: SoftFurnishingPlacementRole;
  zoneId: string;
  bbox: { x: number; y: number; width: number; height: number };
  depthOrder: number;
  orientation: 'left' | 'right' | 'center' | 'back';
}

export interface PlacementPlan {
  roomKind: 'living_room' | 'bedroom';
  variant: 'default';
  items: PlacementPlanItem[];
}

export interface SoftFurnishingPreview {
  sceneAnalysis: SceneAnalysis;
  placementPlan: PlacementPlan;
  placementGuideImage: string;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseDataImage(input: string) {
  const match = input.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error('仅支持 base64 图片数据');
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function readPngSize(buffer: Buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('Invalid PNG image');
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readJpegSize(buffer: Buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error('Invalid JPEG image');
  }

  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    const markerLength = buffer.readUInt16BE(offset + 2);
    const isStartOfFrame =
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf;

    if (isStartOfFrame) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + markerLength;
  }

  throw new Error('Unable to read JPEG size');
}

function readWebpSize(buffer: Buffer) {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('Invalid WEBP image');
  }

  const chunkType = buffer.toString('ascii', 12, 16);
  if (chunkType === 'VP8X') {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }

  if (chunkType === 'VP8 ') {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }

  if (chunkType === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  throw new Error('Unsupported WEBP image');
}

export function getImageSizeFromDataUri(input: string) {
  const { mimeType, buffer } = parseDataImage(input);

  if (mimeType === 'image/png') {
    return readPngSize(buffer);
  }

  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return readJpegSize(buffer);
  }

  if (mimeType === 'image/webp') {
    return readWebpSize(buffer);
  }

  throw new Error('仅支持 PNG、JPEG、WEBP 图片');
}

function buildBox(id: string, x: number, y: number, width: number, height: number): SceneBox {
  return {
    id,
    x,
    y,
    width,
    height,
  };
}

function inferRoomKind(furnitureItems: FurnitureSelection[]): 'living_room' | 'bedroom' {
  const hasBed = furnitureItems.some((item) => item.placementRole === 'sleeping');
  const hasSofa = furnitureItems.some((item) => item.placementRole === 'primary_seating');
  return hasBed && !hasSofa ? 'bedroom' : 'living_room';
}

export function analyzeScene(
  image: string,
  furnitureItems: FurnitureSelection[]
): SceneAnalysis {
  const { width, height } = getImageSizeFromDataUri(image);
  const aspectRatio = width / height;

  if (width < 640 || height < 360) {
    throw new Error('图片分辨率过低，请上传更清晰的正视角现场图');
  }

  if (aspectRatio < 1.15 || aspectRatio > 2.6) {
    throw new Error('暂只支持横向正视角空房图，请上传正视角现场图');
  }

  const roomKind = inferRoomKind(furnitureItems);

  const openingZone = buildBox('opening-zone', width * 0.35, height * 0.16, width * 0.3, height * 0.42);
  const floorZone = buildBox('floor-zone', width * 0.08, height * 0.52, width * 0.84, height * 0.42);
  const leftWallZone = buildBox('left-wall-zone', width * 0.04, height * 0.12, width * 0.28, height * 0.48);
  const rightWallZone = buildBox('right-wall-zone', width * 0.68, height * 0.12, width * 0.28, height * 0.48);
  const ceilingZone = buildBox('ceiling-zone', width * 0.16, height * 0.04, width * 0.68, height * 0.18);
  const safePlacementZones = [
    buildBox('left-seating-zone', width * 0.12, height * 0.58, width * 0.3, height * 0.2),
    buildBox('center-table-zone', width * 0.42, height * 0.62, width * 0.16, height * 0.1),
    buildBox('right-accent-zone', width * 0.62, height * 0.58, width * 0.14, height * 0.18),
    buildBox('left-storage-zone', width * 0.02, height * 0.08, width * 0.1, height * 0.64),
    buildBox('right-storage-zone', width * 0.84, height * 0.1, width * 0.12, height * 0.62),
    buildBox('back-sleeping-zone', width * 0.28, height * 0.44, width * 0.42, height * 0.22),
    buildBox('ceiling-light-zone', width * 0.24, height * 0.08, width * 0.52, height * 0.08),
    buildBox('opening-finish-zone', width * 0.31, height * 0.14, width * 0.38, height * 0.46),
  ];

  return {
    sceneType: 'frontal_room_v1',
    roomKind,
    imageWidth: width,
    imageHeight: height,
    openingZone,
    floorZone,
    leftWallZone,
    rightWallZone,
    ceilingZone,
    safePlacementZones,
  };
}

function zoneById(sceneAnalysis: SceneAnalysis, zoneId: string) {
  return sceneAnalysis.safePlacementZones.find((zone) => zone.id === zoneId);
}

function boxWithin(zone: SceneBox, widthRatio: number, heightRatio: number, alignX: 'start' | 'center' | 'end', alignY: 'start' | 'center' | 'end') {
  const width = zone.width * widthRatio;
  const height = zone.height * heightRatio;

  let x = zone.x;
  let y = zone.y;

  if (alignX === 'center') {
    x += (zone.width - width) / 2;
  } else if (alignX === 'end') {
    x += zone.width - width;
  }

  if (alignY === 'center') {
    y += (zone.height - height) / 2;
  } else if (alignY === 'end') {
    y += zone.height - height;
  }

  return {
    x: clamp(x, 0, Number.MAX_SAFE_INTEGER),
    y: clamp(y, 0, Number.MAX_SAFE_INTEGER),
    width,
    height,
  };
}

export function buildPlacementPlan(
  sceneAnalysis: SceneAnalysis,
  furnitureItems: FurnitureSelection[]
): PlacementPlan {
  const roomKind = sceneAnalysis.roomKind;
  const items: PlacementPlanItem[] = [];
  let storageIndex = 0;

  furnitureItems.forEach((item) => {
    let zoneId = 'center-table-zone';
    let bbox = { x: 0, y: 0, width: 0, height: 0 };
    let orientation: PlacementPlanItem['orientation'] = 'center';
    let depthOrder = 1;

    if (item.placementRole === 'primary_seating') {
      zoneId = 'left-seating-zone';
      bbox = boxWithin(zoneById(sceneAnalysis, zoneId)!, 0.9, 0.85, 'center', 'center');
      orientation = 'left';
      depthOrder = 4;
    } else if (item.placementRole === 'center_table') {
      zoneId = 'center-table-zone';
      bbox = boxWithin(zoneById(sceneAnalysis, zoneId)!, 0.9, 0.9, 'center', 'center');
      orientation = 'center';
      depthOrder = 5;
    } else if (item.placementRole === 'accent_seating') {
      zoneId = 'right-accent-zone';
      bbox = boxWithin(zoneById(sceneAnalysis, zoneId)!, 0.85, 0.95, 'center', 'center');
      orientation = 'right';
      depthOrder = 6;
    } else if (item.placementRole === 'storage_tall') {
      zoneId = storageIndex % 2 === 0 ? 'left-storage-zone' : 'right-storage-zone';
      bbox = boxWithin(zoneById(sceneAnalysis, zoneId)!, 0.9, 0.86, 'center', 'end');
      orientation = zoneId === 'left-storage-zone' ? 'left' : 'right';
      depthOrder = 2;
      storageIndex += 1;
    } else if (item.placementRole === 'sleeping') {
      zoneId = 'back-sleeping-zone';
      bbox = boxWithin(zoneById(sceneAnalysis, zoneId)!, 0.94, 0.95, 'center', 'center');
      orientation = 'back';
      depthOrder = 3;
    } else if (item.placementRole === 'ceiling_light') {
      zoneId = 'ceiling-light-zone';
      bbox = boxWithin(zoneById(sceneAnalysis, zoneId)!, 0.92, 1, 'center', 'center');
      orientation = 'center';
      depthOrder = 0;
    } else if (item.placementRole === 'surface_finish') {
      zoneId = 'opening-finish-zone';
      bbox = boxWithin(zoneById(sceneAnalysis, zoneId)!, 1, 1, 'center', 'center');
      orientation = 'back';
      depthOrder = 1;
    }

    if (roomKind === 'bedroom' && item.placementRole === 'primary_seating') {
      zoneId = 'right-accent-zone';
      bbox = boxWithin(zoneById(sceneAnalysis, zoneId)!, 0.8, 0.8, 'center', 'center');
      orientation = 'right';
      depthOrder = 5;
    }

    if (roomKind === 'living_room' && item.placementRole === 'sleeping') {
      zoneId = 'right-storage-zone';
      bbox = boxWithin(zoneById(sceneAnalysis, zoneId)!, 0.88, 0.74, 'center', 'end');
      orientation = 'right';
      depthOrder = 2;
    }

    items.push({
      furnitureId: item.id,
      furnitureName: item.name,
      role: item.placementRole,
      zoneId,
      bbox,
      depthOrder,
      orientation,
    });
  });

  items.sort((a, b) => a.depthOrder - b.depthOrder);

  return {
    roomKind,
    variant: 'default',
    items,
  };
}

function renderPlanShape(item: PlacementPlanItem) {
  const { x, y, width, height } = item.bbox;
  const stroke = '#f97316';
  const fill = 'rgba(249, 115, 22, 0.12)';

  if (item.role === 'primary_seating') {
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${Math.min(width, height) * 0.12}" fill="${fill}" stroke="${stroke}" stroke-width="6" />
      <rect x="${x + width * 0.08}" y="${y + height * 0.06}" width="${width * 0.16}" height="${height * 0.88}" rx="${Math.min(width, height) * 0.06}" fill="none" stroke="${stroke}" stroke-width="4" />`;
  }

  if (item.role === 'center_table') {
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${Math.min(width, height) * 0.2}" fill="rgba(245, 158, 11, 0.12)" stroke="#f59e0b" stroke-width="5" stroke-dasharray="10 8" />`;
  }

  if (item.role === 'accent_seating') {
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${Math.min(width, height) * 0.18}" fill="rgba(14, 165, 233, 0.12)" stroke="#0ea5e9" stroke-width="5" />`;
  }

  if (item.role === 'storage_tall') {
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${Math.min(width, height) * 0.05}" fill="rgba(168, 85, 247, 0.1)" stroke="#a855f7" stroke-width="5" />`;
  }

  if (item.role === 'sleeping') {
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${Math.min(width, height) * 0.1}" fill="rgba(16, 185, 129, 0.12)" stroke="#10b981" stroke-width="6" />
      <rect x="${x + width * 0.1}" y="${y + height * 0.08}" width="${width * 0.28}" height="${height * 0.22}" rx="${Math.min(width, height) * 0.06}" fill="none" stroke="#10b981" stroke-width="4" />
      <rect x="${x + width * 0.44}" y="${y + height * 0.08}" width="${width * 0.28}" height="${height * 0.22}" rx="${Math.min(width, height) * 0.06}" fill="none" stroke="#10b981" stroke-width="4" />`;
  }

  if (item.role === 'ceiling_light') {
    const lineY = y + height / 2;
    return `<line x1="${x}" y1="${lineY}" x2="${x + width}" y2="${lineY}" stroke="#f8fafc" stroke-width="6" stroke-linecap="round" />
      <line x1="${x + width * 0.18}" y1="${lineY}" x2="${x + width * 0.18}" y2="${lineY + height * 0.9}" stroke="#f8fafc" stroke-width="3" stroke-linecap="round" />
      <line x1="${x + width * 0.82}" y1="${lineY}" x2="${x + width * 0.82}" y2="${lineY + height * 0.9}" stroke="#f8fafc" stroke-width="3" stroke-linecap="round" />`;
  }

  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${Math.min(width, height) * 0.06}" fill="rgba(251, 191, 36, 0.08)" stroke="#fbbf24" stroke-width="4" stroke-dasharray="12 8" />`;
}

export function buildPlacementGuideImage(
  sourceImage: string,
  sceneAnalysis: SceneAnalysis,
  placementPlan: PlacementPlan
) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${sceneAnalysis.imageWidth}" height="${sceneAnalysis.imageHeight}" viewBox="0 0 ${sceneAnalysis.imageWidth} ${sceneAnalysis.imageHeight}">
      <image href="${xmlEscape(sourceImage)}" x="0" y="0" width="${sceneAnalysis.imageWidth}" height="${sceneAnalysis.imageHeight}" preserveAspectRatio="none" />
      <rect x="${sceneAnalysis.openingZone.x}" y="${sceneAnalysis.openingZone.y}" width="${sceneAnalysis.openingZone.width}" height="${sceneAnalysis.openingZone.height}" rx="22" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.32)" stroke-width="3" stroke-dasharray="12 10" />
      ${placementPlan.items.map((item) => renderPlanShape(item)).join('')}
    </svg>
  `.trim();

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function describePlacement(item: PlacementPlanItem) {
  if (item.role === 'primary_seating') {
    return 'place the main seating group along the left side while keeping the circulation to the window open';
  }

  if (item.role === 'center_table') {
    return 'place a table anchored in the center foreground aligned with the main seating group';
  }

  if (item.role === 'accent_seating') {
    return 'place an accent chair on the right foreground side with realistic clearance';
  }

  if (item.role === 'storage_tall') {
    return item.orientation === 'left'
      ? 'place a tall storage element against the left wall without blocking the opening'
      : 'place a tall storage element against the right wall without blocking the opening';
  }

  if (item.role === 'sleeping') {
    return 'place the bed against the back portion of the room with proper walking space';
  }

  if (item.role === 'ceiling_light') {
    return 'add ceiling lighting aligned with the room centerline';
  }

  return 'upgrade the wall and ceiling finish while preserving all architectural geometry';
}

export function buildSoftFurnishingPrompt(
  sceneAnalysis: SceneAnalysis,
  placementPlan: PlacementPlan,
  furnitureItems: FurnitureSelection[],
  resolution: '1k' | '2k'
) {
  const furnishingLines = placementPlan.items
    .map((planItem) => {
      const selected = furnitureItems.find((item) => item.id === planItem.furnitureId);
      if (!selected) {
        return null;
      }

      return `${selected.typePrompt}, ${selected.stylePrompt}, ${describePlacement(planItem)}`;
    })
    .filter(Boolean)
    .join('; ');

  return [
    'photorealistic interior furnishing render based on the uploaded real empty room photo',
    'strictly preserve the original room structure, wall geometry, window opening, door opening, floor perspective, ceiling perspective, lighting direction and camera angle',
    `the room should remain a ${sceneAnalysis.roomKind === 'bedroom' ? 'bedroom-like resting space' : 'living-room-like lounge space'}`,
    'use the placement guide as the exact furniture layout reference',
    'selected furniture must be grounded naturally with contact shadows, realistic scale, correct occlusion and believable spacing',
    'do not move or redesign the architectural shell, do not reshape the opening, do not create extra doors or windows',
    furnishingLines || 'add a compact furniture composition that matches the guide shapes exactly',
    resolution === '2k' ? 'high detail, 2k render quality' : 'high detail, 1k render quality',
  ].join(', ');
}

export function buildDirectSoftFurnishingPrompt(
  furnitureItems: FurnitureSelection[],
  resolution: '1k' | '2k'
) {
  const roomKind = inferRoomKind(furnitureItems);
  const furnishingLines = furnitureItems
    .map((item) => `${item.typePrompt}, ${item.stylePrompt}`)
    .join('; ');

  return [
    'photorealistic interior redesign based on the uploaded real empty room photo',
    'strictly preserve the original room structure, wall geometry, floor perspective, ceiling perspective, lighting direction, window positions, door positions and camera angle',
    `keep the room readable as a ${roomKind === 'bedroom' ? 'bedroom-like resting space' : 'living-room-like lounge space'}`,
    'add the selected furniture types in realistic scale with believable spacing, grounded contact shadows and natural occlusion',
    'do not move walls, do not reshape openings, do not invent extra rooms, doors or windows',
    furnishingLines || 'add a tasteful and coherent furnishing composition',
    roomKind === 'bedroom' ? 'create a cozy restful composition' : 'create a welcoming residential composition',
    resolution === '2k' ? 'high detail, premium render quality' : 'high detail',
  ].join(', ');
}

export function buildSoftFurnishingPromptFromPreset(params: {
  promptTemplate: string;
  furnitureItems: FurnitureSelection[];
  roomType?: string;
}) {
  const roomTypeLabel =
    params.roomType === 'bedroom' ? 'bedroom-like resting space' : 'living-room-like lounge space';
  const furnitureSummary = params.furnitureItems
    .map((item) => `${item.name}, ${item.typePrompt}, ${item.stylePrompt}`)
    .join('; ');

  return [
    params.promptTemplate.trim(),
    `based on the uploaded real empty room photo, keep the room readable as a ${roomTypeLabel}`,
    'strictly preserve the original room structure, wall geometry, floor perspective, ceiling perspective, window positions, door positions, lighting direction and camera angle',
    'do not change the apartment layout or reshape the openings',
    furnitureSummary || 'add a coherent furnishing composition that fits the space naturally',
  ]
    .filter(Boolean)
    .join(', ');
}

export const SOFT_FURNISHING_NEGATIVE =
  'EasyNegative, changed room structure, altered perspective, changed window shape, extra windows, extra doors, floating furniture, broken geometry, deformed furniture, bad perspective, text, watermark, people, clutter, blurry, low quality';

export function createSoftFurnishingPreview(
  image: string,
  furnitureItems: FurnitureSelection[]
): SoftFurnishingPreview {
  const sceneAnalysis = analyzeScene(image, furnitureItems);
  const placementPlan = buildPlacementPlan(sceneAnalysis, furnitureItems);
  const placementGuideImage = buildPlacementGuideImage(image, sceneAnalysis, placementPlan);

  return {
    sceneAnalysis,
    placementPlan,
    placementGuideImage,
  };
}
