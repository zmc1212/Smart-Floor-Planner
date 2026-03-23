import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ToolType } from '../types';
import { MousePointer2, Square, DoorOpen, Grid, Eraser, ChevronRight } from 'lucide-react';

interface ToolbarProps {
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;
  currentRoomType: string;
  setCurrentRoomType: (type: string) => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({ activeTool, setActiveTool, currentRoomType, setCurrentRoomType }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const roomTypes = ['客厅', '主卧', '次卧', '主卫', '次卫', '书房', '厨房'];
  
  // Close menu when switching tools
  useEffect(() => {
    if (activeTool !== ToolType.ROOM) {
      setIsMenuOpen(false);
    }
  }, [activeTool]);

  const tools = [
    { id: ToolType.SELECT, icon: MousePointer2, label: '选择' },
    { id: ToolType.ROOM, icon: Square, label: '绘制房间' },
    { id: ToolType.DOOR, icon: DoorOpen, label: '门' },
    { id: ToolType.WINDOW, icon: Grid, label: '窗户' },
    { id: ToolType.ERASER, icon: Eraser, label: '橡皮擦' },
  ];

  const handleToolClick = (toolId: ToolType) => {
    if (toolId === ToolType.ROOM) {
      if (activeTool === ToolType.ROOM) {
        setIsMenuOpen(!isMenuOpen);
      } else {
        setActiveTool(ToolType.ROOM);
        setIsMenuOpen(true);
      }
    } else {
      setActiveTool(toolId);
      setIsMenuOpen(false);
    }
  };

  return (
    <div className="md:w-20 w-full md:h-full h-16 bg-white border-r md:border-b-0 border-b border-gray-200 flex md:flex-col flex-row items-center md:py-6 px-4 md:px-0 gap-4 shadow-sm z-30 relative">
      {tools.map((tool) => (
        <div key={tool.id} className="relative group">
          <button
            onClick={() => handleToolClick(tool.id)}
            className={`p-3 rounded-xl transition-all duration-200 group relative flex-shrink-0 ${
              activeTool === tool.id
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-200'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
            title={tool.label}
          >
            <tool.icon size={24} className="md:w-6 md:h-6 w-5 h-5" />
            
            {/* Tool Label Tooltip */}
            <span className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-[10px] rounded opacity-0 md:group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 hidden md:block">
              {tool.label}
            </span>

            {/* Indicator for Room Type Popup */}
            {tool.id === ToolType.ROOM && (
              <div className="absolute -top-1 -right-1 w-2 h-2 bg-blue-400 rounded-full border border-white" />
            )}
          </button>
          
          {/* Room Type Popup Menu */}
          <AnimatePresence>
            {tool.id === ToolType.ROOM && isMenuOpen && (
              <motion.div
                initial={{ opacity: 0, x: -10, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -10, scale: 0.95 }}
                className="absolute md:left-full md:top-0 md:ml-4 bottom-full left-0 mb-4 md:mb-0 bg-white rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.15)] border border-gray-100 p-3 min-w-[140px] z-50"
              >
                <div className="flex items-center gap-2 mb-3 px-2">
                  <div className="w-1 h-4 bg-blue-600 rounded-full" />
                  <span className="text-xs font-bold text-gray-900">选择房间类型</span>
                </div>
                <div className="grid grid-cols-1 gap-1">
                  {roomTypes.map((type) => (
                    <button
                      key={type}
                      onClick={() => {
                        setCurrentRoomType(type);
                        setIsMenuOpen(false);
                      }}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all ${
                        currentRoomType === type
                          ? 'bg-blue-50 text-blue-700 font-bold'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {type}
                      {currentRoomType === type && <ChevronRight size={14} />}
                    </button>
                  ))}
                </div>
                {/* Arrow for Desktop */}
                <div className="hidden md:block absolute top-6 -left-2 w-4 h-4 bg-white border-l border-b border-gray-100 rotate-45" />
                {/* Arrow for Mobile */}
                <div className="md:hidden absolute -bottom-2 left-6 w-4 h-4 bg-white border-r border-b border-gray-100 rotate-45" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
};
