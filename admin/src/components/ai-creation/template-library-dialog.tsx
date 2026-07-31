/* eslint-disable @next/next/no-img-element -- Template source URLs use a runtime local fallback. */
'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, ImageOff, Loader2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { notify } from '@/components/ui/operation-feedback';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { PromptCategory, PromptTemplate } from './types';

type TemplateDetail = PromptTemplate & {
  parameterTemplate?: { parameters?: Record<string, unknown> };
};

export function TemplateLibraryDialog({
  open,
  onOpenChange,
  selectedTemplateId,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedTemplateId?: string;
  onSelect: (template: TemplateDetail) => void;
}) {
  const [categories, setCategories] = useState<PromptCategory[]>([]);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingDetailId, setLoadingDetailId] = useState('');
  const [page, setPage] = useState(1);
  const [totalTemplates, setTotalTemplates] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const defaultCategoryAppliedRef = useRef(false);

  useEffect(() => {
    if (!open || categories.length) return;
    fetch('/api/ai/creation/prompt-categories')
      .then((response) => response.json())
      .then((payload) => setCategories(payload.data?.categories || []))
      .catch(() => setCategories([]));
  }, [open, categories.length]);

  useEffect(() => {
    if (!open) {
      defaultCategoryAppliedRef.current = false;
      return;
    }
    if (!categories.length || defaultCategoryAppliedRef.current) return;
    defaultCategoryAppliedRef.current = true;
    const preferredCategory = categories.find((category) => category.name === '热门必备');
    if (preferredCategory) setCategoryId(preferredCategory.sourceId);
  }, [open, categories]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let active = true;
    const params = new URLSearchParams({ limit: '60' });
    if (categoryId) params.set('categorySourceId', categoryId);
    if (deferredQuery.trim()) params.set('q', deferredQuery.trim());
    setLoading(true);
    fetch(`/api/ai/creation/prompt-templates?${params}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((payload) => {
        if (!active) return;
        setTemplates(payload.data?.items || []);
        setTotalTemplates(payload.data?.pagination?.total || 0);
        setPage(1);
      })
      .catch((error) => {
        if (active && error instanceof Error && error.name !== 'AbortError') {
          setTemplates([]);
          setTotalTemplates(0);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [open, categoryId, deferredQuery]);

  const childrenByParent = useMemo(() => {
    const result = new Map<string, PromptCategory[]>();
    for (const category of categories) {
      const key = category.parentSourceId || 'root';
      const children = result.get(key) || [];
      children.push(category);
      result.set(key, children);
    }
    return result;
  }, [categories]);

  const categoryOptions = useMemo(() => {
    const result: PromptCategory[] = [];
    const visit = (parentSourceId: string) => {
      for (const category of childrenByParent.get(parentSourceId) || []) {
        result.push(category);
        visit(category.sourceId);
      }
    };
    visit('root');
    return result;
  }, [childrenByParent]);

  const selectedCategoryPath = useMemo(() => {
    const parentBySourceId = new Map(categories.map((category) => [category.sourceId, category.parentSourceId]));
    const path = new Set<string>();
    let current = categoryId;
    while (current) {
      path.add(current);
      current = parentBySourceId.get(current) || '';
    }
    return path;
  }, [categories, categoryId]);

  const selectedCategoryName = categories.find((category) => category.sourceId === categoryId)?.name || '全部模板';

  const loadMore = async () => {
    if (loadingMore || templates.length >= totalTemplates) return;
    const nextPage = page + 1;
    const params = new URLSearchParams({ limit: '60', page: String(nextPage) });
    if (categoryId) params.set('categorySourceId', categoryId);
    if (deferredQuery.trim()) params.set('q', deferredQuery.trim());
    setLoadingMore(true);
    try {
      const response = await fetch(`/api/ai/creation/prompt-templates?${params}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '加载模板失败');
      const nextItems = (payload.data?.items || []) as PromptTemplate[];
      setTemplates((current) => {
        const existingIds = new Set(current.map((item) => item.id));
        return [...current, ...nextItems.filter((item) => !existingIds.has(item.id))];
      });
      setTotalTemplates(payload.data?.pagination?.total || totalTemplates);
      setPage(nextPage);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '加载模板失败');
    } finally {
      setLoadingMore(false);
    }
  };

  const selectTemplate = async (template: PromptTemplate) => {
    setLoadingDetailId(template.id);
    try {
      const response = await fetch(`/api/ai/creation/prompt-templates/${template.id}`);
      const payload = await response.json();
      if (response.ok && payload.data) {
        onSelect(payload.data);
        onOpenChange(false);
      } else {
        notify.error(payload.error || '读取模板详情失败');
      }
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '读取模板详情失败');
    } finally {
      setLoadingDetailId('');
    }
  };

  const renderCategory = (category: PromptCategory) => {
    const children = childrenByParent.get(category.sourceId) || [];
    const expanded = selectedCategoryPath.has(category.sourceId);
    return (
    <div key={category.sourceId}>
      <button
        type="button"
        onClick={() => setCategoryId(category.sourceId)}
        className={cn(
          'flex h-[30px] w-full items-center gap-1 rounded px-3 text-left text-xs transition-colors',
          categoryId === category.sourceId
            ? 'bg-[#323646] font-medium text-white'
            : 'text-[#c5c7ce] hover:bg-white/[0.05] hover:text-white'
        )}
        style={{ paddingLeft: `${12 + (category.level - 1) * 12}px` }}
      >
        <span className="truncate">{category.name}</span>
        {children.length ? <ChevronRight className={cn('ml-auto size-3 transition-transform', expanded && 'rotate-90')} /> : null}
      </button>
      {expanded ? children.map(renderCategory) : null}
    </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="bg-black/25"
        hideCloseButton
        aria-describedby={undefined}
        style={{ top: '84px', translate: '-50% 0' }}
        className="h-[min(562px,calc(100vh-2rem))] max-w-[796px] gap-0 overflow-hidden rounded-md border-[#343741] bg-[#15161a] p-0 text-[#d8dbe3] shadow-2xl"
      >
        <DialogHeader className="sr-only"><DialogTitle>提示词模板</DialogTitle><DialogDescription>按分类搜索并选择一个提示词模板。</DialogDescription></DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[156px_minmax(0,1fr)]">
          <aside className="hidden min-h-0 flex-col border-r border-[#343741] bg-[#15161a] px-[10px] pb-[10px] pt-2 md:flex">
            <div className="relative mb-3">
              <Input value={query} onChange={(event) => { setQuery(event.target.value); if (event.target.value.trim()) setCategoryId(''); }} placeholder="搜索" className="h-7 rounded border-[#343741] bg-[#1d1e23] px-2 pr-8 text-xs text-white placeholder:text-[#737782] focus-visible:ring-[#7047ff]" />
              <Search className="absolute right-2 top-1/2 size-4 -translate-y-1/2 text-[#9b9ea8]" />
            </div>
            <nav aria-label="提示词模板分类" className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1 [scrollbar-width:thin]">
              {(childrenByParent.get('root') || []).map(renderCategory)}
            </nav>
          </aside>
          <section className="flex min-h-0 flex-col bg-[#15161a]">
            <header className="flex h-10 shrink-0 items-center justify-between border-b border-[#292b33] px-3.5">
              <h2 className="text-sm font-semibold text-[#e6e8ee]">{selectedCategoryName}</h2>
              <button type="button" aria-label="关闭提示词模板" onClick={() => onOpenChange(false)} className="flex size-7 items-center justify-center rounded-full bg-white/10 text-[#c5c7ce] hover:bg-white/15 hover:text-white"><X className="size-4" /></button>
            </header>
            <div className="flex gap-2 border-b border-[#292b33] p-2 md:hidden">
              <Select value={categoryId || '__all__'} onValueChange={(value) => setCategoryId(value === '__all__' ? '' : value)}>
                <SelectTrigger className="h-8 w-[42%] min-w-0 border-[#343741] bg-[#1d1e23] text-xs text-white"><SelectValue placeholder="全部分类" /></SelectTrigger>
                <SelectContent className="border-[#343741] bg-[#18191d] text-white"><SelectItem value="__all__">全部分类</SelectItem>{categoryOptions.map((category) => <SelectItem key={category.sourceId} value={category.sourceId}><span style={{ paddingLeft: `${Math.max(0, category.level - 1) * 12}px` }}>{category.name}</span></SelectItem>)}</SelectContent>
              </Select>
              <div className="relative min-w-0 flex-1"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索" className="h-8 border-[#343741] bg-[#1d1e23] pl-8 text-xs text-white" /><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#8d909a]" /></div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-[18px] pb-3.5 pt-[18px] [scrollbar-width:thin]">
              {loading ? (
                <div className="flex h-48 items-center justify-center text-sm text-[#8d909a]">
                  <Loader2 className="mr-2 size-4 animate-spin text-[#8062ff]" /> 加载模板
                </div>
              ) : templates.length ? (
                <div className="grid grid-cols-2 gap-x-2.5 gap-y-3 sm:grid-cols-3">
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => selectTemplate(template)}
                      className={cn(
                        'group h-[156px] overflow-hidden rounded-md border-2 border-transparent bg-[#222631] text-left transition hover:border-[#7457ff] hover:shadow-lg',
                        selectedTemplateId === template.id && 'border-[#8062ff] ring-1 ring-[#8062ff]'
                      )}
                    >
                      <div className="relative aspect-[1.58/1] overflow-hidden bg-[#202126]">
                        {template.previewUrl ? (
                          <img
                            src={template.previewUrl}
                            alt={template.name}
                            loading="lazy"
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.025]"
                            onError={(event) => {
                              if (template.localPreviewUrl && event.currentTarget.src !== new URL(template.localPreviewUrl, window.location.href).href) {
                                event.currentTarget.src = template.localPreviewUrl;
                              }
                            }}
                          />
                        ) : (
                          <ImageOff className="absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 text-[#555860]" />
                        )}
                        {selectedTemplateId === template.id ? (
                          <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-[#7047ff] text-white">
                            <Check className="size-3.5" />
                          </span>
                        ) : null}
                      </div>
                      <div className="flex h-9 items-center justify-center px-2.5">
                        <span className="line-clamp-1 text-center text-xs font-medium leading-4 text-[#f0f1f5]">{template.name}</span>
                        {loadingDetailId === template.id ? <Loader2 className="ml-auto size-3.5 shrink-0 animate-spin" /> : null}
                      </div>
                    </button>
                  ))}
                  {templates.length < totalTemplates ? (
                    <div className="col-span-full flex items-center justify-center pt-2">
                      <Button variant="outline" size="sm" className="border-[#343741] bg-[#202126] text-[#d8dbe3] hover:bg-[#292b31] hover:text-white" disabled={loadingMore} onClick={loadMore}>
                        {loadingMore ? <Loader2 className="animate-spin" /> : null}
                        加载更多（{templates.length}/{totalTemplates}）
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex h-48 flex-col items-center justify-center text-sm text-[#8d909a]">
                  <ImageOff className="mb-3 size-7 text-[#555860]" />
                  没有匹配的模板
                </div>
              )}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
