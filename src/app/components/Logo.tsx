import Image from 'next/image';
import { cn } from '@/lib/utils';

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2", className)}>
      <Image
        src="/brand/hearmeout-logo.png"
        alt="HearMeOut"
        width={242}
        height={282}
        priority
        className="h-20 w-auto rounded-xl object-contain group-data-[collapsible=icon]:hidden"
      />
      <Image
        src="/brand/hearmeout-icon-192.png"
        alt="HearMeOut"
        width={40}
        height={40}
        priority
        className="hidden h-10 w-10 rounded-xl object-contain group-data-[collapsible=icon]:block"
      />
    </div>
  );
}
