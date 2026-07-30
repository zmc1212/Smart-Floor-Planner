import { FetchInterceptor } from '@/components/FetchInterceptor';

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-100">
      <FetchInterceptor />
      {children}
    </div>
  );
}
