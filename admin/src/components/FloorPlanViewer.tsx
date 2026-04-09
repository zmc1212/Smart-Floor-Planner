'use client';
import React, { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ZoomIn, ZoomOut, Download } from 'lucide-react';

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
  openings?: Opening[];
}

interface Opening {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

export default function FloorPlanViewer({ planData }: { planData: any }) {
  const router = useRouter();
  const rooms: Room[] = planData.layoutData || [];

  // Compute bounding box to set SVG viewBox
  const viewBox = useMemo(() => {
    if (!rooms.length) return '0 0 100 100';
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    rooms.forEach(room => {
      // Basic bounding box based on x, y, width, height
      if (room.x < minX) minX = room.x;
      if (room.y < minY) minY = room.y;
      if (room.x + room.width > maxX) maxX = room.x + room.width;
      if (room.y + room.height > maxY) maxY = room.y + room.height;

      // Include polygon points if present
      if (room.polygon && room.polygon.length) {
        room.polygon.forEach(pt => {
           const px = room.x + pt.x;
           const py = room.y + pt.y;
           if (px < minX) minX = px;
           if (py < minY) minY = py;
           if (px > maxX) maxX = px;
           if (py > maxY) maxY = py;
        });
      }
    });

    const padding = 20;
    const w = Math.max(maxX - minX, 10);
    const h = Math.max(maxY - minY, 10);
    return `${minX - padding} ${minY - padding} ${w + padding * 2} ${h + padding * 2}`;
  }, [rooms]);

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Viewer Header */}
      <div className="bg-white px-6 py-4 border-b border-[rgba(0,0,0,0.08)] flex justify-between items-center shrink-0">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => {
              if (planData.creator?.openid) {
                router.push(`/users/${planData.creator.openid}`);
              } else {
                router.push('/');
              }
            }}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[#f5f5f5] text-[#666] transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.36px]">{planData.name}</h2>
            <p className="text-[13px] text-[#808080]">
              由 {planData.creator?.nickname || '未知用户'} (OpenID: {planData.creator?.openid || '未知'}) 于 {new Date(planData.createdAt).toLocaleDateString()} 创建
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-[13px] font-medium bg-[#f5f5f5] px-3 py-1.5 rounded-md text-[#666]">
            {rooms.length} 个房间数据
          </div>
        </div>
      </div>

      {/* Canvas Area */}
      <div className="flex-1 bg-[#f8f9fa] relative overflow-hidden flex items-center justify-center p-8">
        <div className="absolute top-4 right-4 flex flex-col gap-2 bg-white p-2 rounded-lg shadow-sm border border-[rgba(0,0,0,0.04)]">
          <button className="p-2 hover:bg-[#f5f5f5] rounded text-[#666] tooltip" aria-label="放大">
            <ZoomIn size={18} />
          </button>
          <button className="p-2 hover:bg-[#f5f5f5] rounded text-[#666] tooltip" aria-label="缩小">
            <ZoomOut size={18} />
          </button>
        </div>

        {rooms.length === 0 ? (
          <div className="text-[#999] text-[14px]">暂无对应的户型节点数据</div>
        ) : (
          <div className="w-full h-full border-2 border-dashed border-[#e5e5e5] rounded-xl bg-white shadow-sm flex items-center justify-center p-4">
            <svg viewBox={viewBox} className="w-full h-full max-w-4xl drop-shadow-md">
              <defs>
                <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
                  <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#f0f0f0" strokeWidth="0.5"/>
                </pattern>
                <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
                  <feDropShadow dx="1" dy="2" stdDeviation="3" floodOpacity="0.1"/>
                </filter>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
              
              {/* Rooms */}
              {rooms.map((room, i) => {
                const hasPoly = room.polygon && room.polygon.length >= 3 && room.polygonClosed;
                const pointsStr = hasPoly 
                  ? room.polygon!.map(p => `${room.x + p.x},${room.y + p.y}`).join(' ')
                  : '';

                return (
                  <g key={`room-${room.id || i}`} filter="url(#shadow)">
                    {hasPoly ? (
                      <polygon 
                        points={pointsStr}
                        fill={room.color || 'rgba(255,255,255,1)'}
                        stroke="#171717"
                        strokeWidth="1.5"
                      />
                    ) : (
                      <rect 
                        x={room.x} y={room.y} width={room.width} height={room.height}
                        fill={room.color || '#ffffff'}
                        stroke="#171717"
                        strokeWidth="1.5"
                      />
                    )}
                    
                    <text 
                      x={room.x + room.width / 2} 
                      y={room.y + room.height / 2} 
                      textAnchor="middle" 
                      dominantBaseline="middle"
                      fontSize="6"
                      fontWeight="600"
                      fill="#333"
                      pointerEvents="none"
                    >
                      {room.name}
                    </text>

                    {/* Openings (Doors/Windows) */}
                    {room.openings && room.openings.map((op, j) => (
                       <rect 
                         key={`op-${op.id || j}`}
                         x={room.x + op.x} y={room.y + op.y}
                         width={Math.max(2, op.width)} height={Math.max(2, op.height)}
                         fill={op.type === 'DOOR' ? '#ffe4e6' : '#e0f2fe'}
                         stroke="#171717"
                         strokeWidth="1"
                       />
                    ))}
                  </g>
                );
              })}
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
