import React from 'react';
import { ToolType } from '../types';
import { MousePointer2, Square, DoorOpen, Grid, Eraser, Plus } from 'lucide-react';

interface ToolbarProps {
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({ activeTool, setActiveTool }) => {
  const tools = [
    { id: ToolType.SELECT, icon: MousePointer2, label: '选择' },
    { id: ToolType.ROOM, icon: Square, label: '绘制房间' },
    { id: ToolType.DOOR, icon: DoorOpen, label: '门' },
    { id: ToolType.WINDOW, icon: Grid, label: '窗户' },
    { id: ToolType.ERASER, icon: Eraser, label: '橡皮擦' },
  ];

  return (
    <div className="md:w-20 w-full md:h-full h-16 bg-white border-r md:border-b-0 border-b border-gray-200 flex md:flex-col flex-row items-center md:py-6 px-4 md:px-0 gap-4 shadow-sm z-30">
      {tools.map((tool) => (
        <button
          key={tool.id}
          onClick={() => setActiveTool(tool.id)}
          className={`p-3 rounded-xl transition-all duration-200 group relative flex-shrink-0 ${
            activeTool === tool.id
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-200'
              : 'text-gray-500 hover:bg-gray-100'
          }`}
          title={tool.label}
        >
          <tool.icon size={24} className="md:w-6 md:h-6 w-5 h-5" />
          <span className="absolute left-full ml-2 px-2 py-1 bg-gray-800 text-white text-[10px] rounded opacity-0 md:group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 hidden md:block">
            {tool.label}
          </span>
        </button>
      ))}
    </div>
  );
};
