'use client';

import React from 'react';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PaginationProps {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  onChange: (page: number) => void;
  className?: string;
}

export function Pagination({
  total,
  page,
  limit,
  totalPages,
  onChange,
  className
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const renderPageButtons = () => {
    const buttons = [];
    const maxVisible = 5;

    let start = Math.max(1, page - Math.floor(maxVisible / 2));
    let end = Math.min(totalPages, start + maxVisible - 1);

    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }

    if (start > 1) {
      buttons.push(
        <Button
          key={1}
          variant="ghost"
          size="sm"
          className={cn("h-8 w-8 rounded-lg text-[13px] font-medium transition-all", page === 1 ? "bg-neutral-900 text-white hover:bg-neutral-800" : "text-neutral-500 hover:bg-neutral-100")}
          onClick={() => onChange(1)}
        >
          1
        </Button>
      );
      if (start > 2) {
        buttons.push(<MoreHorizontal key="start-dots" size={14} className="text-neutral-300 mx-1" />);
      }
    }

    for (let i = start; i <= end; i++) {
      buttons.push(
        <Button
          key={i}
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 w-8 rounded-lg text-[13px] font-medium transition-all",
            page === i 
              ? "bg-neutral-900 text-white hover:bg-neutral-800 shadow-md" 
              : "text-neutral-500 hover:bg-neutral-100"
          )}
          onClick={() => onChange(i)}
        >
          {i}
        </Button>
      );
    }

    if (end < totalPages) {
      if (end < totalPages - 1) {
        buttons.push(<MoreHorizontal key="end-dots" size={14} className="text-neutral-300 mx-1" />);
      }
      buttons.push(
        <Button
          key={totalPages}
          variant="ghost"
          size="sm"
          className={cn("h-8 w-8 rounded-lg text-[13px] font-medium transition-all", page === totalPages ? "bg-neutral-900 text-white hover:bg-neutral-800" : "text-neutral-500 hover:bg-neutral-100")}
          onClick={() => onChange(totalPages)}
        >
          {totalPages}
        </Button>
      );
    }

    return buttons;
  };

  return (
    <div className={cn("flex flex-col sm:flex-row items-center justify-between gap-4 py-6", className)}>
      <div className="text-[13px] text-neutral-400 font-medium">
        显示第 <span className="text-neutral-900">{Math.min((page - 1) * limit + 1, total)}</span> 到 <span className="text-neutral-900">{Math.min(page * limit, total)}</span> 条，共 <span className="text-neutral-900">{total}</span> 条
      </div>
      
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="h-8 w-8 rounded-lg text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"
        >
          <ChevronLeft size={16} />
        </Button>
        
        <div className="flex items-center gap-1">
          {renderPageButtons()}
        </div>

        <Button
          variant="ghost"
          size="icon"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          className="h-8 w-8 rounded-lg text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"
        >
          <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  );
}
