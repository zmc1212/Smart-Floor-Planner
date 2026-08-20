'use client';

import { notify } from '@/components/admin/operation-feedback';
import React, { useMemo, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Canvas } from '@react-three/fiber';
import { MapControls, PerspectiveCamera, OrthographicCamera, Text, Center, Bounds, ContactShadows, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Activity, Download, Loader2, Wand2, Sparkles } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { Button, Modal, Select } from 'antd';
import { cn } from "@/lib/utils";
import SurveyCanvasHost from '@/components/survey/SurveyCanvasHost';
import { fileNameFromContentDisposition } from '@/lib/dxf';

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
  measurementStartExtensionMm?: number;
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
  const [isExporting, setIsExporting] = useState(false);
  const floor = getActiveSurveyFloor(layoutData.surveyGraph);
  const stats = useMemo(() => getSurveyStats(floor), [floor]);

  const handleFormalDxfExport = async () => {
    if (planData.status !== 'completed' || isExporting) return;
    setIsExporting(true);
    try {
      const response = await fetch(`/api/floorplans/${planData._id}/export/dxf`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || '导出 CAD 失败');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileNameFromContentDisposition(
        response.headers.get('Content-Disposition'),
        `${planData.name || 'formal-floor-plan'}.dxf`,
      );
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      notify.success('CAD 文件已导出');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '导出 CAD 失败，请稍后重试');
    } finally {
      setIsExporting(false);
    }
  };

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
              与小程序测量画布同一套渲染 · 拖拽平移、滚轮缩放、双击适应
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
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
          <Button
            htmlType="button"
            size="small"
            onClick={handleFormalDxfExport}
            disabled={planData.status !== 'completed' || isExporting}
            aria-label={planData.status === 'completed' ? '导出 CAD' : '户型完成后可导出 CAD'}
          >
            {isExporting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
            {isExporting ? '生成中…' : '导出 CAD'}
          </Button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden p-4 sm:p-6">
        <div className="h-full overflow-hidden rounded-lg border bg-card shadow-sm">
          <SurveyCanvasHost floor={floor} className="h-full w-full cursor-grab touch-none active:cursor-grabbing" />
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
      a.download = fileNameFromContentDisposition(
        res.headers.get('Content-Disposition'),
        `FloorPlan_${planData.name || planData._id}.dxf`,
      );
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
              <Button
                type="text"
                disabled={isGenerating}
                onClick={() => setShowAIDialog(true)}
                className="flex h-9 items-center gap-2 px-3 text-xs font-medium"
              >
                {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                {isGenerating ? 'AI 设计中...' : 'AI 风格生成'}
              </Button>
              <Modal
                open={showAIDialog}
                onCancel={() => setShowAIDialog(false)}
                width={448}
                title={
                  <span className="flex items-center gap-2 text-lg font-semibold">
                    <Sparkles className="text-primary" size={20} />
                    AI 智能风格预览
                  </span>
                }
                footer={[
                  <Button
                    key="cancel"
                    type="text"
                    onClick={() => setShowAIDialog(false)}
                    className="h-10 px-4"
                  >
                    取消
                  </Button>,
                  <Button
                    key="generate"
                    type="primary"
                    onClick={handleAIGenerate}
                    className="h-10 px-5"
                  >
                    开始生成方案
                  </Button>,
                ]}
              >
                <p className="text-sm text-muted-foreground">
                  选择目标设计风格，系统将基于当前户型生成 3D 渲染方案
                </p>

                <div className="space-y-5 py-5">
                  <div className="space-y-3">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">目标设计风格</div>
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
                    <label htmlFor="ai-room-type" className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">空间场景</label>
                    <Select
                      id="ai-room-type"
                      value={aiPreset.roomType}
                      onChange={(val) => setAiPreset({...aiPreset, roomType: val})}
                      placeholder="选择空间"
                      size="large"
                      className="w-full"
                      options={ROOM_TYPE_OPTIONS.map((room) => ({ value: room.id, label: room.label }))}
                    />
                  </div>
                </div>
              </Modal>

            </div>
          )}

          <Button 
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
                 <span className="font-bold underline">引擎状态</span>
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
