import { useEffect, useState } from 'react';
import { ChevronUp } from 'lucide-react';
import { cn } from '../lib/utils';

export type GoTopButtonProps = {
  scrollThreshold?: number;
  className?: string;
};

export function GoTopButton({ scrollThreshold = 360, className }: GoTopButtonProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > scrollThreshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [scrollThreshold]);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Ve dau trang"
      className={cn(
        'fixed bottom-8 right-6 z-[105] flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-primary/35 ring-2 ring-white/30 transition hover:scale-105 hover:shadow-xl cursor-pointer',
        className,
      )}
    >
      <ChevronUp className="h-6 w-6" strokeWidth={2.5} />
    </button>
  );
}
