/* eslint-disable @next/next/no-img-element -- Template source URLs use a runtime local fallback. */
'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Button, ConfigProvider, Input, Modal, Select } from 'antd';
import { Check, ChevronRight, ImageOff, Loader2, Search, X } from 'lucide-react';
import { notify } from '@/components/admin/operation-feedback';
import { studioDarkAntdTheme } from '@/components/admin/studio-antd-theme';
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
  const [previewTemplate, setPreviewTemplate] = useState<PromptTemplate | null>(null);
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
      setPreviewTemplate(null);
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
        setPreviewTemplate(null);
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

  const openTemplatePreview = (template: PromptTemplate) => {
    if (!template.previewUrl && !template.localPreviewUrl) {
      notify.warning('该模板暂无预览图');
      return;
    }
    setPreviewTemplate(template);
  };

  const previewImageSrc = previewTemplate?.previewUrl || previewTemplate?.localPreviewUrl || '';

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
    <ConfigProvider theme={studioDarkAntdTheme}>
    <Modal
      open={open}
      onCancel={() => onOpenChange(false)}
      footer={null}
      closable={false}
      title={null}
      width={796}
      centered={false}
      destroyOnHidden
      classNames={{
        content: 'overflow-hidden rounded-md border border-[#343741] bg-[#15161a] p-0 text-[#d8dbe3] shadow-2xl',
        body: 'p-0',
        mask: 'bg-black/25',
      }}
      styles={{
        content: {
          top: 84,
          margin: '0 auto',
          padding: 0,
          height: 'min(562px, calc(100vh - 2rem))',
          maxWidth: 796,
        },
        body: { height: '100%', padding: 0 },
      }}
      aria-labelledby="template-library-title"
    >
      <span id="template-library-title" className="sr-only">提示词模板</span>
      <span className="sr-only">按分类搜索并选择一个提示词模板。</span>
      <div className="grid h-full min-h-0 flex-1 grid-cols-1 md:grid-cols-[156px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 flex-col border-r border-[#343741] bg-[#15161a] px-[10px] pb-[10px] pt-2 md:flex">
          <div className="relative mb-3">
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                if (event.target.value.trim()) setCategoryId('');
              }}
              placeholder="搜索"
              className="h-7 rounded border-[#343741] bg-[#1d1e23] px-2 pr-8 text-xs text-white placeholder:text-[#737782] focus:border-[#7047ff]"
            />
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
            <Select
              value={categoryId || '__all__'}
              onChange={(value) => setCategoryId(value === '__all__' ? '' : value)}
              className="h-8 w-[42%] min-w-0 [&_.ant-select-selector]:!h-8 [&_.ant-select-selector]:!rounded [&_.ant-select-selector]:!border-[#343741] [&_.ant-select-selector]:!bg-[#1d1e23] [&_.ant-select-selector]:!text-xs [&_.ant-select-selector]:!text-white [&_.ant-select-selection-item]:!leading-7"
              classNames={{
                popup: {
                  root: 'border border-[#343741] bg-[#18191d] text-white [&_.ant-select-item]:text-white [&_.ant-select-item-option-active]:!bg-white/10 [&_.ant-select-item-option-selected]:!bg-white/[0.08]',
                },
              }}
              options={[
                { value: '__all__', label: '全部分类' },
                ...categoryOptions.map((category) => ({
                  value: category.sourceId,
                  label: (
                    <span style={{ paddingLeft: `${Math.max(0, category.level - 1) * 12}px` }}>{category.name}</span>
                  ),
                })),
              ]}
            />
            <div className="relative min-w-0 flex-1">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索"
                className="h-8 border-[#343741] bg-[#1d1e23] pl-8 text-xs text-white"
              />
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#8d909a]" />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-[18px] pb-3.5 pt-[18px] [scrollbar-width:thin]">
            {loading ? (
              <div className="flex h-48 items-center justify-center text-sm text-[#8d909a]">
                <Loader2 className="mr-2 size-4 animate-spin text-[#8062ff]" /> 加载模板
              </div>
            ) : templates.length ? (
              <div className="grid grid-cols-2 gap-x-2.5 gap-y-3 sm:grid-cols-3">
                {templates.map((template) => (
                  <div
                    key={template.id}
                    className={cn(
                      'group h-[156px] overflow-hidden rounded-md border-2 border-transparent bg-[#222631] text-left transition hover:border-[#7457ff] hover:shadow-lg',
                      selectedTemplateId === template.id && 'border-[#8062ff] ring-1 ring-[#8062ff]'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => openTemplatePreview(template)}
                      className="relative block w-full aspect-[1.58/1] overflow-hidden bg-[#202126]"
                      aria-label={`放大预览 ${template.name}`}
                    >
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
                    </button>
                    <div className="flex h-9 items-center gap-1 px-2">
                      <button
                        type="button"
                        onClick={() => selectTemplate(template)}
                        className="min-w-0 flex-1 truncate text-center text-xs font-medium leading-4 text-[#f0f1f5] hover:text-white"
                        title="使用此模板"
                      >
                        {template.name}
                      </button>
                      <Button
                        type="link"
                        size="small"
                        className="!px-1 !text-[#a994ff] hover:!text-[#c4b5ff]"
                        loading={loadingDetailId === template.id}
                        onClick={() => selectTemplate(template)}
                      >
                        使用
                      </Button>
                    </div>
                  </div>
                ))}
                {templates.length < totalTemplates ? (
                  <div className="col-span-full flex items-center justify-center pt-2">
                    <Button
                      size="small"
                      className="border-[#343741] bg-[#202126] text-[#d8dbe3] hover:!border-[#343741] hover:!bg-[#292b31] hover:!text-white"
                      disabled={loadingMore}
                      onClick={loadMore}
                      icon={loadingMore ? <Loader2 className="size-3.5 animate-spin" /> : undefined}
                    >
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
    </Modal>
    <Modal
      open={Boolean(previewTemplate)}
      onCancel={() => setPreviewTemplate(null)}
      footer={null}
      closable={false}
      title={null}
      width="min(920px, 94vw)"
      centered
      destroyOnHidden
      zIndex={1200}
      classNames={{
        content: 'overflow-hidden rounded-md border border-[#343741] bg-[#111216] p-0 text-[#d8dbe3] shadow-2xl',
        body: 'p-0',
        mask: 'bg-black/55',
      }}
      styles={{
        content: { padding: 0, maxHeight: '92vh' },
        body: { padding: 0 },
      }}
      aria-labelledby="template-preview-title"
    >
      <div className="flex max-h-[92vh] flex-col">
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-[#292b33] px-4">
          <h2 id="template-preview-title" className="truncate text-sm font-semibold text-[#e6e8ee]">
            {previewTemplate?.name || '模板预览'}
          </h2>
          <button
            type="button"
            aria-label="关闭模板预览"
            onClick={() => setPreviewTemplate(null)}
            className="flex size-7 items-center justify-center rounded-full bg-white/10 text-[#c5c7ce] hover:bg-white/15 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-[#0d0e11] px-4 py-5">
          {previewImageSrc ? (
            <img
              src={previewImageSrc}
              alt={previewTemplate?.name || '模板预览'}
              className="max-h-[min(70vh,640px)] max-w-full object-contain"
              onError={(event) => {
                if (
                  previewTemplate?.localPreviewUrl
                  && event.currentTarget.src !== new URL(previewTemplate.localPreviewUrl, window.location.href).href
                ) {
                  event.currentTarget.src = previewTemplate.localPreviewUrl;
                }
              }}
            />
          ) : (
            <div className="flex flex-col items-center text-sm text-[#8d909a]">
              <ImageOff className="mb-3 size-8 text-[#555860]" />
              暂无预览图
            </div>
          )}
        </div>
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[#292b33] px-4 py-3">
          <Button onClick={() => setPreviewTemplate(null)}>关闭</Button>
          <Button
            type="primary"
            loading={Boolean(previewTemplate && loadingDetailId === previewTemplate.id)}
            onClick={() => {
              if (previewTemplate) void selectTemplate(previewTemplate);
            }}
          >
            使用此模板
          </Button>
        </footer>
      </div>
    </Modal>
    </ConfigProvider>
  );
}
