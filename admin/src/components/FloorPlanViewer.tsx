'use client';

import { notify } from '@/components/ui/operation-feedback';
import React, { useMemo, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Canvas } from '@react-three/fiber';
import { MapControls, PerspectiveCamera, OrthographicCamera, Text, Center, Bounds, ContactShadows, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Activity, Download, Loader2, Wand2, Share2, Check, Sparkles } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// @see react-best-practices: rendering-hoist-jsx — 静态常量提升到模块级别
const STYLE_OPTIONS = [
  { id: 'modern', label: '现代简约', icon: '🏠' },
  { id: 'cream', label: '温馨奶油', icon: '🍦' },
  { id: 'chinese', label: '新中式', icon: '🏮' },
  { id: 'luxury', label: '意式轻奢', icon: '💎' },
  { id: 'wabi', label: '原木侘寂', icon: '🪵' },
] as const;

const ROOM_TYPE_OPTIONS = [
  { id: 'living', label: '客厅/客餐厅' },
  { id: 'bedroom', label: '主卧/次卧' },
  { id: 'kitchen', label: '厨房' },
  { id: 'bathroom', label: '卫生间' },
] as const;

interface Opening {
  id: string;
  type: 'DOOR' | 'WINDOW';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  angle?: number;
  wall?: {
    type?: 'rect' | 'polygon';
    side?: string;
    index?: number;
  };
  offset?: number;
  ref?: 'start' | 'end';
}

interface Room {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  height3D?: number;
  polygon?: { x: number; y: number }[];
  polygonClosed?: boolean;
  color?: string;
  openings?: Opening[];
}

interface FloorPlanViewerData {
  _id: string;
  name?: string;
  status?: string;
  source?: 'manual' | 'template' | 'kujiale';
  externalSource?: {
    provider?: string;
    externalId?: string;
    communityName?: string;
    city?: string;
    area?: number;
    layoutLabel?: string;
    previewUrl?: string;
  };
  layoutData?: unknown;
  creator?: {
    openid?: string;
    communityName?: string;
  };
  lead?: {
    _id?: string;
    name?: string;
    wecomGroupId?: string;
  };
}

interface SurveyNode {
  id: string;
  xMm?: number;
  yMm?: number;
}

interface SurveyWall {
  id: string;
  startNodeId?: string;
  endNodeId?: string;
  lengthMm?: number;
  thicknessMm?: number;
  mode?: string;
  measurementSide?: 'left' | 'right';
}

interface SurveyOpening {
  id: string;
  wallId?: string;
  type?: 'door' | 'window';
  centerOffsetMm?: number;
  widthMm?: number;
  heightMm?: number;
  sillHeightMm?: number;
  openDirection?: 'inside' | 'outside';
  modelCategory?: string;
}

interface SurveySpace {
  id: string;
  name?: string;
  wallIds?: string[];
  closed?: boolean;
}

interface SurveyFloor {
  id: string;
  name?: string;
  ceilingHeightMm?: number;
  nodes?: SurveyNode[];
  walls?: SurveyWall[];
  openings?: SurveyOpening[];
  spaces?: SurveySpace[];
}

interface SurveyDraft {
  kind?: string;
  activeFloorId?: string;
  floors?: SurveyFloor[];
}

interface FormalSurveyingLayout {
  version?: number;
  measurementMode?: string;
  surveyGraph?: SurveyDraft;
}

function getFloorPlanSourceLabel(source?: string) {
  if (source === 'kujiale') return '酷家乐户型';
  if (source === 'template') return '户型模板';
  return '手动测绘';
}

function parseLayoutData(layoutData: unknown): unknown {
  if (!layoutData) return null;
  if (typeof layoutData === 'string') {
    try {
      return JSON.parse(layoutData);
    } catch {
      return null;
    }
  }
  return layoutData;
}

function getFormalSurveyingLayout(layoutData: unknown): FormalSurveyingLayout | null {
  const parsed = parseLayoutData(layoutData);
  if (
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    (parsed as FormalSurveyingLayout).version === 4 &&
    (parsed as FormalSurveyingLayout).measurementMode === 'surveying' &&
    (parsed as FormalSurveyingLayout).surveyGraph?.kind === 'survey-wall-graph'
  ) {
    return parsed as FormalSurveyingLayout;
  }
  return null;
}

function getActiveSurveyFloor(draft?: SurveyDraft) {
  const floors = Array.isArray(draft?.floors) ? draft.floors : [];
  return floors.find((floor) => floor.id === draft?.activeFloorId) || floors[0] || null;
}

function getSurveyStats(floor: SurveyFloor | null) {
  return {
    walls: floor?.walls?.length || 0,
    spaces: floor?.spaces?.filter((space) => space.closed).length || 0,
    openings: floor?.openings?.length || 0,
    nodes: floor?.nodes?.length || 0,
  };
}

function getSurveyNodeMap(floor: SurveyFloor | null) {
  const map = new Map<string, Required<Pick<SurveyNode, 'id' | 'xMm' | 'yMm'>>>();
  (floor?.nodes || []).forEach((node) => {
    if (!node.id) return;
    map.set(node.id, {
      id: node.id,
      xMm: Number(node.xMm || 0),
      yMm: Number(node.yMm || 0),
    });
  });
  return map;
}

function getSurveyWallEndpoints(floor: SurveyFloor | null, wall: SurveyWall, nodeMap = getSurveyNodeMap(floor)) {
  const start = wall.startNodeId ? nodeMap.get(wall.startNodeId) : null;
  const end = wall.endNodeId ? nodeMap.get(wall.endNodeId) : null;
  if (!start || !end) return null;
  return { start, end };
}

function getSurveyBounds(floor: SurveyFloor | null) {
  const nodes = floor?.nodes || [];
  if (!nodes.length) return { minX: -500, minY: -500, width: 1000, height: 1000 };
  const xs = nodes.map((node) => Number(node.xMm || 0));
  const ys = nodes.map((node) => Number(node.yMm || 0));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const padding = Math.max(600, Math.max(maxX - minX, maxY - minY) * 0.08);
  return {
    minX: minX - padding,
    minY: minY - padding,
    width: Math.max(1000, maxX - minX + padding * 2),
    height: Math.max(1000, maxY - minY + padding * 2),
  };
}

function getSurveyWallLengthMm(floor: SurveyFloor | null, wall: SurveyWall) {
  const endpoints = getSurveyWallEndpoints(floor, wall);
  if (!endpoints) return Number(wall.lengthMm || 0);
  const dx = endpoints.end.xMm - endpoints.start.xMm;
  const dy = endpoints.end.yMm - endpoints.start.yMm;
  return Number(wall.lengthMm || Math.sqrt(dx * dx + dy * dy));
}

