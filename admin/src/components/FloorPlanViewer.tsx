'use client';
import React, { useMemo, useState, Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Canvas } from '@react-three/fiber';
import { MapControls, PerspectiveCamera, OrthographicCamera, Text, Center, Bounds, ContactShadows, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { ArrowLeft, Activity } from 'lucide-react';
import BackButton from '@/components/BackButton';

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

function RoomObject({ room, is3D }: { room: Room; is3D: boolean }) {
  const rX = room.x || 0;
  const rY = room.y || 0;
  const rWidth = room.width || 100;
  const rHeight = room.height || 100;
  
  // 3D walls are tall, 2D walls are just extruded a tiny bit to have a solid top face
  const wallHeight = is3D ? (room.height3D || 28) : 2; 
  const wallThickness = 2;

  const { topWall, bottomWall, leftWall, rightWall } = useMemo(() => {
    const buildWallShape = (length: number, height: number, openings: Opening[], type: string) => {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(length, 0);
      shape.lineTo(length, height);
      shape.lineTo(0, height);
      shape.lineTo(0, 0);

      openings.forEach(op => {
        let ox = 0;
        if (type === 'top') { ox = op.x; }
        else if (type === 'bottom') { ox = length - (op.x + op.width); }
        else if (type === 'left') { ox = length - (op.y + op.width); }
        else if (type === 'right') { ox = op.y; }

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

    const topOpenings = (room.openings || []).filter(op => op.rotation === 0 && op.y < rHeight / 2);
    const bottomOpenings = (room.openings || []).filter(op => op.rotation === 0 && op.y >= rHeight / 2);
    const leftOpenings = (room.openings || []).filter(op => op.rotation === 90 && op.x < rWidth / 2);
    const rightOpenings = (room.openings || []).filter(op => op.rotation === 90 && op.x >= rWidth / 2);

    return {
      topWall: buildWallShape(rWidth, wallHeight, topOpenings, 'top'),
      bottomWall: buildWallShape(rWidth, wallHeight, bottomOpenings, 'bottom'),
      leftWall: buildWallShape(rHeight, wallHeight, leftOpenings, 'left'),
      rightWall: buildWallShape(rHeight, wallHeight, rightOpenings, 'right')
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
        <planeGeometry args={[rWidth, rHeight]} />
        {is3D ? (
          <meshStandardMaterial color={room.color || '#e0e0e0'} side={THREE.DoubleSide} />
        ) : (
          <meshBasicMaterial color={room.color || '#f3f4f6'} side={THREE.DoubleSide} />
        )}
      </mesh>

      {/* Walls */}
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

      {/* Openings (Doors / Windows) */}
      {(room.openings || []).map((op, i) => {
         const isTop = op.rotation === 0 && op.y < rHeight / 2;
         const isBottom = op.rotation === 0 && op.y >= rHeight / 2;
         const isLeft = op.rotation === 90 && op.x < rWidth / 2;
         const isRight = op.rotation === 90 && op.x >= rWidth / 2;

         let opX = 0; let opZ = 0;
         let opW = op.width; let opD = wallThickness + 2; 

         if (isTop || isBottom) {
             opX = -rWidth/2 + op.x + op.width/2;
             opZ = isTop ? (-rHeight/2 + wallThickness/2) : (rHeight/2 - wallThickness/2);
         } else {
             opZ = -rHeight/2 + op.y + op.width/2;
             opX = isLeft ? (-rWidth/2 + wallThickness/2) : (rWidth/2 - wallThickness/2);
             opW = wallThickness + 2; 
             opD = op.width;
         }

         const color = op.type === 'DOOR' ? '#f59e0b' : '#3b82f6'; // Amber = door, Blue = window
         const h = is3D ? (op.type === 'DOOR' ? 20 : 12) : 2.5;
         const yPos = is3D ? (op.type === 'DOOR' ? h/2 : 9 + h/2) : 1.25;

         return (
            <mesh key={op.id || i} position={[opX, yPos, opZ]}>
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
           rotation={m.rot as any}
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

export default function FloorPlanViewer({ planData }: { planData: any }) {
  const [is3D, setIs3D] = useState(false);
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  const rooms: Room[] = useMemo(() => {
    if (!planData?.layoutData) return [];
    const data = planData.layoutData;
    if (Array.isArray(data)) return data;
    if (data.rooms && Array.isArray(data.rooms)) return data.rooms;
    return [];
  }, [planData?.layoutData]);

  if (!mounted) {
    return <div className="h-screen w-screen bg-gray-50 flex items-center justify-center text-gray-500 text-sm">加载中...</div>;
  }

  return (
    <div className="flex flex-col h-screen bg-[#f1f1f1]">
      {/* Header */}
      <div className="bg-white/90 backdrop-blur-md px-6 py-4 border-b border-gray-200 flex justify-between items-center z-50">
        <div className="flex items-center gap-4">
          <BackButton fallbackPath={planData?.creator?.openid ? `/users/${planData.creator.openid}` : "/"} />
          <div>
            <h2 className="text-lg font-bold tracking-tight">{planData?.name || '户型详情'}</h2>
            <p className="text-xs text-gray-400">
               {planData?.creator?.nickname ? `@${planData.creator.nickname}` : '私有户型'}
            </p>
          </div>
        </div>
        
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

      {/* Main Viewport */}
      <div className="flex-1 relative overflow-hidden">
        {is3D ? (
          <Canvas shadows gl={{ antialias: true }}>
            <Scene3D rooms={rooms} />
          </Canvas>
        ) : (
          <Canvas gl={{ antialias: true }}>
            <Scene2D rooms={rooms} />
          </Canvas>
        )}

        {/* Debug Panel (Mobile/Small) */}
        <div className="absolute top-4 right-4 z-40 pointer-events-none">
           <div className="bg-black/90 text-white p-4 rounded-2xl shadow-2xl font-mono text-[10px] space-y-2 border border-white/10 opacity-80 hover:opacity-100 transition-opacity">
              <div className="flex items-center gap-2 text-green-400 border-b border-white/10 pb-2">
                 <Activity size={14} />
                 <span className="font-bold underline">ENGINE STATUS</span>
              </div>
              <p><span className="text-blue-400">Rooms:</span> {rooms.length}</p>
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
               <p className="text-sm font-black text-gray-900 leading-none mb-1">{rooms.length} 个空间节点</p>
               <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">智能测绘数据已同步</p>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
