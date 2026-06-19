import Image from 'next/image';
import { cn } from '@/lib/utils';

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Image
        src="/brand/hearmeout-logo.png"
        alt="HearMeOut"
        width={242}
        height={282}
        priority
        className="h-20 w-auto rounded-xl object-contain"
      />
    </div>
  );
}
