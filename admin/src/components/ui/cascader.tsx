'use client';

import * as React from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CascaderOption = {
  value: string;
  label: string;
  children?: CascaderOption[];
};

type CascaderProps = {
  options: CascaderOption[];
  value?: string[];
  onValueChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

function findLabelPath(options: CascaderOption[], value?: string[]) {
  if (!value?.length) return [];
  const first = options.find((option) => option.value === value[0]);
  if (!first) return [];
  const second = first.children?.find((option) => option.value === value[1]);
  return second ? [first.label, second.label] : [first.label];
}

export function Cascader({
  options,
  value,
  onValueChange,
  placeholder = '请选择',
  disabled = false,
  className,
}: CascaderProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [activeParentValue, setActiveParentValue] = React.useState(value?.[0] || options[0]?.value || '');

  const activeParent = React.useMemo(
    () => options.find((option) => option.value === activeParentValue) || options[0],
    [activeParentValue, options],
  );
  const labelPath = React.useMemo(() => findLabelPath(options, value), [options, value]);

  React.useEffect(() => {
    if (open) {
      setActiveParentValue(value?.[0] || options[0]?.value || '');
    }
  }, [open, options, value]);

  React.useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleParentClick = (option: CascaderOption) => {
    setActiveParentValue(option.value);
    if (!option.children?.length) {
      onValueChange([option.value]);
      setOpen(false);
    }
  };

  const handleChildClick = (child: CascaderOption) => {
    if (!activeParent) return;
    onValueChange([activeParent.value, child.value]);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex h-10 w-full items-center justify-between rounded-lg border border-input bg-background px-3 text-left text-sm shadow-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span className={cn('truncate', labelPath.length ? 'text-foreground' : 'text-muted-foreground')}>
          {labelPath.length ? labelPath.join(' / ') : placeholder}
        </span>
        <ChevronDown className={cn('ml-2 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} size={16} />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-50 grid max-h-[360px] min-w-[360px] grid-cols-[160px_1fr] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl">
          <div role="listbox" className="max-h-[360px] overflow-y-auto border-r bg-muted/40 p-1">
            {options.map((option) => {
              const active = option.value === activeParent?.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setActiveParentValue(option.value)}
                  onClick={() => handleParentClick(option)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors',
                    active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  {option.children?.length ? <ChevronRight size={14} /> : null}
                </button>
              );
            })}
          </div>

          <div role="listbox" className="max-h-[360px] overflow-y-auto p-1">
            {(activeParent?.children || []).map((child) => {
              const selected = value?.[0] === activeParent?.value && value?.[1] === child.value;
              return (
                <button
                  key={child.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => handleChildClick(child)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors',
                    selected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                  )}
                >
                  <span className="truncate">{child.label}</span>
                  {selected ? <Check size={14} /> : null}
                </button>
              );
            })}
            {!activeParent?.children?.length && (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">暂无下级选项</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