function buildSurveySpacePoints(floor: SurveyFloor | null, space: SurveySpace, nodeMap: ReturnType<typeof getSurveyNodeMap>) {
  const wallIds = Array.isArray(space.wallIds) ? space.wallIds : [];
  const walls = wallIds
    .map((id) => (floor?.walls || []).find((wall) => wall.id === id))
    .filter(Boolean) as SurveyWall[];
  if (!walls.length) return [];

  const first = getSurveyWallEndpoints(floor, walls[0], nodeMap);
  if (!first) return [];
  const points = [first.start, first.end];
  let currentNodeId = walls[0].endNodeId;

  walls.slice(1).forEach((wall) => {
    const endpoints = getSurveyWallEndpoints(floor, wall, nodeMap);
    if (!endpoints) return;
    const next = wall.startNodeId === currentNodeId ? endpoints.end : endpoints.start;
    points.push(next);
    currentNodeId = wall.startNodeId === currentNodeId ? wall.endNodeId : wall.startNodeId;
  });

  if (points.length > 1 && points[0].id === points[points.length - 1].id) points.pop();
  return points;
}

function getSurveyOpeningSegment(floor: SurveyFloor | null, opening: SurveyOpening, nodeMap: ReturnType<typeof getSurveyNodeMap>) {
  const wall = (floor?.walls || []).find((item) => item.id === opening.wallId);
  if (!wall) return null;
  const endpoints = getSurveyWallEndpoints(floor, wall, nodeMap);
  if (!endpoints) return null;
  const dx = endpoints.end.xMm - endpoints.start.xMm;
  const dy = endpoints.end.yMm - endpoints.start.yMm;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (!length) return null;
  const ux = dx / length;
  const uy = dy / length;
  const centerOffset = clampNumber(Number(opening.centerOffsetMm || length / 2), 0, length);
  const halfWidth = clampNumber(Number(opening.widthMm || 0) / 2, 40, length / 2);
  const centerX = endpoints.start.xMm + ux * centerOffset;
  const centerY = endpoints.start.yMm + uy * centerOffset;
  return {
    x1: centerX - ux * halfWidth,
    y1: centerY - uy * halfWidth,
    x2: centerX + ux * halfWidth,
    y2: centerY + uy * halfWidth,
  };
}

type SurveyPoint = { xMm: number; yMm: number };

function getSurveyWallBody(floor: SurveyFloor | null, wall: SurveyWall, nodeMap: ReturnType<typeof getSurveyNodeMap>) {
  const endpoints = getSurveyWallEndpoints(floor, wall, nodeMap);
  if (!endpoints) return null;
  const dx = endpoints.end.xMm - endpoints.start.xMm;
  const dy = endpoints.end.yMm - endpoints.start.yMm;
  const length = Math.hypot(dx, dy);
  if (!length) return null;
  const direction = { x: dx / length, y: dy / length };
  const normal = wall.measurementSide === 'right'
    ? { x: -direction.y, y: direction.x }
    : { x: direction.y, y: -direction.x };
  const thickness = Math.max(80, Number(wall.thicknessMm || 200));
  const outerStart = {
    xMm: endpoints.start.xMm + normal.x * thickness,
    yMm: endpoints.start.yMm + normal.y * thickness,
  };
  const outerEnd = {
    xMm: endpoints.end.xMm + normal.x * thickness,
    yMm: endpoints.end.yMm + normal.y * thickness,
  };
  return { ...endpoints, direction, normal, thickness, outerStart, outerEnd };
}

function getPolygonCentroid(points: SurveyPoint[]) {
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const cross = point.xMm * next.yMm - next.xMm * point.yMm;
    twiceArea += cross;
    x += (point.xMm + next.xMm) * cross;
    y += (point.yMm + next.yMm) * cross;
  });
  if (!twiceArea) return null;
  return { xMm: x / (3 * twiceArea), yMm: y / (3 * twiceArea) };
}

function getSurveySpaceDetails(floor: SurveyFloor | null, space: SurveySpace, nodeMap: ReturnType<typeof getSurveyNodeMap>) {
  const points = buildSurveySpacePoints(floor, space, nodeMap);
  if (points.length < 3) return null;
  const walls = (space.wallIds || [])
    .map((wallId) => (floor?.walls || []).find((wall) => wall.id === wallId))
    .filter(Boolean) as SurveyWall[];
  const horizontalLengths = walls
    .map((wall) => ({ wall, endpoints: getSurveyWallEndpoints(floor, wall, nodeMap) }))
    .filter((entry) => entry.endpoints)
    .filter((entry) => Math.abs(entry.endpoints!.end.xMm - entry.endpoints!.start.xMm) >= Math.abs(entry.endpoints!.end.yMm - entry.endpoints!.start.yMm))
    .map((entry) => getSurveyWallLengthMm(floor, entry.wall));
  const verticalLengths = walls
    .map((wall) => ({ wall, endpoints: getSurveyWallEndpoints(floor, wall, nodeMap) }))
    .filter((entry) => entry.endpoints)
    .filter((entry) => Math.abs(entry.endpoints!.end.xMm - entry.endpoints!.start.xMm) < Math.abs(entry.endpoints!.end.yMm - entry.endpoints!.start.yMm))
    .map((entry) => getSurveyWallLengthMm(floor, entry.wall));
  const xs = points.map((point) => point.xMm);
  const ys = points.map((point) => point.yMm);
  const widthMm = Math.round(horizontalLengths.length ? Math.max(...horizontalLengths) : Math.max(...xs) - Math.min(...xs));
  const heightMm = Math.round(verticalLengths.length ? Math.max(...verticalLengths) : Math.max(...ys) - Math.min(...ys));
  const area = Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.xMm * next.yMm - next.xMm * point.yMm;
  }, 0)) / 2 / 1_000_000;
  return { points, centroid: getPolygonCentroid(points), widthMm, heightMm, area };
}

function getOpeningDimensionSegments(floor: SurveyFloor | null, wall: SurveyWall) {
  const wallLength = getSurveyWallLengthMm(floor, wall);
  if (!wallLength) return [];
  const openings = (floor?.openings || [])
    .filter((opening) => opening.wallId === wall.id && opening.type === 'door')
    .map((opening) => {
      const width = Math.min(wallLength, Math.max(0, Number(opening.widthMm || 0)));
      const center = Math.min(wallLength - width / 2, Math.max(width / 2, Number(opening.centerOffsetMm || wallLength / 2)));
      return { start: center - width / 2, end: center + width / 2 };
    })
    .sort((first, second) => first.start - second.start);
  if (!openings.length) return [];
  const segments: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  openings.forEach((opening) => {
    if (opening.start > cursor) segments.push({ start: cursor, end: opening.start });
    if (opening.end > opening.start) segments.push(opening);
    cursor = Math.max(cursor, opening.end);
  });
  if (cursor < wallLength) segments.push({ start: cursor, end: wallLength });
  return segments.filter((segment) => segment.end - segment.start >= 1);
}

