'use client';

import { useState, useEffect } from 'react';
import { cn } from "@/lib/utils";

// A simple component to simulate an audio visualizer
export const AudioVisualizer = ({ isSpeaking }: { isSpeaking: boolean }) => {
  const [heights, setHeights] = useState<number[]>([]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isSpeaking) {
      interval = setInterval(() => {
        setHeights(Array.from({ length: 12 }, () => Math.random() * 28 + 4)); // height is h-8, so max 32px
      }, 150);
    } else {
      setHeights(Array.from({ length: 12 }, () => 4));
    }
    return () => clearInterval(interval);
  }, [isSpeaking]);

  return (
    <div className="flex h-8 w-full items-end gap-1">
      {[...Array(12)].map((_, i) => (
        <div
          key={i}
          className={cn(
            "w-1 rounded-full bg-primary/50 transition-all duration-100",
            { "bg-primary": isSpeaking }
          )}
          style={{
            height: `${heights[i] || 4}px`,
          }}
        />
      ))}
    </div>
  );
};
