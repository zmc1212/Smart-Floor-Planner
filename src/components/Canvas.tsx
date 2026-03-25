import React, { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Rect, Line, Text, Group, Circle } from 'react-konva';
import { RoomData, ToolType, Point } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { Trash2, Maximize2, Sparkles, Settings } from 'lucide-react';

interface CanvasProps {
  activeTool: ToolType;
  rooms: RoomData[];
  onRoomsChange: (newRooms: RoomData[]) => void;
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  currentRoomType: string;
  highlightedOpeningId: string | null;
}

const GRID_SIZE = 20;
const SCALE_FACTOR = 10; // 1px = 10cm (0.1m)

export const Canvas: React.FC<CanvasProps> = ({
  activeTool,
  rooms,
  onRoomsChange,
  selectedIds,
  setSelectedIds,
  currentRoomType,
  highlightedOpeningId,
}) => {
  const [newRoom, setNewRoom] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const stageRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [menuPos, setMenuPos] = useState<{ x: number, y: number } | null>(null);

  useEffect(() => {
    if (selectedIds.length === 1 && stageRef.current) {
      const room = rooms.find(r => r.id === selectedIds[0]);
      if (room) {
        const stage = stageRef.current;
        const scale = stage.scaleX();
        // Calculate screen position of the room
        const screenX = (room.x * scale) + stage.x();
        const screenY = (room.y * scale) + stage.y();
        
        setMenuPos({
          x: screenX + (room.width * scale) / 2,
          y: screenY - 10
        });
      }
    } else {
      setMenuPos(null);
    }
  }, [selectedIds, rooms, dimensions]);

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

  const getRelativePointerPosition = (stage: any) => {
    const transform = stage.getAbsoluteTransform().copy().invert();
    const pos = stage.getPointerPosition();
    return transform.point(pos);
  };

  const handleWheel = (e: any) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    const scaleBy = 1.1;
    const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;

    // Limit scale
    const limitedScale = Math.max(0.1, Math.min(newScale, 5));

    stage.scale({ x: limitedScale, y: limitedScale });

    const newPos = {
      x: pointer.x - mousePointTo.x * limitedScale,
      y: pointer.y - mousePointTo.y * limitedScale,
    };
    stage.position(newPos);
    stage.batchDraw();
  };

  const handleMouseDown = (e: any) => {
    // Prevent default to stop scrolling/dragging on mobile
    if (e.evt && e.evt.preventDefault) {
      // e.evt.preventDefault(); // Removing this to allow stage dragging
    }

    const stage = e.target.getStage();
    const pos = getRelativePointerPosition(stage);
    const snappedPos = {
      x: Math.round(pos.x / GRID_SIZE) * GRID_SIZE,
      y: Math.round(pos.y / GRID_SIZE) * GRID_SIZE,
    };

    // If we are drawing or placing, stop the stage from dragging
    if (activeTool !== ToolType.SELECT) {
      stage.stopDrag();
    }

    if (activeTool === ToolType.ROOM) {
      // Only clear selection if clicking the stage background
      if (e.target === stage) {
        setNewRoom({ ...snappedPos, width: 0, height: 0 });
        setSelectedIds([]);
      }
    } else if (activeTool === ToolType.DOOR || activeTool === ToolType.WINDOW) {
      // Clear selection when clicking blank stage area
      if (e.target === stage) {
        setSelectedIds([]);
      }

      // Find the nearest wall to place door/window
      const threshold = 15;
      let foundWall = false;

      const newRooms = rooms.map(room => {
        if (foundWall) return room;

        const walls = [
          { side: 'top', dist: Math.abs(pos.y - room.y), x: pos.x, y: room.y, rotation: 0 },
          { side: 'bottom', dist: Math.abs(pos.y - (room.y + room.height)), x: pos.x, y: room.y + room.height, rotation: 0 },
          { side: 'left', dist: Math.abs(pos.x - room.x), x: room.x, y: pos.y, rotation: 90 },
          { side: 'right', dist: Math.abs(pos.x - (room.x + room.width)), x: room.x + room.width, y: pos.y, rotation: 90 },
        ];

        const nearestWall = walls.reduce((prev, curr) => prev.dist < curr.dist ? prev : curr);

        if (nearestWall.dist < threshold) {
          // Check if the point is within the wall's length
          const isWithinLength = nearestWall.rotation === 0 
            ? (pos.x >= room.x && pos.x <= room.x + room.width)
            : (pos.y >= room.y && pos.y <= room.y + room.height);

          if (isWithinLength) {
            foundWall = true;
            const openingWidth = activeTool === ToolType.DOOR ? 10 : 15; // 1m or 1.5m
            const openingHeight = activeTool === ToolType.DOOR ? 20 : 12; // 2m or 1.2m
            const opening = {
              id: uuidv4(),
              type: activeTool === ToolType.DOOR ? 'DOOR' : 'WINDOW' as 'DOOR' | 'WINDOW',
              x: (nearestWall.rotation === 0 ? Math.round(pos.x / 5) * 5 : nearestWall.x) - room.x,
              y: (nearestWall.rotation === 90 ? Math.round(pos.y / 5) * 5 : nearestWall.y) - room.y,
              rotation: nearestWall.rotation,
              width: openingWidth,
              height: openingHeight,
            };
            return {
              ...room,
              openings: [...(room.openings || []), opening]
            };
          }
        }
        return room;
      });

      if (foundWall) {
        onRoomsChange(newRooms);
      }
    } else if (activeTool === ToolType.ERASER) {
      // Erase openings or rooms
      const threshold = 10;
      let erased = false;

      const newRooms = rooms.map(room => {
        if (erased) return room;

        // Check if clicked on an opening
        const remainingOpenings = room.openings?.filter(opening => {
          const absX = room.x + opening.x;
          const absY = room.y + opening.y;
          const dist = Math.sqrt(Math.pow(pos.x - absX, 2) + Math.pow(pos.y - absY, 2));
          if (dist < threshold) {
            erased = true;
            return false;
          }
          return true;
        });

        if (erased) {
          return { ...room, openings: remainingOpenings };
        }

        // Check if clicked inside a room
        if (pos.x >= room.x && pos.x <= room.x + room.width && pos.y >= room.y && pos.y <= room.y + room.height) {
          erased = true;
          return null; // Mark for deletion
        }

        return room;
      }).filter(Boolean) as RoomData[];

      if (erased) {
        onRoomsChange(newRooms);
        setSelectedIds([]);
      }
    } else if (activeTool === ToolType.SELECT) {
      if (e.target === e.target.getStage()) {
        setSelectedIds([]);
      }
    }
  };

  const handleMouseMove = (e: any) => {
    if (e.evt && e.evt.preventDefault) {
      // e.evt.preventDefault();
    }
    if (!newRoom || activeTool !== ToolType.ROOM) return;

    const stage = e.target.getStage();
    const pos = getRelativePointerPosition(stage);
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

  const handleMouseUp = (e: any) => {
    if (e.evt && e.evt.preventDefault) {
      // e.evt.preventDefault();
    }
    if (newRoom && activeTool === ToolType.ROOM) {
      if (Math.abs(newRoom.width) > GRID_SIZE && Math.abs(newRoom.height) > GRID_SIZE) {
        const room: RoomData = {
          id: uuidv4(),
          x: newRoom.width > 0 ? newRoom.x : newRoom.x + newRoom.width,
          y: newRoom.height > 0 ? newRoom.y : newRoom.y + newRoom.height,
          width: Math.abs(newRoom.width),
          height: Math.abs(newRoom.height),
          name: currentRoomType,
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
    // We allow selection even if not in SELECT mode 
    // to make it easier to edit properties or deselect
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
    <div 
      className="w-full h-full bg-[#f0f0f0] overflow-hidden relative touch-none" 
      id="canvas-container" 
      ref={containerRef}
      style={{ touchAction: 'none' }}
    >
      <Stage
        width={dimensions.width}
        height={dimensions.height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleMouseDown}
        onTouchMove={handleMouseMove}
        onTouchEnd={handleMouseUp}
        onWheel={handleWheel}
        draggable={true}
        ref={stageRef}
        onDragMove={() => {
          // Force update menu position during stage drag
          setDimensions({ ...dimensions });
        }}
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

              {/* Openings (Doors & Windows) */}
              {room.openings?.map((opening) => (
                <Group
                  key={opening.id}
                  x={opening.x}
                  y={opening.y}
                  rotation={opening.rotation}
                >
                  {opening.type === 'DOOR' ? (
                    <Group>
                      {/* Highlight Effect */}
                      {highlightedOpeningId === opening.id && (
                        <Rect
                          x={-opening.width / 2 - 4}
                          y={-opening.width - 4}
                          width={opening.width + 8}
                          height={opening.width + 8}
                          fill="rgba(59, 130, 246, 0.2)"
                          cornerRadius={4}
                        />
                      )}
                      {/* Opening Gap */}
                      <Rect
                        x={-opening.width / 2}
                        y={-1.5}
                        width={opening.width}
                        height={3}
                        fill="white"
                      />
                      {/* Door Leaf */}
                      <Line
                        points={[-opening.width / 2, 0, -opening.width / 2, -opening.width]}
                        stroke="#3b82f6"
                        strokeWidth={2}
                      />
                      {/* Door Swing Arc */}
                      <Line
                        points={[-opening.width / 2, -opening.width, opening.width / 2, 0]}
                        stroke="#3b82f6"
                        strokeWidth={1}
                        dash={[2, 2]}
                      />
                    </Group>
                  ) : (
                    <Group>
                      {/* Highlight Effect */}
                      {highlightedOpeningId === opening.id && (
                        <Rect
                          x={-opening.width / 2 - 4}
                          y={-6}
                          width={opening.width + 8}
                          height={12}
                          fill="rgba(59, 130, 246, 0.2)"
                          cornerRadius={4}
                        />
                      )}
                      {/* Window Frame */}
                      <Rect
                        x={-opening.width / 2}
                        y={-2}
                        width={opening.width}
                        height={4}
                        fill="#93c5fd"
                        stroke="#3b82f6"
                        strokeWidth={1}
                      />
                      <Line
                        points={[-opening.width / 2, 0, opening.width / 2, 0]}
                        stroke="#3b82f6"
                        strokeWidth={1}
                      />
                    </Group>
                  )}
                </Group>
              ))}
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

      {/* Floating Quick Menu */}
      {menuPos && (
        <div 
          className="absolute z-50 flex items-center gap-1 bg-white/90 backdrop-blur-md p-1 rounded-lg shadow-xl border border-gray-200 -translate-x-1/2 -translate-y-full mb-2 pointer-events-auto"
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          <div className="px-2 py-1 text-[10px] font-bold text-gray-500 border-r border-gray-100 mr-1">
            {rooms.find(r => r.id === selectedIds[0])?.name}
          </div>
          <button 
            onClick={() => {
              const id = selectedIds[0];
              const newRooms = rooms.filter(r => r.id !== id);
              onRoomsChange(newRooms);
              setSelectedIds([]);
            }}
            className="p-1.5 text-gray-600 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
            title="删除"
          >
            <Trash2 size={14} />
          </button>
          <button 
            onClick={() => {
              // Focus on properties panel by just keeping it selected
              // In a real app we might trigger a scroll or highlight
            }}
            className="p-1.5 text-gray-600 hover:text-blue-500 hover:bg-blue-50 rounded-md transition-colors"
            title="属性"
          >
            <Settings size={14} />
          </button>
        </div>
      )}
      
      <div className="absolute bottom-4 left-4 bg-white/80 backdrop-blur-sm px-3 py-1 rounded-full text-[10px] text-gray-500 font-mono border border-gray-200">
        比例尺: 1:10 (10px = 1m) | 网格: 0.2m
      </div>
    </div>
  );
};