function getOpeningAngleRad(opening: Opening) {
  const angle = Number(opening.angle);
  if (Number.isFinite(angle)) return angle * Math.PI / 180;
  return opening.rotation === 90 ? Math.PI / 2 : 0;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getWallCutStart(opening: Opening, length: number, wallType: string) {
  const width = Number(opening.width || 0);
  const maxStart = Math.max(0, length - width);

  if (opening.wall?.type === 'polygon' && Number.isFinite(Number(opening.offset))) {
    return clampNumber(Number(opening.offset) - width / 2, 0, maxStart);
  }
  if (wallType === 'top') return clampNumber(Number(opening.x || 0) - width / 2, 0, maxStart);
  if (wallType === 'bottom') return clampNumber(length - (Number(opening.x || 0) + width / 2), 0, maxStart);
  if (wallType === 'left') return clampNumber(length - (Number(opening.y || 0) + width / 2), 0, maxStart);
  return clampNumber(Number(opening.y || 0) - width / 2, 0, maxStart);
}

function RoomObject({ room, is3D }: { room: Room; is3D: boolean }) {
  const rX = room.x || 0;
  const rY = room.y || 0;
  const rWidth = room.width || 100;
  const rHeight = room.height || 100;
  
  // 3D walls are tall, 2D walls are just extruded a tiny bit to have a solid top face
  const wallHeight = is3D ? (room.height3D || 28) : 2; 
  const wallThickness = 2;

  const { topWall, bottomWall, leftWall, rightWall, polygonFloor, polygonWalls } = useMemo(() => {
    const buildWallShape = (length: number, height: number, openings: Opening[], type: string) => {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(length, 0);
      shape.lineTo(length, height);
      shape.lineTo(0, height);
      shape.lineTo(0, 0);

      openings.forEach(op => {
        const ox = getWallCutStart(op, length, type);

        const ow = op.width;
        let oh = op.type === 'DOOR' ? 20 : 12;
        let oy = op.type === 'DOOR' ? 0 : 9;

        // Make hole span the entire height in 2D so we see it cut through
        if (!is3D) {
          oh = height;
          oy = 0;
        }

        const hole = new THREE.Path();
        hole.moveTo(ox, oy);
        hole.lineTo(ox + ow, oy);
        hole.lineTo(ox + ow, oy + oh);
        hole.lineTo(ox, oy + oh);
        hole.lineTo(ox, oy);
        shape.holes.push(hole);
      });
      return shape;
    };

    let polyFloor = null;
    const polyWalls: { shape: THREE.Shape, pos: [number, number, number], rot: [number, number, number] }[] = [];

    if (room.polygon && room.polygon.length >= 3) {
      const shape = new THREE.Shape();
      const pts = room.polygon;
      // Invert Y to align with -90deg X rotation
      shape.moveTo(pts[0].x - rWidth/2, -(pts[0].y - rHeight/2));
      for (let i = 1; i < pts.length; i++) {
        shape.lineTo(pts[i].x - rWidth/2, -(pts[i].y - rHeight/2));
      }
      if (room.polygonClosed) shape.closePath();
      polyFloor = shape;

      for (let i = 0; i < pts.length; i++) {
        const p1 = pts[i];
        const p2 = pts[(i + 1) % pts.length];
        
        if (i === pts.length - 1 && !room.polygonClosed) continue;

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);

        const wallOpenings = (room.openings || []).filter(op => op.wall?.type === 'polygon' && Number(op.wall.index) === i);
        const wallShape = buildWallShape(length, wallHeight, wallOpenings, 'polygon');

        polyWalls.push({
          shape: wallShape,
          pos: [p1.x - rWidth/2, 0, p1.y - rHeight/2],
          rot: [0, -angle, 0]
        });
      }
    }

    const topOpenings = (room.openings || []).filter(op => op.rotation === 0 && op.y < rHeight / 2);
    const bottomOpenings = (room.openings || []).filter(op => op.rotation === 0 && op.y >= rHeight / 2);
    const leftOpenings = (room.openings || []).filter(op => op.rotation === 90 && op.x < rWidth / 2);
    const rightOpenings = (room.openings || []).filter(op => op.rotation === 90 && op.x >= rWidth / 2);

    return {
      topWall: buildWallShape(rWidth, wallHeight, topOpenings, 'top'),
      bottomWall: buildWallShape(rWidth, wallHeight, bottomOpenings, 'bottom'),
      leftWall: buildWallShape(rHeight, wallHeight, leftOpenings, 'left'),
      rightWall: buildWallShape(rHeight, wallHeight, rightOpenings, 'right'),
      polygonFloor: polyFloor,
      polygonWalls: polyWalls
    };
  }, [room, rWidth, rHeight, wallHeight, is3D]);

  const midpoints = useMemo(() => {
    const mids: { pos: [number, number, number], val: string, rot: [number, number, number] }[] = [];
    if (room.polygon && room.polygon.length >= 3 && room.polygonClosed) {
      const pts = [...room.polygon, room.polygon[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const p1 = pts[i];
        const p2 = pts[i+1];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < 2) continue;
        
        const cx = (p1.x + p2.x)/2 - rWidth/2;
        const cz = (p1.y + p2.y)/2 - rHeight/2;
        const nx = -dy / dist;
        const nz = dx / dist;

        mids.push({
          pos: [cx + nx * 6, 1, cz + nz * 6],
          val: (dist / 10).toFixed(2) + 'm',
          rot: [-Math.PI/2, 0, -Math.atan2(dy, dx)]
        });
      }
    } else {
      mids.push({ pos: [0, 1, -rHeight/2 - 6], val: (rWidth / 10).toFixed(2) + 'm', rot: [-Math.PI/2, 0, 0] });
      mids.push({ pos: [0, 1, rHeight/2 + 6], val: (rWidth / 10).toFixed(2) + 'm', rot: [-Math.PI/2, 0, 0] });
      mids.push({ pos: [-rWidth/2 - 6, 1, 0], val: (rHeight / 10).toFixed(2) + 'm', rot: [-Math.PI/2, 0, Math.PI/2] });
      mids.push({ pos: [rWidth/2 + 6, 1, 0], val: (rHeight / 10).toFixed(2) + 'm', rot: [-Math.PI/2, 0, -Math.PI/2] });
    }
    return mids;
  }, [room, rWidth, rHeight]);

  const wallColor = is3D ? "#ffffff" : "#1f2937"; // Very dark walls for 2D CAD look

  return (
    <group position={[rX + rWidth / 2, 0, rY + rHeight / 2]}>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow={is3D}>
        {polygonFloor ? (
          <shapeGeometry args={[polygonFloor]} />
        ) : (
          <planeGeometry args={[rWidth, rHeight]} />
        )}
        {is3D ? (
          <meshStandardMaterial color={room.color || '#e0e0e0'} side={THREE.DoubleSide} />
        ) : (
          <meshBasicMaterial color={room.color || '#f3f4f6'} side={THREE.DoubleSide} />
        )}
      </mesh>

      {/* Walls */}
      {polygonWalls && polygonWalls.length > 0 ? (
        polygonWalls.map((wall, idx) => (
          <mesh key={`pwall-${idx}`} position={wall.pos} rotation={wall.rot} castShadow={is3D} receiveShadow={is3D}>
            <extrudeGeometry args={[wall.shape, { depth: wallThickness, bevelEnabled: false }]} />
            {is3D ? <meshStandardMaterial color={wallColor} /> : <meshBasicMaterial color={wallColor} />}
          </mesh>
        ))
      ) : (
        <>
          <mesh position={[-rWidth/2, 0, -rHeight/2]} castShadow={is3D} receiveShadow={is3D}>
            <extrudeGeometry args={[topWall, { depth: wallThickness, bevelEnabled: false }]} />
            {is3D ? <meshStandardMaterial color={wallColor} /> : <meshBasicMaterial color={wallColor} />}
          </mesh>
          <mesh position={[rWidth/2, 0, rHeight/2]} rotation={[0, Math.PI, 0]} castShadow={is3D} receiveShadow={is3D}>
            <extrudeGeometry args={[bottomWall, { depth: wallThickness, bevelEnabled: false }]} />
            {is3D ? <meshStandardMaterial color={wallColor} /> : <meshBasicMaterial color={wallColor} />}
          </mesh>
          <mesh position={[-rWidth/2, 0, rHeight/2]} rotation={[0, Math.PI/2, 0]} castShadow={is3D} receiveShadow={is3D}>
            <extrudeGeometry args={[leftWall, { depth: wallThickness, bevelEnabled: false }]} />
            {is3D ? <meshStandardMaterial color={wallColor} /> : <meshBasicMaterial color={wallColor} />}
          </mesh>
          <mesh position={[rWidth/2, 0, -rHeight/2]} rotation={[0, -Math.PI/2, 0]} castShadow={is3D} receiveShadow={is3D}>
            <extrudeGeometry args={[rightWall, { depth: wallThickness, bevelEnabled: false }]} />
            {is3D ? <meshStandardMaterial color={wallColor} /> : <meshBasicMaterial color={wallColor} />}
          </mesh>
        </>
      )}

      {/* Openings (Doors / Windows) */}
      {(room.openings || []).map((op, i) => {
         const isPolygonOpening = op.wall?.type === 'polygon';
         const isTop = op.rotation === 0 && op.y < rHeight / 2;
         const isBottom = op.rotation === 0 && op.y >= rHeight / 2;
         const isLeft = op.rotation === 90 && op.x < rWidth / 2;

         let opX = 0; let opZ = 0;
         let opW = op.width; let opD = wallThickness + 2; 

         if (isPolygonOpening) {
             opX = op.x - rWidth/2;
             opZ = op.y - rHeight/2;
         } else if (isTop || isBottom) {
             opX = -rWidth/2 + op.x;
             opZ = isTop ? (-rHeight/2 + wallThickness/2) : (rHeight/2 - wallThickness/2);
         } else {
             opZ = -rHeight/2 + op.y;
             opX = isLeft ? (-rWidth/2 + wallThickness/2) : (rWidth/2 - wallThickness/2);
             opW = wallThickness + 2; 
             opD = op.width;
         }

         const color = op.type === 'DOOR' ? '#f59e0b' : '#3b82f6'; // Amber = door, Blue = window
         const h = is3D ? (op.type === 'DOOR' ? 20 : 12) : 2.5;
         const yPos = is3D ? (op.type === 'DOOR' ? h/2 : 9 + h/2) : 1.25;

         return (
            <mesh key={op.id || i} position={[opX, yPos, opZ]} rotation={isPolygonOpening ? [0, -getOpeningAngleRad(op), 0] : undefined}>
               <boxGeometry args={[opW, h, opD]} />
               {is3D ? (
                 <meshStandardMaterial color={color} opacity={0.8} transparent />
               ) : (
                 <meshBasicMaterial color={color} opacity={0.8} transparent />
               )}
               {!is3D && (
                 <Text position={[0, 1.5, 0]} fontSize={5} color="#ffffff" rotation={[-Math.PI/2, 0, 0]} renderOrder={1}>
                   {op.type === 'DOOR' ? '门' : '窗'}
                 </Text>
               )}
            </mesh>
         )
      })}

      {/* Dimensions (Only in 2D Mode) */}
      {!is3D && midpoints.map((m, idx) => (
         <Text
           key={`mid-${idx}`}
           position={[m.pos[0], 2, m.pos[2]]}
           fontSize={5}
           color="#111827"
           anchorX="center"
           anchorY="middle"
           rotation={m.rot}
         >
           {m.val}
         </Text>
      ))}

      <Text
        position={[0, is3D ? wallHeight + 5 : 3, 0]}
        fontSize={is3D ? 10 : 8}
        color={is3D ? "#000" : "#111827"}
        fontWeight="bold"
        rotation={[-Math.PI / 2, 0, 0]}
      >
        {room.name || '未命名房间'}
      </Text>
    </group>
  );
}

