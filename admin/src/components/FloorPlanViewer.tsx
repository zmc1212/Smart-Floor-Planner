'use client';
import React, { useMemo, useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Text } from '@react-three/drei';
import * as THREE from 'three';
import { ArrowLeft, Box, Plane, Info } from 'lucide-react';

interface Room {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  polygon?: { x: number; y: number }[];
  polygonClosed?: boolean;
  color?: string;
}

function RoomObject({ room, is3D }: { room: Room; is3D: boolean }) {
  const width = room.width || 100;
  const height = room.height || 100;

  return (
    <group position={[room.x || 0, 0, room.y || 0]}>
       <mesh position={[width/2, (is3D ? 12.5 : 0.5), height/2]}>
         <boxGeometry args={[width, is3D ? 25 : 1, height]} />
         <meshStandardMaterial color={room.color || "#0070f3"} transparent opacity={0.6} />
       </mesh>
       
       <Text
         position={[width / 2, 30, height / 2]}
         fontSize={12}
         color="black"
         anchorX="center"
         anchorY="middle"
         rotation={[-Math.PI / 2, 0, 0]}
       >
         {room.name || 'Room'}
       </Text>
    </group>
  );
}

function Scene({ rooms, is3D }: { rooms: Room[]; is3D: boolean }) {
  return (
    <>
      <OrbitControls enableRotate={is3D} makeDefault />
      <ambientLight intensity={1.0} />
      <pointLight position={[100, 100, 100]} intensity={1.5} />
      <gridHelper args={[2000, 40]} />
      
      <mesh position={[0, 5, 0]}>
        <sphereGeometry args={[5]} />
        <meshStandardMaterial color="red" />
      </mesh>

      <group>
        {rooms.map((room, idx) => (
          <RoomObject key={room.id || idx} room={room} is3D={is3D} />
        ))}
      </group>
    </>
  );
}

export default function FloorPlanViewer({ planData }: { planData: any }) {
  const [is3D, setIs3D] = useState(false);
  
  const rooms: Room[] = useMemo(() => {
    if (!planData.layoutData) return [];
    if (Array.isArray(planData.layoutData)) return planData.layoutData;
    if (planData.layoutData.rooms && Array.isArray(planData.layoutData.rooms)) return planData.layoutData.rooms;
    return [];
  }, [planData.layoutData]);

  const firstRoom = rooms[0] || {} as any;

  return (
    <div className="flex flex-col h-screen bg-[#f1f1f1]">
      {/* Header */}
      <div className="bg-white px-6 py-4 border-b border-gray-200 flex justify-between items-center z-50">
        <div className="flex items-center gap-4">
          <Link 
            href={planData.creator?.openid ? `/users/${planData.creator.openid}` : "/"}
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-gray-100 text-gray-600 transition-colors"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h2 className="text-lg font-bold">{planData.name}</h2>
            <p className="text-sm text-gray-500">
              由 {planData.creator?.nickname || '未知用户'} 创建
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-lg">
           <button 
             onClick={() => setIs3D(false)}
             className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${!is3D ? 'bg-white shadow text-black' : 'text-gray-500'}`}
           >
             2D 平面
           </button>
           <button 
             onClick={() => setIs3D(true)}
             className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${is3D ? 'bg-white shadow text-black' : 'text-gray-500'}`}
           >
             3D 视角
           </button>
        </div>
      </div>

      {/* R3F Canvas Area */}
      <div className="flex-1 relative bg-white">
        <Canvas shadows camera={{ position: [500, 500, 500], fov: 45 }}>
          <Scene rooms={rooms} is3D={is3D} />
        </Canvas>

        {/* Console Debug Toggle */}
        <div className="absolute top-6 right-6 pointer-events-auto max-w-[400px]">
           <div className="bg-black text-[#00ff00] p-4 rounded-lg text-xs font-mono overflow-auto max-h-[500px] shadow-2xl">
              <p className="border-b border-[#00ff00] pb-1 mb-2">DEBUG CONSOLE</p>
              <p>Rooms Count: {rooms.length}</p>
              <p>Active Mode: {is3D ? '3D' : '2D'}</p>
              <div className="mt-4">
                 <p className="text-yellow-400 underline">First Room Data:</p>
                 <pre>{JSON.stringify(firstRoom, null, 2)}</pre>
              </div>
              <div className="mt-4 text-gray-400">
                 <p>API LayoutData Keys: {Object.keys(planData.layoutData || {}).join(', ')}</p>
              </div>
           </div>
        </div>

        {/* Simple Footer Info */}
        <div className="absolute bottom-6 left-6 pointer-events-none">
          <div className="bg-white shadow-xl rounded-lg p-4 border border-gray-100">
             <div className="flex items-center gap-2">
               <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold">
                 {rooms.length}
               </div>
               <span className="text-sm font-bold text-gray-800">已识别房间</span>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
