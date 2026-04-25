'use client';
import { cn } from '@/lib/utils';

/**
 * A horizontal bar that visually represents a participant's audio level.
 * @param audioLevel - A number between 0 and 1 representing the current audio volume.
 */
export const SpeakingIndicator = ({ audioLevel = 0 }: { audioLevel: number }) => {
    return (
        <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
            <div
                className={cn(
                    "h-full bg-primary transition-all duration-75",
                )}
                style={{ width: `${audioLevel * 100}%` }}
            />
        </div>
    );
};
