'use client';
import { useEffect, useState } from 'react';
import { Button } from 'antd';

export function ReportEntry({ leadId }: { leadId: string }) {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let active = true;
    void fetch('/api/auth/me').then((r) => r.json()).then((r) => {
      if (active) setAllowed(Boolean(r.success && (['admin', 'super_admin'].includes(r.data?.role) || (['designer', 'enterprise_admin'].includes(r.data?.role) && r.data?.effectivePermissions?.includes('ai-scenarios')))));
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  return allowed && leadId ? <Button size="small" href={`/design-reports?leadId=${encodeURIComponent(leadId)}`} target="_blank">设计汇报</Button> : null;
}