function Scene2D({ rooms }: { rooms: Room[] }) {
  return (
    <Suspense fallback={null}>
      <OrthographicCamera makeDefault position={[0, 1000, 0.01]} zoom={4} near={0.1} far={5000} />
      <MapControls 
        enableRotate={false} 
        makeDefault 
        dampingFactor={0.05} 
        mouseButtons={{
          LEFT: THREE.MOUSE.PAN,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN
        }}
        touches={{
          ONE: THREE.TOUCH.PAN,
          TWO: THREE.TOUCH.DOLLY_PAN
        }}
      />
      
      {/* Basic ambient lighting just in case, though we use Basic materials */}
      <ambientLight intensity={1} />
      
      <gridHelper args={[2000, 50, '#e5e7eb', '#f1f1f1']} position={[0, -0.1, 0]} />

      <Bounds fit clip observe margin={1.2}>
        <Center top>
           {rooms.map((room, idx) => (
             <RoomObject key={room.id || idx} room={room} is3D={false} />
           ))}
        </Center>
      </Bounds>
    </Suspense>
  );
}

function Scene3D({ rooms }: { rooms: Room[] }) {
  return (
    <Suspense fallback={null}>
      <PerspectiveCamera makeDefault position={[0, 600, 600]} fov={40} />
      <OrbitControls 
        enableRotate={true} 
        makeDefault 
        dampingFactor={0.05} 
      />
      
      <ambientLight intensity={1.2} />
      <directionalLight position={[50, 100, 50]} intensity={1.5} castShadow />
      <directionalLight position={[-50, 100, -50]} intensity={0.5} />
      
      <gridHelper args={[2000, 50, '#e5e7eb', '#f1f1f1']} position={[0, -0.1, 0]} />

      <Bounds fit clip observe margin={1.2}>
        <Center top>
           {rooms.map((room, idx) => (
             <RoomObject key={room.id || idx} room={room} is3D={true} />
           ))}
        </Center>
      </Bounds>

      <ContactShadows opacity={0.3} scale={2000} blur={2} far={20} color="#000" />
    </Suspense>
  );
}

