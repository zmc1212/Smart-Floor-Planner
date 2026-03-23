import React from 'react';
import { RoomData } from '../types';
import { Trash2, Move, Maximize2, Merge } from 'lucide-react';

interface PropertiesProps {
  selectedRooms: RoomData[];
  onUpdate: (id: string, updates: Partial<RoomData>) => void;
  onDelete: () => void;
  onMerge: () => void;
}

export const Properties: React.FC<PropertiesProps> = ({ selectedRooms, onUpdate, onDelete, onMerge }) => {
  if (selectedRooms.length === 0) {
    return (
      <div className="md:w-80 w-0 md:flex hidden bg-white border-l border-gray-200 p-6 flex-col items-center justify-center text-gray-400 text-center">
        <div className="mb-4 opacity-20">
          <Maximize2 size={48} />
        </div>
        <p className="text-sm">选择画布上的房间以编辑属性</p>
      </div>
    );
  }

  const content = (
    <div className="flex flex-col gap-6 h-full">
      {selectedRooms.length > 1 ? (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">批量操作</h2>
            <button
              onClick={onDelete}
              className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            >
              <Trash2 size={20} />
            </button>
          </div>
          
          <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
            <p className="text-sm text-blue-800 mb-4">已选择 {selectedRooms.length} 个房间</p>
            <button
              onClick={onMerge}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition-all shadow-md active:scale-95"
            >
              <Merge size={18} />
              合并房间
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">房间属性</h2>
            <button
              onClick={onDelete}
              className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            >
              <Trash2 size={20} />
            </button>
          </div>

          <div className="space-y-4 overflow-y-auto pr-2">
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                房间名称
              </label>
              <input
                type="text"
                value={selectedRooms[0].name}
                onChange={(e) => onUpdate(selectedRooms[0].id, { name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                  宽度 (米)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={selectedRooms[0].width / 10}
                  onChange={(e) => onUpdate(selectedRooms[0].id, { width: parseFloat(e.target.value) * 10 })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                  长度 (米)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={selectedRooms[0].height / 10}
                  onChange={(e) => onUpdate(selectedRooms[0].id, { height: parseFloat(e.target.value) * 10 })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                背景颜色
              </label>
              <div className="flex gap-2 flex-wrap">
                {['rgba(255, 255, 255, 0.8)', 'rgba(243, 244, 246, 0.8)', 'rgba(219, 234, 254, 0.8)', 'rgba(220, 252, 231, 0.8)', 'rgba(254, 243, 199, 0.8)'].map((color) => (
                  <button
                    key={color}
                    onClick={() => onUpdate(selectedRooms[0].id, { color })}
                    className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${
                      selectedRooms[0].color === color ? 'border-blue-500' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      <div className="mt-auto pt-4 border-t border-gray-100 md:block hidden">
        <div className="bg-blue-50 p-4 rounded-xl">
          <h3 className="text-xs font-bold text-blue-700 uppercase mb-2 flex items-center gap-2">
            <Move size={14} /> 操作提示
          </h3>
          <ul className="text-[11px] text-blue-600 space-y-1 opacity-80">
            <li>• 拖拽房间边缘可调整大小</li>
            <li>• 拖拽房间中心可移动位置</li>
            <li>• 按住 Shift 点击可多选房间</li>
          </ul>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Panel */}
      <div className="md:w-80 w-0 md:flex hidden bg-white border-l border-gray-200 p-6 flex-col shadow-sm z-10">
        {content}
      </div>

      {/* Mobile Bottom Sheet */}
      <div className="md:hidden block fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-6 rounded-t-3xl shadow-[0_-10px_30px_rgba(0,0,0,0.1)] z-40 max-h-[50vh] overflow-y-auto">
        <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6" />
        {content}
      </div>
    </>
  );
};
