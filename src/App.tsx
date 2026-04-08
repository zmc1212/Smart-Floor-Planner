import React, { useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { Canvas } from './components/Canvas';
import { Properties } from './components/Properties';
import { ToolType, RoomData } from './types';
import { Layout, Save, Download, Share2, Settings, Undo2, Redo2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [activeTool, setActiveTool] = useState<ToolType>(ToolType.SELECT);
  const [currentRoomType, setCurrentRoomType] = useState<string>('客厅');
  const [history, setHistory] = useState<RoomData[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [highlightedOpeningId, setHighlightedOpeningId] = useState<string | null>(null);
  const [isPropertiesCollapsed, setIsPropertiesCollapsed] = useState(false);

  const rooms = history[historyIndex];
  const selectedRooms = rooms.filter((r) => selectedIds.includes(r.id));

  const pushToHistory = (newRooms: RoomData[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newRooms);
    // Limit history size to 50
    if (newHistory.length > 50) newHistory.shift();
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const handleUpdateRoom = (id: string, updates: Partial<RoomData>) => {
    const newRooms = rooms.map((r) => (r.id === id ? { ...r, ...updates } : r));
    pushToHistory(newRooms);
  };

  const handleDeleteRooms = () => {
    const newRooms = rooms.filter((r) => !selectedIds.includes(r.id));
    pushToHistory(newRooms);
    setSelectedIds([]);
  };

  const handleMergeRooms = () => {
    if (selectedRooms.length < 2) return;

    const minX = Math.min(...selectedRooms.map(r => r.x));
    const minY = Math.min(...selectedRooms.map(r => r.y));
    const maxX = Math.max(...selectedRooms.map(r => r.x + r.width));
    const maxY = Math.max(...selectedRooms.map(r => r.y + r.height));

    const mergedRoom: RoomData = {
      id: crypto.randomUUID(),
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      name: `${selectedRooms[0].name} (合并)`,
      color: selectedRooms[0].color,
    };

    const newRooms = [
      ...rooms.filter(r => !selectedIds.includes(r.id)),
      mergedRoom
    ];
    pushToHistory(newRooms);
    setSelectedIds([mergedRoom.id]);
  };

  const undo = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setSelectedIds([]);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setSelectedIds([]);
    }
  };

  const handleExport = () => {
    const dataStr = JSON.stringify(rooms, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    const exportFileDefaultName = 'floor-plan.json';

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  return (
    <div className="flex flex-col h-dvh bg-[#f8f9fa] font-sans text-gray-900 overflow-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      {/* Header */}
      <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between pl-4 pr-[calc(1rem+var(--wechat-capsule-padding))] md:px-6 z-20 shadow-sm">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="bg-blue-600 p-1.5 md:p-2 rounded-lg text-white">
            <Layout size={18} className="md:w-5 md:h-5" />
          </div>
          <div className="overflow-hidden">
            <h1 className="text-sm md:text-lg font-bold tracking-tight truncate">智能量房大师</h1>
            <p className="text-[8px] md:text-[10px] text-gray-400 uppercase tracking-widest font-medium hidden sm:block">Smart Floor Planner Pro</p>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          <div className="flex items-center bg-gray-100 p-1 rounded-lg gap-0.5 md:gap-1">
            <button 
              onClick={undo}
              disabled={historyIndex === 0}
              className="p-1.5 md:p-2 text-gray-600 hover:bg-white hover:shadow-sm rounded-md transition-all disabled:opacity-30 disabled:hover:bg-transparent"
              title="撤销 (Ctrl+Z)"
            >
              <Undo2 size={16} className="md:w-[18px] md:h-[18px]" />
            </button>
            <button 
              onClick={redo}
              disabled={historyIndex === history.length - 1}
              className="p-1.5 md:p-2 text-gray-600 hover:bg-white hover:shadow-sm rounded-md transition-all disabled:opacity-30 disabled:hover:bg-transparent"
              title="重做 (Ctrl+Y)"
            >
              <Redo2 size={16} className="md:w-[18px] md:h-[18px]" />
            </button>
          </div>

          <div className="w-px h-6 bg-gray-200 hidden sm:block" />

          <div className="flex items-center gap-1 md:gap-2">
            <button className="p-2 text-gray-600 hover:bg-gray-50 rounded-lg transition-colors sm:flex hidden items-center gap-2 px-4 py-2 text-sm font-medium">
              <Save size={18} />
              <span className="hidden lg:inline">保存</span>
            </button>
            <button 
              onClick={handleExport}
              className="p-2 text-gray-600 hover:bg-gray-50 rounded-lg transition-colors flex items-center gap-2 md:px-4 md:py-2 text-sm font-medium"
            >
              <Download size={18} />
              <span className="hidden lg:inline">导出</span>
            </button>
            <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
              <Settings size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-col md:flex-row flex-1 overflow-hidden">
        <Toolbar 
          activeTool={activeTool} 
          setActiveTool={setActiveTool} 
          currentRoomType={currentRoomType}
          setCurrentRoomType={setCurrentRoomType}
        />
        
        <div className="flex-1 relative order-first md:order-none">
          <Canvas
            activeTool={activeTool}
            rooms={rooms}
            onRoomsChange={pushToHistory}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            currentRoomType={currentRoomType}
            highlightedOpeningId={highlightedOpeningId}
            isPropertiesCollapsed={isPropertiesCollapsed}
          />
          
          {/* Tool Indicator */}
          <AnimatePresence>
            {activeTool !== ToolType.SELECT && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="absolute top-4 md:top-6 left-1/2 -translate-x-1/2 bg-gray-900/90 backdrop-blur text-white px-4 md:px-6 py-1.5 md:py-2 rounded-full text-xs md:text-sm font-medium shadow-xl flex items-center gap-2 md:gap-3 border border-white/10 z-50"
              >
                <div className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-blue-500 animate-pulse" />
                绘制模式
                <button 
                  onClick={() => setActiveTool(ToolType.SELECT)}
                  className="ml-1 md:ml-2 text-[10px] md:text-xs text-gray-400 hover:text-white underline underline-offset-4"
                >
                  取消
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <Properties
          selectedRooms={selectedRooms}
          onUpdate={handleUpdateRoom}
          onDelete={handleDeleteRooms}
          onMerge={handleMergeRooms}
          onClose={() => setSelectedIds([])}
          setHighlightedOpeningId={setHighlightedOpeningId}
          isCollapsed={isPropertiesCollapsed}
          setIsCollapsed={setIsPropertiesCollapsed}
        />
      </main>

      {/* Footer / Status Bar - Hidden on small mobile */}
      <footer className="h-8 bg-white border-t border-gray-200 hidden sm:flex items-center justify-between px-6 text-[10px] text-gray-400 font-mono">
        <div className="flex items-center gap-4">
          <span>房间总数: {rooms.length}</span>
          <span>总面积: {(rooms.reduce((acc, r) => acc + (r.width * r.height), 0) / 100).toFixed(2)} m²</span>
        </div>
        <div className="flex items-center gap-4">
          <span>坐标: 0, 0</span>
          <span className="text-blue-500 font-bold">READY</span>
        </div>
      </footer>
    </div>
  );
}
