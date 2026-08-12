'use client';

import { notify } from '@/components/ui/operation-feedback';
import React, { useMemo, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Canvas } from '@react-three/fiber';
import { MapControls, PerspectiveCamera, OrthographicCamera, Text, Center, Bounds, ContactShadows, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Activity, Download, Loader2, Wand2, Sparkles } from 'lucide-react';
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
import { createClosedDimensionPlan } from '@/lib/surveyDimensionPlan.js';
import { createWallSolidPlan } from '@/lib/surveyWallSolidPlan.js';

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
  measurementStartInsetMm?: number;
  measurementEndInsetMm?: number;
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

type SurveyNodePoint = Required<Pick<SurveyNode, 'id' | 'xMm' | 'yMm'>>;

interface SurveySpaceWallEntry {
  wall: SurveyWall;
  start: SurveyNodePoint;
  end: SurveyNodePoint;
  reversed: boolean;
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

function traceSurveySpaceWallChain(
  floor: SurveyFloor | null,
  wallIds: string[],
  nodeMap: ReturnType<typeof getSurveyNodeMap>,
  reverseFirstWall: boolean,
): SurveySpaceWallEntry[] {
  if (!floor || wallIds.length < 3) return [];
  const firstWall = (floor.walls || []).find((wall) => wall.id === wallIds[0]);
  if (!firstWall) return [];

  const initialNodeId = reverseFirstWall ? firstWall.endNodeId : firstWall.startNodeId;
  if (!initialNodeId) return [];
  let currentNodeId = initialNodeId;
  const chain: SurveySpaceWallEntry[] = [];

  for (const wallId of wallIds) {
    const wall = (floor.walls || []).find((candidate) => candidate.id === wallId);
    if (!wall) return [];
    let nextNodeId: string | undefined;
    if (wall.startNodeId === currentNodeId) {
      nextNodeId = wall.endNodeId;
    } else if (wall.endNodeId === currentNodeId) {
      nextNodeId = wall.startNodeId;
    } else {
      return [];
    }
    if (!nextNodeId) return [];
    const start = nodeMap.get(currentNodeId);
    const end = nodeMap.get(nextNodeId);
    if (!start || !end) return [];
    chain.push({ wall, start, end, reversed: wall.endNodeId === currentNodeId });
    currentNodeId = nextNodeId;
  }

  return currentNodeId === initialNodeId ? chain : [];
}

function buildSurveySpaceWallChain(
  floor: SurveyFloor | null,
  space: SurveySpace,
  nodeMap: ReturnType<typeof getSurveyNodeMap>,
) {
  const wallIds = Array.isArray(space.wallIds) ? space.wallIds : [];
  const forward = traceSurveySpaceWallChain(floor, wallIds, nodeMap, false);
  return forward.length ? forward : traceSurveySpaceWallChain(floor, wallIds, nodeMap, true);
}

function buildSurveySpacePoints(floor: SurveyFloor | null, space: SurveySpace, nodeMap: ReturnType<typeof getSurveyNodeMap>) {
  return buildSurveySpaceWallChain(floor, space, nodeMap).map((entry) => entry.start);
}

type SurveyPoint = { xMm: number; yMm: number };

function getSurveySpaceCentroid(points: SurveyPoint[]) {
  return getPolygonCentroid(points);
}

function getSurveyWallRawBody(
  floor: SurveyFloor | null,
  wall: SurveyWall,
  nodeMap: ReturnType<typeof getSurveyNodeMap>,
) {
  const endpoints = getSurveyWallEndpoints(floor, wall, nodeMap);
  if (!endpoints) return null;
  const dx = endpoints.end.xMm - endpoints.start.xMm;
  const dy = endpoints.end.yMm - endpoints.start.yMm;
  const length = Math.hypot(dx, dy);
  if (!length) return null;
  const direction = { x: dx / length, y: dy / length };
  const leftNormal = { x: direction.y, y: -direction.x };
  const rightNormal = { x: -direction.y, y: direction.x };
  const closedSpace = (floor?.spaces || []).find((space) => (
    space.closed && Array.isArray(space.wallIds) && space.wallIds.includes(wall.id)
  ));
  const centroid = closedSpace
    ? getSurveySpaceCentroid(buildSurveySpacePoints(floor, closedSpace, nodeMap))
    : null;
  const midpoint = {
    xMm: (endpoints.start.xMm + endpoints.end.xMm) / 2,
    yMm: (endpoints.start.yMm + endpoints.end.yMm) / 2,
  };
  const outward = centroid
    ? { x: midpoint.xMm - centroid.xMm, y: midpoint.yMm - centroid.yMm }
    : null;
  const normal = outward
    ? ((leftNormal.x * outward.x + leftNormal.y * outward.y) >= (rightNormal.x * outward.x + rightNormal.y * outward.y)
      ? leftNormal
      : rightNormal)
    : (wall.measurementSide === 'right' ? rightNormal : leftNormal);
  const thickness = Math.max(80, Number(wall.thicknessMm || 200));
  return {
    ...endpoints,
    direction,
    normal,
    thickness,
    outerStart: {
      xMm: endpoints.start.xMm + normal.x * thickness,
      yMm: endpoints.start.yMm + normal.y * thickness,
    },
    outerEnd: {
      xMm: endpoints.end.xMm + normal.x * thickness,
      yMm: endpoints.end.yMm + normal.y * thickness,
    },
  };
}

function intersectSurveyLines(firstStart: SurveyPoint, firstEnd: SurveyPoint, secondStart: SurveyPoint, secondEnd: SurveyPoint) {
  const first = { x: firstEnd.xMm - firstStart.xMm, y: firstEnd.yMm - firstStart.yMm };
  const second = { x: secondEnd.xMm - secondStart.xMm, y: secondEnd.yMm - secondStart.yMm };
  const denominator = first.x * second.y - first.y * second.x;
  if (Math.abs(denominator) < 0.000001) return null;
  const offset = { x: secondStart.xMm - firstStart.xMm, y: secondStart.yMm - firstStart.yMm };
  const t = (offset.x * second.y - offset.y * second.x) / denominator;
  return { xMm: firstStart.xMm + first.x * t, yMm: firstStart.yMm + first.y * t };
}

function getSurveyMiterPoint(
  body: NonNullable<ReturnType<typeof getSurveyWallRawBody>>,
  adjacent: NonNullable<ReturnType<typeof getSurveyWallRawBody>> | null,
  endpoint: SurveyNodePoint,
) {
  if (!adjacent) return null;
  const point = intersectSurveyLines(body.outerStart, body.outerEnd, adjacent.outerStart, adjacent.outerEnd);
  if (!point) return null;
  const distance = Math.hypot(point.xMm - endpoint.xMm, point.yMm - endpoint.yMm);
  return distance <= Math.max(body.thickness, adjacent.thickness) * 4 ? point : null;
}

function surveyPointTouchesWall(point: SurveyNodePoint, endpoints: ReturnType<typeof getSurveyWallEndpoints>) {
  if (!endpoints) return false;
  const dx = endpoints.end.xMm - endpoints.start.xMm;
  const dy = endpoints.end.yMm - endpoints.start.yMm;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return false;
  const t = ((point.xMm - endpoints.start.xMm) * dx + (point.yMm - endpoints.start.yMm) * dy) / lengthSquared;
  if (t < -0.0001 || t > 1.0001) return false;
  const x = endpoints.start.xMm + dx * t;
  const y = endpoints.start.yMm + dy * t;
  return Math.hypot(point.xMm - x, point.yMm - y) <= 1;
}

function isSurveyWallEndpointOpen(
  floor: SurveyFloor | null,
  wall: SurveyWall,
  point: SurveyNodePoint,
  nodeMap: ReturnType<typeof getSurveyNodeMap>,
) {
  return !(floor?.walls || []).some((candidate) => (
    candidate.id !== wall.id && surveyPointTouchesWall(point, getSurveyWallEndpoints(floor, candidate, nodeMap))
  ));
}

function getSurveyWallBody(floor: SurveyFloor | null, wall: SurveyWall, nodeMap: ReturnType<typeof getSurveyNodeMap>) {
  const body = getSurveyWallRawBody(floor, wall, nodeMap);
  if (!body) return null;
  const closedSpace = (floor?.spaces || []).find((space) => (
    space.closed && Array.isArray(space.wallIds) && space.wallIds.includes(wall.id)
  ));
  const chain = closedSpace ? buildSurveySpaceWallChain(floor, closedSpace, nodeMap) : [];
  const index = chain.findIndex((entry) => entry.wall.id === wall.id);
  let startWall: SurveyWall | null = null;
  let endWall: SurveyWall | null = null;
  if (index >= 0) {
    const entry = chain[index];
    const previous = chain[(index - 1 + chain.length) % chain.length].wall;
    const next = chain[(index + 1) % chain.length].wall;
    startWall = entry.reversed ? next : previous;
    endWall = entry.reversed ? previous : next;
  }
  const startAdjacent = startWall ? getSurveyWallRawBody(floor, startWall, nodeMap) : null;
  const endAdjacent = endWall ? getSurveyWallRawBody(floor, endWall, nodeMap) : null;
  return {
    ...body,
    outerStart: getSurveyMiterPoint(body, startAdjacent, body.start) || body.outerStart,
    outerEnd: getSurveyMiterPoint(body, endAdjacent, body.end) || body.outerEnd,
    startOpen: isSurveyWallEndpointOpen(floor, wall, body.start, nodeMap),
    endOpen: isSurveyWallEndpointOpen(floor, wall, body.end, nodeMap),
  };
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

function buildSurveyCompoundPath(rings: SurveyPoint[][]) {
  return rings.map((ring) => {
    if (!ring.length) return '';
    return `M ${ring[0].xMm} ${ring[0].yMm} ${ring.slice(1).map((point) => `L ${point.xMm} ${point.yMm}`).join(' ')} Z`;
  }).filter(Boolean).join(' ');
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
    () => (floor?.walls || []).flatMap((wall) => {
      const body = getSurveyWallBody(floor, wall, nodeMap);
      return body ? [{ wall, body }] : [];
    }),
    [floor, nodeMap],
  );
  const wallSolidPlan = useMemo(() => createWallSolidPlan({
    walls: wallBodies.map(({ wall, body }) => {
      const start = { x: body.start.xMm, y: body.start.yMm };
      const end = { x: body.end.xMm, y: body.end.yMm };
      const outerStart = {
        x: body.start.xMm + body.normal.x * body.thickness,
        y: body.start.yMm + body.normal.y * body.thickness,
      };
      const outerEnd = {
        x: body.end.xMm + body.normal.x * body.thickness,
        y: body.end.yMm + body.normal.y * body.thickness,
      };
      return {
        id: wall.id,
        start,
        end,
        outerStart,
        outerEnd,
        thickness: body.thickness,
        polygon: [start, end, outerEnd, outerStart],
      };
    }),
  }) as { rings: Array<Array<{ x: number; y: number }>> }, [wallBodies]);
  const wallSolidPath = useMemo(() => buildSurveyCompoundPath(
    wallSolidPlan.rings.map((ring) => ring.map((point) => ({ xMm: point.x, yMm: point.y }))),
  ), [wallSolidPlan]);
  const spaceDetails = useMemo(
    () => (floor?.spaces || []).filter((space) => space.closed).map((space) => ({ space, detail: getSurveySpaceDetails(floor, space, nodeMap) })).filter((item) => item.detail),
    [floor, nodeMap],
  );
  const drawingScale = Math.max(bounds.width, bounds.height);
  const dimensionOffset = Math.max(160, drawingScale * 0.035);
  const dimensionTextSize = Math.max(76, Math.min(130, drawingScale / 40));
  const dimensionItems = useMemo(() => createClosedDimensionPlan({
    baseGap: dimensionOffset * 0.28,
    laneGap: dimensionTextSize * 1.45,
    groupTolerance: Math.max(12, drawingScale * 0.002),
    measurementUnitsPerCoordinate: 1,
    walls: wallBodies.map(({ wall, body }) => ({
      id: wall.id,
      start: { x: body.start.xMm, y: body.start.yMm },
      end: { x: body.end.xMm, y: body.end.yMm },
      coordinateLength: getSurveyWallLengthMm(floor, wall),
      measurementLength: getSurveyWallLengthMm(floor, wall),
      thickness: body.thickness,
      outerStart: { x: body.outerStart.xMm, y: body.outerStart.yMm },
      outerEnd: { x: body.outerEnd.xMm, y: body.outerEnd.yMm },
    })),
    spaces: (floor?.spaces || []).filter((space) => space.closed),
    outerRings: wallSolidPlan.rings,
    openings: (floor?.openings || []).map((opening) => {
      const wall = (floor?.walls || []).find((item) => item.id === opening.wallId);
      const wallLength = wall ? getSurveyWallLengthMm(floor, wall) : 0;
      const width = Math.min(wallLength, Math.max(0, Number(opening.widthMm || 0)));
      const center = Math.min(wallLength - width / 2, Math.max(width / 2, Number(opening.centerOffsetMm || wallLength / 2)));
      return {
        id: opening.id,
        wallId: opening.wallId,
        type: opening.type,
        start: center - width / 2,
        end: center + width / 2,
      };
    }),
  }).items, [dimensionOffset, dimensionTextSize, drawingScale, floor, wallBodies, wallSolidPlan]);
  const viewBounds = useMemo(() => {
    const textPadding = dimensionTextSize * 1.2;
    const points = dimensionItems.flatMap((dimension) => [
      dimension.start,
      dimension.end,
      dimension.extensionStart,
      dimension.extensionEnd,
    ]);
    if (!points.length) return bounds;

    const minX = Math.min(bounds.minX, ...points.map((point) => point.x - textPadding));
    const minY = Math.min(bounds.minY, ...points.map((point) => point.y - textPadding));
    const maxX = Math.max(bounds.minX + bounds.width, ...points.map((point) => point.x + textPadding));
    const maxY = Math.max(bounds.minY + bounds.height, ...points.map((point) => point.y + textPadding));
    return { minX, minY, width: maxX - minX, height: maxY - minY };
  }, [bounds, dimensionItems, dimensionTextSize]);
  const viewBox = `${viewBounds.minX} ${viewBounds.minY} ${viewBounds.width} ${viewBounds.height}`;
  const roomTitleSize = Math.max(72, Math.min(120, drawingScale / 42));
  const roomDetailSize = Math.max(54, Math.min(86, drawingScale / 56));

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="z-20 flex items-center justify-between border-b bg-card px-5 py-3 sm:px-6">
        <div className="flex items-center gap-4">
          <BackButton fallbackPath={planData?.creator?.openid ? `/users/${planData.creator.openid}` : "/leads"} />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight">{planData?.name || '测量户型图'}</h2>
              <span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">正式测量</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
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
            <div key={label} className="min-w-16 rounded-md bg-muted px-3 py-2">
              <div className="text-base font-semibold">{value}</div>
              <div className="text-xs font-medium text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden p-4 sm:p-6">
        <div className="h-full overflow-hidden rounded-lg border bg-card shadow-sm">
          <svg className="h-full w-full" viewBox={viewBox} role="img" aria-label="测量户型图">
            <defs>
              <pattern id="survey-grid-minor" width="500" height="500" patternUnits="userSpaceOnUse">
                <path d="M 500 0 L 0 0 0 500" fill="none" stroke="rgba(141,148,158,0.25)" strokeWidth="8" />
              </pattern>
              <pattern id="survey-grid-major" width="2500" height="2500" patternUnits="userSpaceOnUse">
                <path d="M 2500 0 L 0 0 0 2500" fill="none" stroke="rgba(111,118,128,0.25)" strokeWidth="12" />
              </pattern>
            </defs>
            <rect x={viewBounds.minX} y={viewBounds.minY} width={viewBounds.width} height={viewBounds.height} fill="#f8f8f8" />
            <rect x={viewBounds.minX} y={viewBounds.minY} width={viewBounds.width} height={viewBounds.height} fill="url(#survey-grid-minor)" />
            <rect x={viewBounds.minX} y={viewBounds.minY} width={viewBounds.width} height={viewBounds.height} fill="url(#survey-grid-major)" />

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

            {wallSolidPath && (
              <path
                d={wallSolidPath}
                fill="#8e8e8c"
                fillRule="nonzero"
                stroke="#1f1f1f"
                strokeWidth="20"
                strokeLinecap="butt"
                strokeLinejoin="miter"
              />
            )}

            {(floor?.openings || []).map((opening) => {
              const wall = (floor?.walls || []).find((item) => item.id === opening.wallId);
              const body = wall ? getSurveyWallBody(floor, wall, nodeMap) : null;
              if (!body) return null;
              const isDoor = opening.type === 'door';
              const angle = Math.atan2(body.direction.y, body.direction.x) * 180 / Math.PI;
              const wallLength = getSurveyWallLengthMm(floor, wall!);
              const width = Math.min(wallLength, Math.max(80, Number(opening.widthMm || 0)));
              const centerOffset = clampNumber(Number(opening.centerOffsetMm || wallLength / 2), width / 2, wallLength - width / 2);
              const startX = centerOffset - width / 2;
              const endX = centerOffset + width / 2;
              const localY = { x: -body.direction.y, y: body.direction.x };
              const wallBodySign = body.normal.x * localY.x + body.normal.y * localY.y >= 0 ? 1 : -1;
              // Keep the SVG symbol geometry in lockstep with the native
              // survey canvas: the measured wall path is the inner face (0),
              // and the signed outer face carries the real wall thickness.
              const outerY = wallBodySign * body.thickness;
              const minY = Math.min(0, outerY);
              const maxY = Math.max(0, outerY);
              const frameDepth = Math.min(
                Math.max(35, body.thickness * 0.2),
                Math.max(35, width * 0.1),
              );
              const hingeX = startX + frameDepth;
              const oppositeJambX = endX - frameDepth;
              const opensOutside = opening.openDirection === 'outside';
              const frameFaceY = opensOutside ? 0 : outerY;
              const directionToOtherFace = outerY === frameFaceY ? Math.sign(-outerY) : Math.sign(outerY);
              const leafSeatY = frameFaceY + directionToOtherFace * Math.min(
                Math.max(15, Math.abs(outerY) * 0.12),
                Math.max(15, Math.abs(outerY) / 2 - 10),
              );
              const swingSign = opensOutside ? Math.sign(outerY) : -Math.sign(outerY);
              const leafThickness = Math.abs(frameFaceY - leafSeatY);
              const windowCenterY = (outerY + 0) / 2;
              const slidingPanelInset = Math.min(
                Math.max(15, body.thickness * 0.18),
                Math.max(15, Math.abs(outerY) / 2 - 10),
              );
              const slidingOuterRailY = outerY < 0 ? outerY + slidingPanelInset : outerY - slidingPanelInset;
              const slidingInnerRailY = outerY < 0 ? slidingPanelInset : -slidingPanelInset;
              const openingMaskPadding = 24;
              const renderLeaf = (leafHingeX: number, radius: number, endOnRight: boolean) => {
                const leafTipY = leafSeatY + swingSign * radius;
                const secondLeafX = leafHingeX + (endOnRight ? leafThickness : -leafThickness);
                const arcEndX = leafHingeX + (endOnRight ? radius : -radius);
                return (
                  <g fill="none" stroke="#111827" strokeWidth="20" strokeLinecap="butt" strokeLinejoin="miter">
                    <path d={`M ${leafHingeX} ${leafSeatY} L ${leafHingeX} ${leafTipY} L ${secondLeafX} ${leafTipY} L ${secondLeafX} ${leafSeatY} Z`} />
                    <path d={`M ${leafHingeX} ${leafTipY} A ${radius} ${radius} 0 0 ${swingSign > 0 ? 0 : 1} ${arcEndX} ${leafSeatY}`} />
                  </g>
                );
              };
              const renderDoorCasing = (outerX: number, innerX: number) => (
                <path
                  d={`M ${outerX} ${outerY} L ${innerX} ${outerY} L ${innerX} 0 L ${outerX} 0 Z`}
                  fill="none"
                  stroke="#111827"
                  strokeWidth="20"
                  strokeLinecap="butt"
                  strokeLinejoin="miter"
                />
              );
              return (
                <g key={opening.id} transform={`translate(${body.start.xMm} ${body.start.yMm}) rotate(${angle})`}>
                  <rect
                    x={startX - 5}
                    y={minY - openingMaskPadding}
                    width={width + 10}
                    height={maxY - minY + openingMaskPadding * 2}
                    fill="#f8f8f8"
                  />
                  {isDoor ? (opening.modelCategory === 'sliding-door' ? (
                    <g fill="none" stroke="#111827" strokeWidth="20" strokeLinecap="butt" strokeLinejoin="miter">
                      <line x1={startX} y1={slidingOuterRailY} x2={centerOffset} y2={slidingOuterRailY} />
                      <line x1={centerOffset} y1={slidingInnerRailY} x2={endX} y2={slidingInnerRailY} />
                      <line x1={startX} y1={outerY} x2={startX} y2="0" />
                      <line x1={centerOffset} y1={slidingOuterRailY} x2={centerOffset} y2={slidingInnerRailY} />
                      <line x1={endX} y1={outerY} x2={endX} y2="0" />
                    </g>
                  ) : (
                    <>
                      {opening.modelCategory === 'double-door'
                        ? <>{renderLeaf(hingeX, (oppositeJambX - hingeX) / 2, true)}{renderLeaf(oppositeJambX, (oppositeJambX - hingeX) / 2, false)}</>
                        : renderLeaf(hingeX, oppositeJambX - hingeX, true)}
                      {renderDoorCasing(startX, hingeX)}
                      {renderDoorCasing(oppositeJambX, endX)}
                      <path
                        d={`M ${hingeX} ${frameFaceY} L ${oppositeJambX} ${frameFaceY} L ${oppositeJambX} ${leafSeatY} L ${hingeX} ${leafSeatY} Z`}
                        fill="none"
                        stroke="#111827"
                        strokeWidth="20"
                        strokeLinecap="butt"
                        strokeLinejoin="miter"
                      />
                    </>
                  )) : (
                    <g fill="none" stroke="#2f2f2f" strokeWidth="14" strokeLinecap="butt" strokeLinejoin="miter">
                      <line x1={startX} y1={outerY} x2={endX} y2={outerY} />
                      <line x1={startX} y1={windowCenterY} x2={endX} y2={windowCenterY} />
                      <line x1={startX} y1="0" x2={endX} y2="0" />
                      <line x1={startX} y1={outerY} x2={startX} y2="0" />
                      <line x1={endX} y1={outerY} x2={endX} y2="0" />
                      {width >= 900 && <line x1={centerOffset} y1={outerY} x2={centerOffset} y2="0" />}
                      {opening.modelCategory === 'sliding-window' && width >= 1800 && <>
                        <line x1={centerOffset - width / 4} y1={outerY} x2={centerOffset - width / 4} y2="0" />
                        <line x1={centerOffset + width / 4} y1={outerY} x2={centerOffset + width / 4} y2="0" />
                      </>}
                    </g>
                  )}
                </g>
              );
            })}

            {dimensionItems.map((dimension) => {
              const dx = dimension.end.x - dimension.start.x;
              const dy = dimension.end.y - dimension.start.y;
              const length = Math.hypot(dx, dy);
              if (!length) return null;
              const direction = { x: dx / length, y: dy / length };
              const localY = { x: -direction.y, y: direction.x };
              const toLocal = (value: { x: number; y: number }) => ({
                x: (value.x - dimension.start.x) * direction.x + (value.y - dimension.start.y) * direction.y,
                y: (value.x - dimension.start.x) * localY.x + (value.y - dimension.start.y) * localY.y,
              });
              const startExtension = toLocal(dimension.extensionStart);
              const endExtension = toLocal(dimension.extensionEnd);
              const angle = Math.atan2(dy, dx) * 180 / Math.PI;
              const isUpsideDown = dx < 0;
              const textSize = dimension.kind === 'opening-segment' ? dimensionTextSize * 0.84 : dimensionTextSize;
              const extensionGuide = (source: { x: number; y: number }, targetX: number) => {
                const guideDx = targetX - source.x;
                const guideDy = -source.y;
                const guideLength = Math.hypot(guideDx, guideDy);
                if (!guideLength) return null;
                const unit = { x: guideDx / guideLength, y: guideDy / guideLength };
                const objectGap = textSize * 0.08;
                const overshoot = textSize * 0.12;
                return {
                  start: { x: source.x + unit.x * objectGap, y: source.y + unit.y * objectGap },
                  end: { x: targetX + unit.x * overshoot, y: unit.y * overshoot },
                };
              };
              const startGuide = extensionGuide(startExtension, 0);
              const endGuide = extensionGuide(endExtension, length);
              const arrowLength = textSize * 0.24;
              const arrowHalfHeight = textSize * 0.14;
              return (
                <g key={dimension.id} transform={`translate(${dimension.start.x} ${dimension.start.y}) rotate(${angle})`} fill="none" stroke="#4b5563" strokeWidth={Math.max(6, textSize * 0.065)} strokeLinecap="butt">
                  {startGuide && <line x1={startGuide.start.x} y1={startGuide.start.y} x2={startGuide.end.x} y2={startGuide.end.y} />}
                  {endGuide && <line x1={endGuide.start.x} y1={endGuide.start.y} x2={endGuide.end.x} y2={endGuide.end.y} />}
                  <line x1="0" y1="0" x2={length} y2="0" />
                  <path d={`M 0 0 l ${arrowLength} ${-arrowHalfHeight} v ${arrowHalfHeight * 2} z`} fill="#374151" stroke="none" />
                  <path d={`M ${length} 0 l ${-arrowLength} ${-arrowHalfHeight} v ${arrowHalfHeight * 2} z`} fill="#374151" stroke="none" />
                  <text x={length / 2} y="0" fill="#111" stroke="#f8f8f8" strokeWidth={textSize * 0.32} paintOrder="stroke" textAnchor="middle" dominantBaseline="middle" fontSize={textSize} fontWeight={dimension.kind === 'building-overall' || dimension.kind === 'chain-total' ? "600" : "500"} transform={isUpsideDown ? `rotate(180 ${length / 2} 0)` : undefined}>{dimension.label}</text>
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
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <div className="z-50 flex items-center justify-between border-b bg-card px-5 py-3 sm:px-6">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4">
            <BackButton fallbackPath={planData?.creator?.openid ? `/users/${planData.creator.openid}` : "/"} />
            <div>
              <h2 className="text-lg font-bold tracking-tight">{planData?.name || '户型详情'}</h2>
              <p className="text-xs text-muted-foreground">
                 {lead?.name ? `客户: ${lead.name} · ` : ''}
                 {planData?.externalSource?.communityName || planData?.creator?.communityName || '私有户型'}
                 {' · '}
                 {getFloorPlanSourceLabel(planData?.source)}
              </p>
            </div>
          </div>
          
          {allRooms.length > 1 && (
            <div className="flex items-center gap-1 rounded-md bg-muted p-1">
              {allRooms.map((room) => (
                <button
                  key={room.id}
                  onClick={() => setSelectedRoomId(room.id)}
                  className={`rounded-sm px-3 py-1.5 text-xs font-medium transition-colors ${
                    activeRoomId === room.id 
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-background hover:text-foreground'
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
                    className="flex h-9 items-center gap-2 px-3 text-xs font-medium"
                  >
                    {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                    {isGenerating ? 'AI 设计中...' : 'AI 风格生成'}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md overflow-hidden rounded-lg p-0">
                  <DialogHeader className="border-b bg-muted/30 p-6 pb-5">
                    <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
                      <Sparkles className="text-primary" size={20} />
                      AI 智能风格预览
                    </DialogTitle>
                    <DialogDescription>
                      选择目标设计风格，系统将基于当前户型生成 3D 渲染方案
                    </DialogDescription>
                  </DialogHeader>
                  
                  <div className="space-y-5 p-6">
                    <div className="space-y-3">
                      <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">目标设计风格</Label>
                      <div className="grid grid-cols-2 gap-3">
                        {STYLE_OPTIONS.map((style) => (
                          <div 
                            key={style.id}
                            onClick={() => setAiPreset({...aiPreset, style: style.id})}
                            className={cn(
                              "flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors",
                              aiPreset.style === style.id 
                                ? "border-primary bg-primary/5 shadow-sm"
                                : "bg-card hover:bg-muted/50"
                            )}
                          >
                            <span className="text-xl">{style.icon}</span>
                            <span className={cn(
                              "text-sm font-bold",
                              aiPreset.style === style.id ? "text-primary" : "text-muted-foreground"
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
                        <SelectTrigger className="h-10 rounded-md bg-muted/50 font-medium">
                          <SelectValue placeholder="选择空间" />
                        </SelectTrigger>
                        <SelectContent className="rounded-md">
                          {ROOM_TYPE_OPTIONS.map(room => (
                            <SelectItem key={room.id} value={room.id} className="rounded-sm font-medium">
                              {room.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <DialogFooter className="border-t bg-muted/20 p-6 pt-4">
                    <Button 
                      variant="ghost" 
                      onClick={() => setShowAIDialog(false)}
                      className="h-10 px-4"
                    >
                      取消
                    </Button>
                    <Button 
                      onClick={handleAIGenerate}
                      className="h-10 px-5"
                    >
                      开始生成方案
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

            </div>
          )}

          <Button 
            variant="outline" 
            onClick={handleExportDXF}
            disabled={isExporting}
            className="flex h-9 items-center gap-2 px-3 text-xs font-medium"
          >
            {isExporting ? <Loader2 size={16} className="animate-spin text-primary" /> : <Download size={16} className="text-primary" />}
            {isExporting ? '生成中...' : '导出 CAD (.dxf)'}
          </Button>

          <div className="flex items-center gap-1 rounded-md bg-muted p-1">
             <button 
               onClick={() => setIs3D(false)}
               className={`rounded-sm px-4 py-1.5 text-sm font-medium transition-colors ${!is3D ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
             >
               2D 平面
             </button>
             <button 
               onClick={() => setIs3D(true)}
               className={`rounded-sm px-4 py-1.5 text-sm font-medium transition-colors ${is3D ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
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
           <div className="space-y-2 rounded-md border bg-foreground p-3 font-mono text-[10px] text-background shadow-lg opacity-85 transition-opacity hover:opacity-100">
              <div className="flex items-center gap-2 border-b border-background/20 pb-2 text-emerald-300">
                 <Activity size={14} />
                 <span className="font-bold underline">ENGINE STATUS</span>
              </div>
              <p><span className="text-primary-foreground">Rooms:</span> {roomsToRender.length} / {allRooms.length}</p>
              <p><span className="text-primary-foreground">View:</span> {is3D ? 'PERSPECTIVE' : 'ORTHO'}</p>
              <p><span className="text-primary-foreground">Data Check:</span> {planData?.layoutData ? 'FOUND' : 'MISSING'}</p>
              <div className="max-w-[200px] truncate pt-2 text-[9px] text-background/65">
                 ID: {planData?._id}
              </div>
           </div>
        </div>

        {/* Stats Overlay */}
        <div className="absolute bottom-8 left-8 pointer-events-none">
          <div className="flex items-center gap-4 rounded-lg border bg-card/95 p-4 shadow-lg backdrop-blur">
             <div className="flex -space-x-2">
                {[1,2,3].map(i => (
                  <div key={i} className="h-8 w-8 rounded-full border-2 border-card bg-muted" />
                ))}
             </div>
             <div>
               <p className="mb-1 text-xl font-semibold leading-none">{allRooms.length} 个空间节点</p>
               <p className="text-xs font-medium text-muted-foreground">智能测绘数据已同步</p>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
