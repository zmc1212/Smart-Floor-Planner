'use client';

import Link from 'next/link';
import { ArrowLeft, Building2 } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getEnterpriseStatusBadge } from './enterprise-utils';
import { EnterpriseListItem } from './types';

const NAV_ITEMS = [
  { hrefSuffix: '', label: '企业概览' },
  { hrefSuffix: '/ai', label: 'AI 管理' },
  { hrefSuffix: '/wecom', label: '企业微信管理' },
];

interface EnterprisePageHeaderProps {
  enterprise: EnterpriseListItem;
  currentPath: string;
}

export default function EnterprisePageHeader({
  enterprise,
  currentPath,
}: EnterprisePageHeaderProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-3">
          <Link
            href="/enterprises"
            className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={16} />
            返回企业列表
          </Link>

          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border bg-white shadow-sm">
              <Building2 size={24} className="text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-[30px] font-bold tracking-tight">{enterprise.name}</h1>
                {getEnterpriseStatusBadge(enterprise.status)}
              </div>
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                <span>编码：{enterprise.code}</span>
                <span>联系人：{enterprise.contactPerson?.name || '-'}</span>
                <span>
                  创建时间：
                  {enterprise.createdAt
                    ? new Date(enterprise.createdAt).toLocaleString()
                    : '-'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <Link
          href="/enterprises"
          className={buttonVariants({
            variant: 'outline',
            className: 'rounded-full',
          })}
        >
          继续查看其他企业
        </Link>
      </div>

      <div className="flex flex-wrap gap-2 rounded-2xl border bg-white p-2 shadow-sm">
        {NAV_ITEMS.map((item) => {
          const href = `/enterprises/${enterprise._id}${item.hrefSuffix}`;
          const isActive = currentPath === href;

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'rounded-xl px-4 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-zinc-950 text-white'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
