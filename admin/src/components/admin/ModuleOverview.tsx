import type { ReactNode } from 'react';

type ModuleOverviewItem = {
  label: string;
  value: number;
  icon: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger';
};

type ModuleOverviewProps = {
  ariaLabel: string;
  items: ModuleOverviewItem[];
};

const TONE_CLASS_NAMES: Record<NonNullable<ModuleOverviewItem['tone']>, string> = {
  default: 'admin-module-overview-icon-default',
  success: 'admin-module-overview-icon-success',
  warning: 'admin-module-overview-icon-warning',
  danger: 'admin-module-overview-icon-danger',
};

export default function ModuleOverview({ ariaLabel, items }: ModuleOverviewProps) {
  return (
    <section aria-label={ariaLabel} className="admin-module-overview">
      {items.map((item) => (
        <div key={item.label} className="admin-module-overview-item">
          <span
            aria-hidden="true"
            className={`admin-module-overview-icon ${TONE_CLASS_NAMES[item.tone || 'default']}`}
          >
            {item.icon}
          </span>
          <div className="min-w-0">
            <p className="admin-module-overview-label">{item.label}</p>
            <p className="admin-module-overview-value">{item.value}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