function SurveyPlanViewer({ planData, layoutData }: { planData: FloorPlanViewerData; layoutData: FormalSurveyingLayout }) {
  const floor = getActiveSurveyFloor(layoutData.surveyGraph);
  const nodeMap = useMemo(() => getSurveyNodeMap(floor), [floor]);
  const bounds = useMemo(() => getSurveyBounds(floor), [floor]);
  const stats = useMemo(() => getSurveyStats(floor), [floor]);
  const wallBodies = useMemo(
    () => (floor?.walls || []).map((wall) => ({ wall, body: getSurveyWallBody(floor, wall, nodeMap) })).filter((item) => item.body),
    [floor, nodeMap],
  );
  const spaceDetails = useMemo(
    () => (floor?.spaces || []).filter((space) => space.closed).map((space) => ({ space, detail: getSurveySpaceDetails(floor, space, nodeMap) })).filter((item) => item.detail),
    [floor, nodeMap],
  );
  const closedWallOutsideSigns = useMemo(() => {
    const signs = new Map<string, number>();
    spaceDetails.forEach(({ space, detail }) => {
      const centroid = detail?.centroid;
      if (!centroid) return;
      (space.wallIds || []).forEach((wallId) => {
        const wall = (floor?.walls || []).find((item) => item.id === wallId);
        const body = wall ? getSurveyWallBody(floor, wall, nodeMap) : null;
        if (!body || signs.has(wallId)) return;
        const midpoint = {
          xMm: (body.start.xMm + body.end.xMm) / 2,
          yMm: (body.start.yMm + body.end.yMm) / 2,
        };
        const localY = { x: -body.direction.y, y: body.direction.x };
        const centroidOffset = (centroid.xMm - midpoint.xMm) * localY.x + (centroid.yMm - midpoint.yMm) * localY.y;
        signs.set(wallId, centroidOffset >= 0 ? -1 : 1);
      });
    });
    return signs;
  }, [floor, nodeMap, spaceDetails]);
  const viewBox = `${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`;
  const drawingScale = Math.max(bounds.width, bounds.height);
  const dimensionOffset = Math.max(160, drawingScale * 0.035);
  const dimensionTextSize = Math.max(76, Math.min(130, drawingScale / 40));
  const roomTitleSize = Math.max(72, Math.min(120, drawingScale / 42));
  const roomDetailSize = Math.max(54, Math.min(86, drawingScale / 56));

  return (
    <div className="flex h-screen flex-col bg-[#f8f8f8] text-neutral-950">
      <div className="z-20 flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          <BackButton fallbackPath={planData?.creator?.openid ? `/users/${planData.creator.openid}` : "/leads"} />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight">{planData?.name || '测量户型图'}</h2>
              <span className="rounded-md bg-orange-50 px-2 py-1 text-[11px] font-bold text-orange-700">正式测量</span>
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              {planData.lead?.name ? `客户: ${planData.lead.name} · ` : ''}
              与小程序测量画布一致的只读平面展示
            </p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            ['墙体', stats.walls],
            ['空间', stats.spaces],
            ['门窗', stats.openings],
            ['节点', stats.nodes],
          ].map(([label, value]) => (
            <div key={label} className="min-w-16 rounded-lg bg-neutral-100 px-3 py-2">
              <div className="text-base font-black">{value}</div>
              <div className="text-[10px] font-bold text-neutral-500">{label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden p-6">
        <div className="h-full overflow-hidden rounded-2xl bg-[#f8f8f8] shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_24px_60px_rgba(15,23,42,0.08)]">
          <svg className="h-full w-full" viewBox={viewBox} role="img" aria-label="测量户型图">
            <defs>
              <pattern id="survey-grid-minor" width="500" height="500" patternUnits="userSpaceOnUse">
                <path d="M 500 0 L 0 0 0 500" fill="none" stroke="rgba(141,148,158,0.25)" strokeWidth="8" />
              </pattern>
              <pattern id="survey-grid-major" width="2500" height="2500" patternUnits="userSpaceOnUse">
                <path d="M 2500 0 L 0 0 0 2500" fill="none" stroke="rgba(111,118,128,0.25)" strokeWidth="12" />
              </pattern>
            </defs>
            <rect x={bounds.minX} y={bounds.minY} width={bounds.width} height={bounds.height} fill="#f8f8f8" />
            <rect x={bounds.minX} y={bounds.minY} width={bounds.width} height={bounds.height} fill="url(#survey-grid-minor)" />
            <rect x={bounds.minX} y={bounds.minY} width={bounds.width} height={bounds.height} fill="url(#survey-grid-major)" />

            {spaceDetails.map(({ space, detail }) => {
              if (!detail) return null;
              return (
                <polygon
                  key={space.id}
                  points={detail.points.map((point) => `${point.xMm},${point.yMm}`).join(' ')}
                  fill="rgba(209,209,207,0.86)"
                />
              );
            })}

            {wallBodies.map(({ wall, body }) => {
              if (!body) return null;
              return (
                <g key={wall.id}>
                  <polygon
                    points={`${body.start.xMm},${body.start.yMm} ${body.end.xMm},${body.end.yMm} ${body.outerEnd.xMm},${body.outerEnd.yMm} ${body.outerStart.xMm},${body.outerStart.yMm}`}
                    fill="rgba(142,142,140,0.98)"
                  />
                </g>
              );
            })}

            {wallBodies.map(({ wall, body }) => {
              if (!body) return null;
              return (
                <g key={`${wall.id}-outline`} fill="none" stroke="#1f1f1f" strokeWidth="20" strokeLinecap="butt" strokeLinejoin="miter">
                  <line x1={body.start.xMm} y1={body.start.yMm} x2={body.end.xMm} y2={body.end.yMm} />
                  <line x1={body.outerStart.xMm} y1={body.outerStart.yMm} x2={body.outerEnd.xMm} y2={body.outerEnd.yMm} />
                  <line x1={body.start.xMm} y1={body.start.yMm} x2={body.outerStart.xMm} y2={body.outerStart.yMm} />
                  <line x1={body.end.xMm} y1={body.end.yMm} x2={body.outerEnd.xMm} y2={body.outerEnd.yMm} />
                </g>
              );
            })}

            {(floor?.openings || []).map((opening) => {
              const segment = getSurveyOpeningSegment(floor, opening, nodeMap);
              const wall = (floor?.walls || []).find((item) => item.id === opening.wallId);
              const body = wall ? getSurveyWallBody(floor, wall, nodeMap) : null;
              if (!segment || !body) return null;
              const isDoor = opening.type === 'door';
              const angle = Math.atan2(body.direction.y, body.direction.x) * 180 / Math.PI;
              const width = Math.max(1, Number(opening.widthMm || 0));
              const centerOffset = Number(opening.centerOffsetMm || getSurveyWallLengthMm(floor, wall!) / 2);
              const hingeAtEnd = opening.openDirection === 'outside';
              const hingeX = hingeAtEnd ? centerOffset + width / 2 : centerOffset - width / 2;
              const swingSign = (wall?.measurementSide === 'left' ? -1 : 1) * (opening.openDirection === 'outside' ? -1 : 1);
              const wallBodySign = wall?.measurementSide === 'left' ? -1 : 1;
              const railOffset = Math.max(36, body.thickness * 0.24);
              const windowCenterY = wallBodySign * body.thickness / 2;
              return (
                <g key={opening.id} transform={`translate(${body.start.xMm} ${body.start.yMm}) rotate(${angle})`}>
                  <line
                    x1={centerOffset - width / 2}
                    y1={wallBodySign * body.thickness * 0.55}
                    x2={centerOffset + width / 2}
                    y2={wallBodySign * body.thickness * 0.55}
                    stroke="#f8f8f8"
                    strokeWidth={body.thickness + 46}
                    strokeLinecap="butt"
                  />
                  {isDoor ? (
                    <g fill="none" stroke="#111827" strokeWidth="18" strokeLinecap="butt">
                      <line x1={hingeX} y1="0" x2={hingeX} y2={swingSign * width} />
                      <path d={`M ${hingeX} ${swingSign * width} A ${width} ${width} 0 0 ${swingSign > 0 ? 0 : 1} ${hingeAtEnd ? centerOffset - width / 2 : centerOffset + width / 2} 0`} />
                    </g>
                  ) : (
                    <g fill="none" stroke="#2f2f2f" strokeWidth="14" strokeLinecap="butt">
                      <line x1={centerOffset - width / 2} y1={windowCenterY - railOffset} x2={centerOffset + width / 2} y2={windowCenterY - railOffset} />
                      <line x1={centerOffset - width / 2} y1={windowCenterY} x2={centerOffset + width / 2} y2={windowCenterY} />
                      <line x1={centerOffset - width / 2} y1={windowCenterY + railOffset} x2={centerOffset + width / 2} y2={windowCenterY + railOffset} />
                      <line x1={centerOffset - width / 2} y1={windowCenterY - railOffset} x2={centerOffset - width / 2} y2={windowCenterY + railOffset} />
                      <line x1={centerOffset + width / 2} y1={windowCenterY - railOffset} x2={centerOffset + width / 2} y2={windowCenterY + railOffset} />
                      {width >= 900 && <line x1={centerOffset} y1={windowCenterY - railOffset} x2={centerOffset} y2={windowCenterY + railOffset} />}
                    </g>
                  )}
                </g>
              );
            })}

            {wallBodies.map(({ wall, body }) => {
              if (!body) return null;
              const dimensionSign = closedWallOutsideSigns.get(wall.id) || (wall.measurementSide === 'left' ? -1 : 1);
              const offset = dimensionSign * (body.thickness + dimensionOffset);
              const segmentOffset = dimensionSign * (body.thickness + dimensionOffset * 0.42);
              const wallLength = Math.round(getSurveyWallLengthMm(floor, wall));
              const openingSegments = getOpeningDimensionSegments(floor, wall);
              const outerLength = Math.round(Math.hypot(body.outerEnd.xMm - body.outerStart.xMm, body.outerEnd.yMm - body.outerStart.yMm));
              const wholeDimensions = openingSegments.length
                ? [{ label: wallLength, y: offset }]
                : [{ label: wallLength, y: offset }, { label: outerLength, y: offset + dimensionSign * dimensionTextSize * 1.45 }];
              const isUpsideDown = body.direction.x < 0;
              return (
                <g key={`${wall.id}-dimensions`} transform={`translate(${body.start.xMm} ${body.start.yMm}) rotate(${Math.atan2(body.direction.y, body.direction.x) * 180 / Math.PI})`} fill="none" stroke="#333" strokeWidth="12" strokeLinecap="butt">
                  {openingSegments.map((segment, index) => {
                    const label = Math.round(segment.end - segment.start);
                    return (
                      <g key={`${wall.id}-opening-segment-${index}`}>
                        <line x1={segment.start} y1="0" x2={segment.start} y2={segmentOffset} />
                        <line x1={segment.end} y1="0" x2={segment.end} y2={segmentOffset} />
                        <line x1={segment.start} y1={segmentOffset} x2={segment.end} y2={segmentOffset} />
                        <path d={`M ${segment.start} ${segmentOffset} l ${dimensionTextSize * 0.32} ${-dimensionTextSize * 0.2} v ${dimensionTextSize * 0.4} z`} fill="#333" stroke="none" />
                        <path d={`M ${segment.end} ${segmentOffset} l ${-dimensionTextSize * 0.32} ${-dimensionTextSize * 0.2} v ${dimensionTextSize * 0.4} z`} fill="#333" stroke="none" />
                        <text x={(segment.start + segment.end) / 2} y={segmentOffset} fill="#111" stroke="#f8f8f8" strokeWidth={dimensionTextSize * 0.22} paintOrder="stroke" textAnchor="middle" dominantBaseline="middle" fontSize={dimensionTextSize * 0.84} fontWeight="600" transform={isUpsideDown ? `rotate(180 ${(segment.start + segment.end) / 2} ${segmentOffset})` : undefined}>{label}</text>
                      </g>
                    );
                  })}
                  {wholeDimensions.map(({ label, y }) => (
                    <g key={`${wall.id}-${label}-${y}`}>
                      <line x1="0" y1="0" x2="0" y2={y} />
                      <line x1={wallLength} y1="0" x2={wallLength} y2={y} />
                      <line x1="0" y1={y} x2={wallLength} y2={y} />
                      <path d={`M 0 ${y} l ${dimensionTextSize * 0.42} ${-dimensionTextSize * 0.26} v ${dimensionTextSize * 0.52} z`} fill="#333" stroke="none" />
                      <path d={`M ${wallLength} ${y} l ${-dimensionTextSize * 0.42} ${-dimensionTextSize * 0.26} v ${dimensionTextSize * 0.52} z`} fill="#333" stroke="none" />
                      <text x={wallLength / 2} y={y} fill="#111" stroke="#f8f8f8" strokeWidth={dimensionTextSize * 0.25} paintOrder="stroke" textAnchor="middle" dominantBaseline="middle" fontSize={dimensionTextSize} fontWeight="600" transform={isUpsideDown ? `rotate(180 ${wallLength / 2} ${y})` : undefined}>{label}</text>
                    </g>
                  ))}
                </g>
              );
            })}

            {spaceDetails.map(({ space, detail }, index) => {
              if (!detail?.centroid) return null;
              return (
                <g key={`${space.id}-detail`} transform={`translate(${detail.centroid.xMm} ${detail.centroid.yMm})`} textAnchor="middle">
                  <text y={-roomDetailSize * 1.35} fontSize={roomTitleSize} fontWeight="700" fill="#111">{space.name || `房间${index + 1}`}</text>
                  <text y={0} fontSize={roomDetailSize} fill="#333">H={Math.round(Number(floor?.ceilingHeightMm || 2800))}mm</text>
                  <text y={roomDetailSize * 1.2} fontSize={roomDetailSize} fill="#333">S≈{detail.area.toFixed(1)}m²</text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}

export default function FloorPlanViewer({ planData }: { planData: FloorPlanViewerData }) {
  const [is3D, setIs3D] = useState(false);
  
  const [isExporting, setIsExporting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [shareSuccess, setShareSuccess] = useState(false);
  const [showAIDialog, setShowAIDialog] = useState(false);
  const [aiPreset, setAiPreset] = useState({
    style: 'modern',
    roomType: 'living'
  });
  
  // STYLE_OPTIONS and ROOM_TYPE_OPTIONS are now hoisted to module level

  const lead = planData.lead;

  const handleExportDXF = async () => {
    setIsExporting(true);
    try {
      const res = await fetch(`/api/floorplans/${planData._id}/export/dxf`);
      if (!res.ok) throw new Error('Export failed');
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `FloorPlan_${planData.name || planData._id}.dxf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      notify.success('CAD 文件已导出');
    } catch (err) {
      console.error(err);
      notify.fromAlert('导出 CAD 失败，请稍后重试');
    } finally {
      setIsExporting(false);
    }
  };

  const handleAIGenerate = async () => {
    setIsGenerating(true);
    setShowAIDialog(false);
    
    // Simulate AI generation with presets
    console.log(`[AI Engine] Generating ${aiPreset.style} design for ${aiPreset.roomType}`);
    
    try {
      // In real implementation, this would call /api/inspirations/generate
      await new Promise(resolve => setTimeout(resolve, 3000));
      notify.fromAlert(`AI ${STYLE_OPTIONS.find(s => s.id === aiPreset.style)?.label}方案已生成！已同步至“装修灵感库”。`);
    } catch {
      notify.fromAlert('AI 生成失败，请检查网络后重试');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleShareToGroup = async () => {
    if (!lead?._id || !lead?.wecomGroupId) {
      notify.fromAlert('该线索尚未关联企微群，请先在地推环节完成拉群。');
      return;
    }
    
    setIsSharing(true);
    try {
      const styleLabel = STYLE_OPTIONS.find(s => s.id === aiPreset.style)?.label || '现代简约';
      const roomLabel = ROOM_TYPE_OPTIONS.find(r => r.id === aiPreset.roomType)?.label || '空间';
      
      const res = await fetch(`/api/leads/${lead._id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `【AI设计方案】设计师已为您生成了最新的“${styleLabel}”风格的${roomLabel}效果预览，请进入小程序查看详情。`
        })
      });
      
      const data = await res.json();
      if (data.success) {
        setShareSuccess(true);
        notify.success('已同步至企微群');
        setTimeout(() => setShareSuccess(false), 3000);
      } else {
        notify.fromAlert('同步失败: ' + (data.error || '接口调用异常'));
      }
    } catch (err) {
      console.error(err);
      notify.fromAlert('网络异常，同步企微失败');
    } finally {
      setIsSharing(false);
    }
  };

  const searchParams = useSearchParams();
  const roomIdParam = searchParams.get('roomId');
  const layoutData = planData.layoutData;
  const surveyLayout = useMemo(() => getFormalSurveyingLayout(layoutData), [layoutData]);

  const allRooms: Room[] = useMemo(() => {
    if (!layoutData) return [];
    const data = parseLayoutData(layoutData);
    if (Array.isArray(data)) return data as Room[];
    if (
      data &&
      typeof data === 'object' &&
      'rooms' in data &&
      Array.isArray((data as { rooms?: Room[] }).rooms)
    ) {
      return (data as { rooms?: Room[] }).rooms || [];
    }
    return [];
  }, [layoutData]);

  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const activeRoomId = useMemo(() => {
    if (selectedRoomId && allRooms.some((room) => room.id === selectedRoomId)) return selectedRoomId;
    if (roomIdParam && allRooms.some((room) => room.id === roomIdParam)) return roomIdParam;
    return allRooms[0]?.id || null;
  }, [selectedRoomId, roomIdParam, allRooms]);

  const roomsToRender: Room[] = useMemo(() => {
    if (!activeRoomId) return [];
    return allRooms.filter(room => room.id === activeRoomId);
  }, [allRooms, activeRoomId]);

  if (surveyLayout) {
    return <SurveyPlanViewer planData={planData} layoutData={surveyLayout} />;
  }

  return (
    <div className="flex flex-col h-screen bg-[#f1f1f1]">
      {/* Header */}
      <div className="bg-white/90 backdrop-blur-md px-6 py-4 border-b border-gray-200 flex justify-between items-center z-50">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4">
            <BackButton fallbackPath={planData?.creator?.openid ? `/users/${planData.creator.openid}` : "/"} />
            <div>
              <h2 className="text-lg font-bold tracking-tight">{planData?.name || '户型详情'}</h2>
              <p className="text-xs text-gray-400">
                 {lead?.name ? `客户: ${lead.name} · ` : ''}
                 {planData?.externalSource?.communityName || planData?.creator?.communityName || '私有户型'}
                 {' · '}
                 {getFloorPlanSourceLabel(planData?.source)}
              </p>
            </div>
          </div>
          
          {allRooms.length > 1 && (
            <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-lg">
              {allRooms.map((room) => (
                <button
                  key={room.id}
                  onClick={() => setSelectedRoomId(room.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    activeRoomId === room.id 
                      ? 'bg-white text-gray-900 shadow-sm' 
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {room.name || '未命名房间'}
                </button>
              ))}
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-4">
          {lead && (
            <div className="flex items-center gap-2 mr-4">
              <Dialog open={showAIDialog} onOpenChange={setShowAIDialog}>
                <DialogTrigger asChild>
                  <Button 
                    variant="ghost" 
                    disabled={isGenerating}
                    className="rounded-xl flex items-center gap-2 h-10 px-4 bg-purple-50 text-purple-700 hover:bg-purple-100 transition-all font-bold text-xs"
                  >
                    {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                    {isGenerating ? 'AI 设计中...' : 'AI 风格生成'}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md rounded-[32px] p-0 overflow-hidden border-none shadow-2xl">
                  <DialogHeader className="p-8 pb-6 bg-muted/20 border-b">
                    <DialogTitle className="text-xl font-bold flex items-center gap-2">
                      <Sparkles className="text-purple-500" size={20} />
                      AI 智能风格预览
                    </DialogTitle>
                    <DialogDescription>
                      选择目标设计风格，系统将基于当前户型生成 3D 渲染方案
                    </DialogDescription>
                  </DialogHeader>
                  
                  <div className="p-8 space-y-6">
                    <div className="space-y-3">
                      <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">目标设计风格</Label>
                      <div className="grid grid-cols-2 gap-3">
                        {STYLE_OPTIONS.map((style) => (
                          <div 
                            key={style.id}
                            onClick={() => setAiPreset({...aiPreset, style: style.id})}
                            className={cn(
                              "flex items-center gap-3 p-4 rounded-2xl cursor-pointer transition-all border-2",
                              aiPreset.style === style.id 
                                ? "bg-purple-50 border-purple-500 shadow-sm" 
                                : "bg-white border-gray-100 hover:border-gray-200"
                            )}
                          >
                            <span className="text-xl">{style.icon}</span>
                            <span className={cn(
                              "text-sm font-bold",
                              aiPreset.style === style.id ? "text-purple-700" : "text-gray-600"
                            )}>{style.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">空间场景</Label>
                      <Select 
                        value={aiPreset.roomType} 
                        onValueChange={(val) => setAiPreset({...aiPreset, roomType: val})}
                      >
                        <SelectTrigger className="h-12 rounded-2xl bg-muted/30 border-none focus:ring-purple-500 font-bold">
                          <SelectValue placeholder="选择空间" />
                        </SelectTrigger>
                        <SelectContent className="rounded-2xl border-none shadow-xl">
                          {ROOM_TYPE_OPTIONS.map(room => (
                            <SelectItem key={room.id} value={room.id} className="rounded-xl font-medium">
                              {room.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <DialogFooter className="p-8 pt-4 bg-muted/10 border-t">
                    <Button 
                      variant="ghost" 
                      onClick={() => setShowAIDialog(false)}
                      className="rounded-2xl h-12 px-6"
                    >
                      取消
                    </Button>
                    <Button 
                      onClick={handleAIGenerate}
                      className="rounded-2xl h-12 px-10 bg-purple-600 hover:bg-purple-700 text-white font-bold shadow-lg shadow-purple-200"
                    >
                      开始生成方案
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Button 
                variant="ghost" 
                onClick={handleShareToGroup}
                disabled={isSharing || !lead.wecomGroupId}
                className={cn(
                  "rounded-xl flex items-center gap-2 h-10 px-4 transition-all font-bold text-xs",
                  shareSuccess ? "bg-green-500 text-white" : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                )}
              >
                {isSharing ? <Loader2 size={16} className="animate-spin" /> : (shareSuccess ? <Check size={16} /> : <Share2 size={16} />)}
                {shareSuccess ? '已发送至群' : '同步至企微群'}
              </Button>
            </div>
          )}

          <Button 
            variant="outline" 
            onClick={handleExportDXF}
            disabled={isExporting}
            className="rounded-xl flex items-center gap-2 h-10 px-4 border-gray-200 hover:bg-gray-50 transition-all font-bold text-xs"
          >
            {isExporting ? <Loader2 size={16} className="animate-spin text-primary" /> : <Download size={16} className="text-primary" />}
            {isExporting ? '生成中...' : '导出 CAD (.dxf)'}
          </Button>

          <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-xl">
             <button 
               onClick={() => setIs3D(false)}
               className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${!is3D ? 'bg-white shadow-md text-black' : 'text-gray-400'}`}
             >
               2D 平面
             </button>
             <button 
               onClick={() => setIs3D(true)}
               className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${is3D ? 'bg-white shadow-md text-black' : 'text-gray-400'}`}
             >
               3D 视角
             </button>
          </div>
        </div>
      </div>

      {/* Main Viewport */}
      <div className="flex-1 relative overflow-hidden">
        {is3D ? (
          <Canvas shadows gl={{ antialias: true }}>
            <Scene3D rooms={roomsToRender} />
          </Canvas>
        ) : (
          <Canvas gl={{ antialias: true }}>
            <Scene2D rooms={roomsToRender} />
          </Canvas>
        )}

        {/* Debug Panel (Mobile/Small) */}
        <div className="absolute top-4 right-4 z-40 pointer-events-none">
           <div className="bg-black/90 text-white p-4 rounded-2xl shadow-2xl font-mono text-[10px] space-y-2 border border-white/10 opacity-80 hover:opacity-100 transition-opacity">
              <div className="flex items-center gap-2 text-green-400 border-b border-white/10 pb-2">
                 <Activity size={14} />
                 <span className="font-bold underline">ENGINE STATUS</span>
              </div>
              <p><span className="text-blue-400">Rooms:</span> {roomsToRender.length} / {allRooms.length}</p>
              <p><span className="text-blue-400">View:</span> {is3D ? 'PERSPECTIVE' : 'ORTHO'}</p>
              <p><span className="text-blue-400">Data Check:</span> {planData?.layoutData ? 'FOUND' : 'MISSING'}</p>
              <div className="pt-2 text-[9px] text-gray-400 truncate max-w-[200px]">
                 ID: {planData?._id}
              </div>
           </div>
        </div>

        {/* Stats Overlay */}
        <div className="absolute bottom-8 left-8 pointer-events-none">
          <div className="bg-white/80 backdrop-blur shadow-2xl rounded-2xl p-6 border border-white/20 flex items-center gap-4">
             <div className="flex -space-x-2">
                {[1,2,3].map(i => (
                  <div key={i} className="w-8 h-8 rounded-full border-2 border-white bg-gray-200" />
                ))}
             </div>
             <div>
               <p className="text-[20px] font-black text-gray-900 leading-none mb-1">{allRooms.length} 个空间节点</p>
               <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">智能测绘数据已同步</p>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
