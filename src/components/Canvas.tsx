import React, { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Rect, Line, Text, Group, Circle } from 'react-konva';
import { RoomData, ToolType, Point } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface CanvasProps {
  activeTool: ToolType;
  rooms: RoomData[];
  onRoomsChange: (newRooms: RoomData[]) => void;
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
}

const GRID_SIZE = 20;
const SCALE_FACTOR = 10; // 1px = 10cm (0.1m)

export const Canvas: React.FC<CanvasProps> = ({
  activeTool,
  rooms,
  onRoomsChange,
  selectedIds,
  setSelectedIds,
}) => {
  const [newRoom, setNewRoom] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const stageRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const handleMouseDown = (e: any) => {
    const pos = e.target.getStage().getPointerPosition();
    const snappedPos = {
      x: Math.round(pos.x / GRID_SIZE) * GRID_SIZE,
      y: Math.round(pos.y / GRID_SIZE) * GRID_SIZE,
    };

    if (activeTool === ToolType.ROOM) {
      setNewRoom({ ...snappedPos, width: 0, height: 0 });
      setSelectedIds([]);
    } else if (activeTool === ToolType.SELECT) {
      if (e.target === e.target.getStage()) {
        setSelectedIds([]);
      }
    }
  };

  const handleMouseMove = (e: any) => {
    if (!newRoom || activeTool !== ToolType.ROOM) return;

    const pos = e.target.getStage().getPointerPosition();
    const snappedPos = {
      x: Math.round(pos.x / GRID_SIZE) * GRID_SIZE,
      y: Math.round(pos.y / GRID_SIZE) * GRID_SIZE,
    };

    setNewRoom((prev) => prev ? ({
      ...prev,
      width: snappedPos.x - prev.x,
      height: snappedPos.y - prev.y,
    }) : null);
  };

  const handleMouseUp = () => {
    if (newRoom && activeTool === ToolType.ROOM) {
      if (Math.abs(newRoom.width) > GRID_SIZE && Math.abs(newRoom.height) > GRID_SIZE) {
        const room: RoomData = {
          id: uuidv4(),
          x: newRoom.width > 0 ? newRoom.x : newRoom.x + newRoom.width,
          y: newRoom.height > 0 ? newRoom.y : newRoom.y + newRoom.height,
          width: Math.abs(newRoom.width),
          height: Math.abs(newRoom.height),
          name: '新房间',
          color: 'rgba(255, 255, 255, 0.8)',
        };
        onRoomsChange([...rooms, room]);
        setSelectedIds([room.id]);
      }
      setNewRoom(null);
    }
  };

  const handleDragEnd = (id: string, e: any) => {
    const { x, y } = e.target.position();
    const snappedX = Math.round(x / GRID_SIZE) * GRID_SIZE;
    const snappedY = Math.round(y / GRID_SIZE) * GRID_SIZE;
    
    const newRooms = rooms.map((r) => (r.id === id ? { ...r, x: snappedX, y: snappedY } : r));
    onRoomsChange(newRooms);
    e.target.position({ x: snappedX, y: snappedY });
  };

  const handleRoomClick = (id: string, e: any) => {
    if (activeTool !== ToolType.SELECT) return;
    
    const isShift = e.evt.shiftKey;
    if (isShift) {
      setSelectedIds(
        selectedIds.includes(id)
          ? selectedIds.filter((i) => i !== id)
          : [...selectedIds, id]
      );
    } else {
      setSelectedIds([id]);
    }
  };

  return (
    <div className="w-full h-full bg-[#f0f0f0] overflow-hidden relative" id="canvas-container" ref={containerRef}>
      <Stage
        width={dimensions.width}
        height={dimensions.height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleMouseDown}
        onTouchMove={handleMouseMove}
        onTouchEnd={handleMouseUp}
        ref={stageRef}
      >
        <Layer>
          {/* Grid */}
          {[...Array(Math.ceil(2000 / GRID_SIZE))].map((_, i) => (
            <Line
              key={`v-${i}`}
              points={[i * GRID_SIZE, 0, i * GRID_SIZE, 2000]}
              stroke="#e0e0e0"
              strokeWidth={1}
            />
          ))}
          {[...Array(Math.ceil(2000 / GRID_SIZE))].map((_, i) => (
            <Line
              key={`h-${i}`}
              points={[0, i * GRID_SIZE, 2000, i * GRID_SIZE]}
              stroke="#e0e0e0"
              strokeWidth={1}
            />
          ))}

          {/* Rooms */}
          {rooms.map((room) => (
            <Group
              key={room.id}
              x={room.x}
              y={room.y}
              draggable={activeTool === ToolType.SELECT}
              onDragEnd={(e) => handleDragEnd(room.id, e)}
              onClick={(e) => handleRoomClick(room.id, e)}
              onTap={(e) => handleRoomClick(room.id, e)}
            >
              <Rect
                width={room.width}
                height={room.height}
                fill={room.color}
                stroke={selectedIds.includes(room.id) ? '#3b82f6' : '#141414'}
                strokeWidth={selectedIds.includes(room.id) ? 3 : 2}
                cornerRadius={2}
              />
              <Text
                text={`${room.name}\n${(room.width / 10).toFixed(1)}m x ${(room.height / 10).toFixed(1)}m`}
                width={room.width}
                height={room.height}
                align="center"
                verticalAlign="middle"
                fontSize={12}
                fill="#141414"
              />
              
              {/* Dimension Labels */}
              <Text
                x={room.width / 2 - 20}
                y={-15}
                text={`${(room.width / 10).toFixed(1)}m`}
                fontSize={10}
                fill="#666"
              />
              <Text
                x={room.width + 5}
                y={room.height / 2 - 5}
                text={`${(room.height / 10).toFixed(1)}m`}
                fontSize={10}
                fill="#666"
              />
            </Group>
          ))}

          {/* New Room Preview */}
          {newRoom && (
            <Rect
              x={newRoom.width > 0 ? newRoom.x : newRoom.x + newRoom.width}
              y={newRoom.height > 0 ? newRoom.y : newRoom.y + newRoom.height}
              width={Math.abs(newRoom.width)}
              height={Math.abs(newRoom.height)}
              fill="rgba(59, 130, 246, 0.2)"
              stroke="#3b82f6"
              strokeWidth={1}
              dash={[5, 5]}
            />
          )}
        </Layer>
      </Stage>
      
      <div className="absolute bottom-4 left-4 bg-white/80 backdrop-blur-sm px-3 py-1 rounded-full text-[10px] text-gray-500 font-mono border border-gray-200">
        比例尺: 1:10 (10px = 1m) | 网格: 0.2m
      </div>
    </div>
  );
};
