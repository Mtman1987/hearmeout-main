'use client';

import React, { useRef, useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { GripHorizontal, Save, X } from 'lucide-react';
import { Slider } from '@/components/ui/slider';

interface DraggableContainerProps {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  onPositionChange: (pos: { x: number; y: number }) => void;
  onSizeChange: (size: { width: number; height: number }) => void;
  opacity?: number;
  onOpacityChange?: (opacity: number) => void;
  children: React.ReactNode;
  title?: string;
  onClose?: () => void;
  onSaveLayout?: () => void;
  minimalChrome?: boolean;
}

export function DraggableContainer({
  id,
  position,
  size,
  onPositionChange,
  onSizeChange,
  opacity = 1,
  onOpacityChange,
  children,
  title,
  onClose,
  onSaveLayout,
  minimalChrome = false,
}: DraggableContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isResizing, setIsResizing] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Keep popouts inside the visible viewport. Positions are persisted, so a
  // layout saved on desktop (or before rotating a phone) can otherwise hide
  // the title bar and its close button on smaller screens.
  useEffect(() => {
    const keepInViewport = () => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(size.width, Math.max(180, viewportWidth - 12));
      const height = Math.min(size.height, Math.max(160, viewportHeight - 12));
      const x = Math.max(0, Math.min(position.x, viewportWidth - width));
      const y = Math.max(0, Math.min(position.y, viewportHeight - Math.min(height, 56)));
      if (width !== size.width || height !== size.height) {
        onSizeChange({ width, height });
      }
      if (x !== position.x || y !== position.y) {
        onPositionChange({ x, y });
      }
    };
    keepInViewport();
    window.addEventListener('resize', keepInViewport);
    return () => window.removeEventListener('resize', keepInViewport);
  }, [position.x, position.y, size.width, size.height, onPositionChange, onSizeChange]);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging) {
      const newX = Math.max(0, Math.min(e.clientX - dragOffset.x, window.innerWidth - Math.min(size.width, window.innerWidth)));
      const newY = Math.max(0, Math.min(e.clientY - dragOffset.y, window.innerHeight - 56));
      onPositionChange({
        x: newX,
        y: newY,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragOffset, position]);

  if (!isMounted) return null;

  const visibleWidth = Math.min(size.width, Math.max(180, window.innerWidth - 12));
  const visibleHeight = Math.min(size.height, Math.max(160, window.innerHeight - 12));
  const visibleLeft = Math.max(0, Math.min(position.x, window.innerWidth - visibleWidth));
  const visibleTop = Math.max(0, Math.min(position.y, window.innerHeight - Math.min(visibleHeight, 56)));

  return (
    <div
      ref={containerRef}
      className={cn(
        'fixed bg-background border border-border rounded-lg shadow-2xl z-50',
        'flex flex-col',
        isDragging && 'opacity-75 cursor-grabbing'
      )}
      style={{
        left: `${visibleLeft}px`,
        top: `${visibleTop}px`,
        width: `${visibleWidth}px`,
        height: `${visibleHeight}px`,
        maxWidth: 'calc(100vw - 12px)',
        maxHeight: 'calc(100dvh - 12px)',
        opacity,
      }}
    >
      {minimalChrome ? (
        <div className="absolute left-2 right-2 top-2 z-20 flex items-center justify-between gap-2 pointer-events-none">
          <div
            className="pointer-events-auto inline-flex items-center gap-1 rounded-md border bg-background/90 px-2 py-1 cursor-grab active:cursor-grabbing select-none"
            onMouseDown={handleMouseDown}
          >
            <GripHorizontal className="w-3 h-3 text-muted-foreground" />
          </div>
          <div className="pointer-events-auto inline-flex items-center gap-2 rounded-md border bg-background/90 px-2 py-1" data-no-drag>
            {onOpacityChange && (
              <Slider
                aria-label="Widget opacity"
                value={[opacity]}
                min={0.2}
                max={1}
                step={0.05}
                onValueChange={(value) => onOpacityChange(value[0])}
                className="w-16"
              />
            )}
            {onSaveLayout && (
              <button
                onClick={onSaveLayout}
                title="Save layout"
                aria-label="Save popout layout"
                className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
              >
                <Save className="w-4 h-4" />
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                title="Close window"
                aria-label="Close window"
                className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      ) : (
        <div
          className="bg-muted px-3 py-2 border-b cursor-grab active:cursor-grabbing flex justify-between items-center rounded-t-md select-none"
          onMouseDown={handleMouseDown}
        >
          <h3 className="text-sm font-semibold text-foreground">{title || 'Widget'}</h3>
          <div className="flex items-center gap-2" data-no-drag>
            {onOpacityChange && (
              <Slider
                aria-label="Widget opacity"
                value={[opacity]}
                min={0.2}
                max={1}
                step={0.05}
                onValueChange={(value) => onOpacityChange(value[0])}
                className="w-20"
              />
            )}
            {onSaveLayout && (
              <button
                onClick={onSaveLayout}
                title="Save layout"
                aria-label="Save popout layout"
                className="text-muted-foreground hover:text-foreground transition-colors ml-2 flex-shrink-0"
              >
                <Save className="w-4 h-4" />
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground transition-colors ml-2 flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex flex-col flex-1 overflow-hidden bg-background">
        {children}
      </div>

      {/* Resize Handle */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize hover:bg-primary/50 transition-colors"
        onMouseDown={(e) => {
          setIsResizing(true);
          const startX = e.clientX;
          const startY = e.clientY;
          const startWidth = size.width;
          const startHeight = size.height;

          const handleMove = (moveEvent: MouseEvent) => {
            const newWidth = Math.max(250, startWidth + (moveEvent.clientX - startX));
            const newHeight = Math.max(200, startHeight + (moveEvent.clientY - startY));
            onSizeChange({ width: newWidth, height: newHeight });
          };

          const handleUp = () => {
            setIsResizing(false);
            document.removeEventListener('mousemove', handleMove);
            document.removeEventListener('mouseup', handleUp);
          };

          document.addEventListener('mousemove', handleMove);
          document.addEventListener('mouseup', handleUp);
        }}
      />
    </div>
  );
}
