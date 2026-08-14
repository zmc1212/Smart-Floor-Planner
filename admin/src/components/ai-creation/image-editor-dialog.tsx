'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Circle, Download, Highlighter, MousePointer2, Pencil, Redo2, Square, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

type AnnotationTool = 'rectangle' | 'circle' | 'arrow' | 'pen' | 'marker';

const colors = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316'];

function drawArrow(context: CanvasRenderingContext2D, fromX: number, fromY: number, toX: number, toY: number) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const head = Math.max(12, context.lineWidth * 4);
  context.beginPath();
  context.moveTo(fromX, fromY);
  context.lineTo(toX, toY);
  context.moveTo(toX, toY);
  context.lineTo(toX - head * Math.cos(angle - Math.PI / 6), toY - head * Math.sin(angle - Math.PI / 6));
  context.moveTo(toX, toY);
  context.lineTo(toX - head * Math.cos(angle + Math.PI / 6), toY - head * Math.sin(angle + Math.PI / 6));
  context.stroke();
}

export function ImageEditorDialog({
  imageUrl,
  open,
  onOpenChange,
  onUse,
}: {
  imageUrl?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUse: (file: File, extraPrompt: string) => Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0 });
  const [tool, setTool] = useState<AnnotationTool>('rectangle');
  const [color, setColor] = useState(colors[0]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [extraPrompt, setExtraPrompt] = useState('');
  const [saving, setSaving] = useState(false);

  const restoreSnapshot = (snapshot: string) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const image = new Image();
    image.onload = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = snapshot;
  };

  useEffect(() => {
    if (!open || !imageUrl) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const firstSnapshot = canvas.toDataURL('image/png');
      setHistory([firstSnapshot]);
      setHistoryIndex(0);
      setExtraPrompt('');
    };
    image.src = imageUrl;
  }, [imageUrl, open]);

  const pointForEvent = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const saveSnapshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const snapshot = canvas.toDataURL('image/png');
    setHistory((current) => [...current.slice(0, historyIndex + 1), snapshot]);
    setHistoryIndex((current) => current + 1);
  };

  const configureContext = (context: CanvasRenderingContext2D) => {
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = Math.max(4, Math.round((canvasRef.current?.width || 800) / 180));
    context.lineCap = 'round';
    context.lineJoin = 'round';
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !history.length) return;
    const point = pointForEvent(event);
    drawingRef.current = true;
    startRef.current = point;
    canvas.setPointerCapture(event.pointerId);
    configureContext(context);
    if (tool === 'pen') {
      context.beginPath();
      context.moveTo(point.x, point.y);
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || tool !== 'pen') return;
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    const point = pointForEvent(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  };

  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    drawingRef.current = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    const point = pointForEvent(event);
    const start = startRef.current;
    configureContext(context);
    if (tool === 'rectangle') {
      context.strokeRect(start.x, start.y, point.x - start.x, point.y - start.y);
    } else if (tool === 'circle') {
      const radiusX = Math.abs(point.x - start.x) / 2;
      const radiusY = Math.abs(point.y - start.y) / 2;
      context.beginPath();
      context.ellipse((start.x + point.x) / 2, (start.y + point.y) / 2, radiusX, radiusY, 0, 0, Math.PI * 2);
      context.stroke();
    } else if (tool === 'arrow') {
      drawArrow(context, start.x, start.y, point.x, point.y);
    } else if (tool === 'marker') {
      const radius = Math.max(16, context.lineWidth * 2.25);
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#ffffff';
      context.font = `${Math.round(radius * 1.45)}px sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText('!', point.x, point.y + 1);
    }
    saveSnapshot();
  };

  const undo = () => {
    if (historyIndex <= 0) return;
    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    restoreSnapshot(history[nextIndex]);
  };

  const redo = () => {
    if (historyIndex >= history.length - 1) return;
    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    restoreSnapshot(history[nextIndex]);
  };

  const download = () => {
    canvasRef.current?.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'ai-creation-annotation.png';
      link.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  const useAnnotatedImage = () => {
    if (!canvasRef.current) return;
    setSaving(true);
    canvasRef.current.toBlob(async (blob) => {
      try {
        if (!blob) throw new Error('无法导出标注图片');
        await onUse(new File([blob], 'ai-creation-annotation.png', { type: 'image/png' }), extraPrompt.trim());
        onOpenChange(false);
      } finally {
        setSaving(false);
      }
    }, 'image/png');
  };

  const toolButtons: Array<{ value: AnnotationTool; label: string; icon: typeof Square }> = [
    { value: 'rectangle', label: '方形标注', icon: Square },
    { value: 'circle', label: '圆形标注', icon: Circle },
    { value: 'arrow', label: '箭头', icon: MousePointer2 },
    { value: 'pen', label: '画笔', icon: Pencil },
    { value: 'marker', label: '标记', icon: Highlighter },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl border-white/10 bg-[#17181d] p-6 text-white sm:rounded-2xl">
        <DialogHeader className="flex-row items-start justify-between pr-8">
          <div><p className="text-[11px] tracking-[0.12em] text-[#9a9aa2]">图片编辑器</p><DialogTitle className="mt-1 text-xl">图片编辑</DialogTitle><DialogDescription className="sr-only">使用标注工具编辑生成图片并保存为参考图。</DialogDescription></div>
        </DialogHeader>
        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_220px] gap-4">
          <div className="min-w-0 rounded-2xl border border-white/10 bg-[#202126] p-3">
            <div className="flex min-h-[400px] items-center justify-center overflow-auto rounded-xl bg-[linear-gradient(45deg,#17181d_25%,transparent_25%),linear-gradient(-45deg,#17181d_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#17181d_75%),linear-gradient(-45deg,transparent_75%,#17181d_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px]">
              <canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} className="max-h-[58vh] max-w-full touch-none cursor-crosshair rounded-lg shadow-2xl" />
            </div>
            <p className="mt-3 text-xs text-[#b1b1b8]">选择工具后在图片上添加标注；点击“使用”将其作为下一次创作的参考图。</p>
          </div>
          <div className="flex min-h-0 flex-col rounded-2xl border border-white/10 bg-[#202126]">
            <div className="border-b border-white/10 px-4 py-3 text-sm font-medium">补充提示词</div>
            <Textarea value={extraPrompt} onChange={(event) => setExtraPrompt(event.target.value)} placeholder="描述希望修改的内容" className="min-h-48 flex-1 resize-none border-0 bg-transparent p-4 text-sm text-white shadow-none placeholder:text-[#74747c] focus-visible:ring-0" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
          {toolButtons.map(({ value, label, icon: Icon }) => <Button key={value} type="button" size="icon" variant="outline" title={label} onClick={() => setTool(value)} className={cn('border-white/10 bg-[#24252b] text-[#d8d8df] hover:bg-white/10 hover:text-white', tool === value && 'border-[#8d67ff] bg-[#6e45ef]/20 text-white')}><Icon className="size-4" /></Button>)}
          <span className="mx-1 h-6 w-px bg-white/10" />
          {colors.map((value) => <button key={value} type="button" title={value} onClick={() => setColor(value)} className={cn('size-7 rounded-full border-2 border-transparent', color === value && 'border-white')} style={{ backgroundColor: value }} />)}
          <span className="mx-1 h-6 w-px bg-white/10" />
          <Button type="button" size="icon" variant="ghost" title="撤销" disabled={historyIndex <= 0} onClick={undo}><Undo2 /></Button>
          <Button type="button" size="icon" variant="ghost" title="重做" disabled={historyIndex >= history.length - 1} onClick={redo}><Redo2 /></Button>
          <div className="ml-auto flex items-center gap-2"><Button type="button" variant="outline" className="border-white/10 bg-[#24252b] text-white hover:bg-white/10" onClick={download}><Download />下载</Button><Button type="button" disabled={saving} className="bg-[#7047ff] text-white hover:bg-[#5d37dd]" onClick={useAnnotatedImage}>{saving ? '处理中' : '使用'}</Button><Button type="button" variant="ghost" title="关闭" onClick={() => onOpenChange(false)}><X /></Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
