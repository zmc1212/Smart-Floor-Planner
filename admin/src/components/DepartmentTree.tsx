import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, Plus, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Department {
  _id: string;
  name: string;
  parentId?: string | null;
  enterpriseId: string;
}

interface DepartmentTreeProps {
  departments: Department[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (parentId: string | null) => void;
  onEdit: (dept: Department) => void;
  onDelete: (id: string) => void;
}

export function DepartmentTree({
  departments,
  selectedId,
  onSelect,
  onAdd,
  onEdit,
  onDelete
}: DepartmentTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newExpanded = new Set(expandedIds);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedIds(newExpanded);
  };

  const buildTree = (parentId: string | null = null): any[] => {
    return departments
      .filter(d => (d.parentId || null) === parentId)
      .map(d => ({
        ...d,
        children: buildTree(d._id)
      }));
  };

  const treeData = buildTree(null);

  const renderNode = (node: any, level: number = 0) => {
    const isExpanded = expandedIds.has(node._id);
    const isSelected = selectedId === node._id;
    const hasChildren = node.children.length > 0;

    return (
      <div key={node._id} className="select-none">
        <div
          className={cn(
            "group flex items-center gap-2 py-2 px-3 cursor-pointer rounded-xl transition-all duration-200",
            isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted/50 text-muted-foreground hover:text-foreground"
          )}
          style={{ paddingLeft: `${level * 16 + 12}px` }}
          onClick={() => onSelect(node._id)}
        >
          <div className="flex items-center gap-1 min-w-0 flex-1">
            <div 
              className={cn(
                "p-0.5 rounded-md hover:bg-muted transition-colors",
                !hasChildren && "opacity-0 cursor-default pointer-events-none"
              )}
              onClick={(e) => hasChildren && toggleExpand(node._id, e)}
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </div>
            {isExpanded ? <FolderOpen size={16} className="shrink-0 text-primary/70" /> : <Folder size={16} className="shrink-0 text-muted-foreground/70" />}
            <span className="truncate text-sm font-medium">{node.name}</span>
          </div>

          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 shrink-0">
             <Button 
               variant="ghost" 
               size="icon" 
               className="h-7 w-7 rounded-lg hover:bg-primary/20 hover:text-primary"
               onClick={(e) => { e.stopPropagation(); onAdd(node._id); }}
               title="添加子部门"
             >
               <Plus size={14} />
             </Button>
             
             <Button 
               variant="ghost" 
               size="icon" 
               className="h-7 w-7 rounded-lg hover:bg-primary/20 hover:text-primary"
               onClick={(e) => { e.stopPropagation(); onEdit(node); }}
               title="编辑部门"
             >
               <Pencil size={14} />
             </Button>

             <Button 
               variant="ghost" 
               size="icon" 
               className="h-7 w-7 rounded-lg hover:bg-destructive/20 hover:text-destructive"
               onClick={(e) => { e.stopPropagation(); onDelete(node._id); }}
               title="删除部门"
             >
               <Trash2 size={14} />
             </Button>
          </div>
        </div>
        
        {isExpanded && node.children.length > 0 && (
          <div className="mt-0.5">
            {node.children.map((child: any) => renderNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-1">
      <div
        className={cn(
          "group flex items-center gap-2 py-2 px-3 cursor-pointer rounded-xl transition-all duration-200",
          selectedId === null ? "bg-primary/10 text-primary font-bold" : "hover:bg-muted/50 text-muted-foreground hover:text-foreground"
        )}
        onClick={() => onSelect(null)}
      >
        <Folder size={16} className="shrink-0" />
        <span className="text-sm">全公司员工</span>
      </div>
      
      <div className="pt-2">
        {treeData.length > 0 ? (
          treeData.map(node => renderNode(node))
        ) : (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground italic border-2 border-dashed border-muted rounded-2xl">
            暂无部门节点
          </div>
        )}
      </div>
    </div>
  );
}
