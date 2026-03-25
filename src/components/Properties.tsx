import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RoomData, StyleType, AIProvider } from '../types';
import { Trash2, Move, Maximize2, Merge, Sparkles, Image as ImageIcon, Download, Loader2, X, Cpu } from 'lucide-react';
import { generateRendering } from '../services/renderingService';

interface PropertiesProps {
  selectedRooms: RoomData[];
  onUpdate: (id: string, updates: Partial<RoomData>) => void;
  onDelete: () => void;
  onMerge: () => void;
  onClose: () => void;
  setHighlightedOpeningId: (id: string | null) => void;
}

export const Properties: React.FC<PropertiesProps> = ({ 
  selectedRooms, 
  onUpdate, 
  onDelete, 
  onMerge, 
  onClose,
  setHighlightedOpeningId
}) => {
  const [selectedStyle, setSelectedStyle] = useState<StyleType>(StyleType.MODERN);
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>(AIProvider.GEMINI);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showRendering, setShowRendering] = useState(false);

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

  const handleGenerate = async () => {
    if (selectedRooms.length !== 1) return;
    setIsGenerating(true);
    try {
      const room = selectedRooms[0];
      const url = await generateRendering(
        room.name, 
        selectedStyle, 
        room.width, 
        room.height, 
        room.openings || [],
        selectedProvider
      );
      onUpdate(room.id, { renderingUrl: url, lastProvider: selectedProvider });
      setShowRendering(true);
    } catch (error: any) {
      const message = error?.message || "生成效果图失败，请重试。";
      alert(message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = () => {
    const url = selectedRooms[0].renderingUrl;
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedRooms[0].name}_效果图.png`;
    link.click();
  };

  const content = (
    <div className="flex flex-col gap-6 h-full pb-6 md:pb-0">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">
          {selectedRooms.length > 1 ? '批量操作' : '房间属性'}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="md:hidden p-2 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors"
            title="关闭"
          >
            <Maximize2 size={20} className="rotate-45" />
          </button>
          <button
            onClick={onDelete}
            className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            title="删除"
          >
            <Trash2 size={20} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
        {selectedRooms.length > 1 ? (
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
        ) : (
          <div className="space-y-6">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                  房间名称 {['客厅', '主卧', '次卧', '主卫', '次卫', '书房', '厨房'].includes(selectedRooms[0].name) && '(不可修改)'}
                </label>
                <input
                  type="text"
                  value={selectedRooms[0].name}
                  onChange={(e) => onUpdate(selectedRooms[0].id, { name: e.target.value })}
                  disabled={['客厅', '主卧', '次卧', '主卫', '次卫', '书房', '厨房'].includes(selectedRooms[0].name)}
                  className={`w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all ${
                    ['客厅', '主卧', '次卧', '主卫', '次卫', '书房', '厨房'].includes(selectedRooms[0].name) ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : ''
                  }`}
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

              {/* Openings Management */}
              {selectedRooms[0].openings && selectedRooms[0].openings.length > 0 && (
                <div className="pt-4 border-t border-gray-100">
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                    门窗管理 ({selectedRooms[0].openings.length})
                  </label>
                  <div className="space-y-3">
                    {selectedRooms[0].openings.map((opening, idx) => (
                      <div 
                        key={opening.id} 
                        className="bg-gray-50 p-3 rounded-lg border border-gray-100 transition-all hover:border-blue-300 hover:shadow-sm"
                        onMouseEnter={() => setHighlightedOpeningId(opening.id)}
                        onMouseLeave={() => setHighlightedOpeningId(null)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-bold text-blue-600 uppercase">
                            {opening.type === 'DOOR' ? '门' : '窗户'} #{idx + 1}
                          </span>
                          <button 
                            onClick={() => {
                              const newOpenings = selectedRooms[0].openings?.filter(o => o.id !== opening.id);
                              onUpdate(selectedRooms[0].id, { openings: newOpenings });
                            }}
                            className="text-gray-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] text-gray-400 mb-1">宽度 (米)</label>
                            <input
                              type="number"
                              step="0.1"
                              value={opening.width / 10}
                              onChange={(e) => {
                                const newOpenings = selectedRooms[0].openings?.map(o => 
                                  o.id === opening.id ? { ...o, width: parseFloat(e.target.value) * 10 } : o
                                );
                                onUpdate(selectedRooms[0].id, { openings: newOpenings });
                              }}
                              className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-gray-400 mb-1">高度 (米)</label>
                            <input
                              type="number"
                              step="0.1"
                              value={opening.height / 10}
                              onChange={(e) => {
                                const newOpenings = selectedRooms[0].openings?.map(o => 
                                  o.id === opening.id ? { ...o, height: parseFloat(e.target.value) * 10 } : o
                                );
                                onUpdate(selectedRooms[0].id, { openings: newOpenings });
                              }}
                              className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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

            <div className="pt-6 border-t border-gray-100">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles size={16} className="text-purple-500" />
                <h3 className="text-sm font-semibold text-gray-900">AI 效果图预览</h3>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Cpu size={12} /> AI 模型
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    {Object.values(AIProvider).map((provider) => (
                      <button
                        key={provider}
                        onClick={() => setSelectedProvider(provider)}
                        className={`px-3 py-2 text-xs rounded-lg border text-left transition-all flex items-center justify-between ${
                          selectedProvider === provider
                            ? 'bg-blue-50 border-blue-500 text-blue-700 font-medium'
                            : 'bg-white border-gray-200 text-gray-600 hover:border-blue-200'
                        }`}
                      >
                        {provider}
                        {selectedProvider === provider && <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                    装修风格
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.values(StyleType).map((style) => (
                      <button
                        key={style}
                        onClick={() => setSelectedStyle(style)}
                        className={`px-3 py-2 text-xs rounded-lg border transition-all ${
                          selectedStyle === style
                            ? 'bg-purple-50 border-purple-500 text-purple-700 font-medium'
                            : 'bg-white border-gray-200 text-gray-600 hover:border-purple-200'
                        }`}
                      >
                        {style}
                      </button>
                    ))}
                  </div>
                </div>

                {selectedRooms[0].renderingUrl ? (
                  <div className="relative group rounded-xl overflow-hidden border border-gray-200 aspect-video bg-gray-50">
                    <img 
                      src={selectedRooms[0].renderingUrl} 
                      alt="Rendering" 
                      className="w-full h-full object-cover cursor-pointer"
                      onClick={() => setShowRendering(true)}
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute top-2 left-2 bg-black/60 backdrop-blur px-2 py-1 rounded text-[10px] text-white font-medium">
                      {selectedRooms[0].lastProvider || 'AI 生成'}
                    </div>
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                      <button 
                        onClick={() => setShowRendering(true)}
                        className="p-2 bg-white rounded-full text-gray-900 hover:scale-110 transition-transform"
                      >
                        <ImageIcon size={18} />
                      </button>
                      <button 
                        onClick={handleDownload}
                        className="p-2 bg-white rounded-full text-gray-900 hover:scale-110 transition-transform"
                      >
                        <Download size={18} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="aspect-video bg-gray-50 rounded-xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center text-gray-400 gap-2">
                    <ImageIcon size={32} className="opacity-20" />
                    <p className="text-[10px]">尚未生成效果图</p>
                  </div>
                )}

                <button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white py-3 rounded-xl font-medium hover:shadow-lg hover:shadow-purple-200 transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      正在生成中...
                    </>
                  ) : (
                    <>
                      <Sparkles size={18} />
                      生成 AI 效果图
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Fullscreen Preview Modal */}
      <AnimatePresence>
        {showRendering && selectedRooms[0]?.renderingUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 md:p-12"
            onClick={() => setShowRendering(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative max-w-5xl w-full bg-white rounded-2xl overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="absolute top-4 right-4 z-10 flex gap-2">
                <button
                  onClick={handleDownload}
                  className="p-2 bg-white/90 hover:bg-white rounded-full text-gray-900 shadow-lg transition-all"
                  title="下载图片"
                >
                  <Download size={20} />
                </button>
                <button
                  onClick={() => setShowRendering(false)}
                  className="p-2 bg-white/90 hover:bg-white rounded-full text-gray-900 shadow-lg transition-all"
                >
                  <X size={20} />
                </button>
              </div>
              <img 
                src={selectedRooms[0].renderingUrl} 
                alt="Full Preview" 
                className="w-full h-auto max-h-[80vh] object-contain bg-gray-100"
                referrerPolicy="no-referrer"
              />
              <div className="p-6 flex items-center justify-between bg-white">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{selectedRooms[0].name}</h3>
                  <p className="text-sm text-gray-500">{selectedStyle}风格 • AI 生成效果图</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400 font-mono">Smart Floor Planner Pro AI Engine</p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
    <AnimatePresence>
      {selectedRooms.length > 0 && (
        <>
          {/* Desktop Panel */}
          <motion.div 
            initial={{ x: 320 }}
            animate={{ x: 0 }}
            exit={{ x: 320 }}
            className="md:w-80 w-0 md:flex hidden bg-white border-l border-gray-200 p-6 flex-col shadow-sm z-10"
          >
            {content}
          </motion.div>

          {/* Mobile Bottom Sheet */}
          <motion.div 
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="md:hidden block fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-6 rounded-t-3xl shadow-[0_-10px_30px_rgba(0,0,0,0.1)] z-40 max-h-[60vh] overflow-y-auto"
          >
            <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6" />
            {content}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
