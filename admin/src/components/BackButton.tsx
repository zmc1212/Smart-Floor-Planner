'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

export default function BackButton({ fallbackPath = '/' }: { fallbackPath?: string }) {
  const router = useRouter();

  const handleBack = () => {
    if (window.history.length > 2) {
      router.back();
    } else {
      router.push(fallbackPath);
    }
  };

  return (
    <button 
      onClick={handleBack}
      className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center hover:bg-gray-100 text-gray-500 transition-colors cursor-pointer"
      title="返回"
    >
      <ArrowLeft size={20} />
    </button>
  );
}
