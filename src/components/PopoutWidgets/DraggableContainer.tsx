'use client';

import React, { useRef, useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';

interface DraggableContainerProps {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  onPositionChange: (pos: { x: number; y: number }) => void;
  onSizeChange: (size: { width: number; height: number }) => void;
  children: React.ReactNode;
  title?: string;
  onClose?: () => void;
}

export function DraggableContainer({
  id,
  position,
  size,
  onPositionChange,
  onSizeChange,
  children,
  title,
  onClose,
}: DraggableContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isResizing, setIsResizing] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

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
      const newX = Math.max(0, e.clientX - dragOffset.x);
      const newY = Math.max(0, e.clientY - dragOffset.y);
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

  return (
    <div
      ref={containerRef}
      className={cn(
        'fixed bg-background border border-border rounded-lg shadow-2xl z-50',
        'flex flex-col',
        isDragging && 'opacity-75 cursor-grabbing'
      )}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${size.width}px`,
        height: `${size.height}px`,
      }}
    >
      {/* Header - Draggable */}
      <div
        className="bg-muted px-3 py-2 border-b cursor-grab active:cursor-grabbing flex justify-between items-center rounded-t-md select-none"
        onMouseDown={handleMouseDown}
      >
        <h3 className="text-sm font-semibold text-foreground">{title || 'Widget'}</h3>
        {onClose && (
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors ml-2 flex-shrink-0"
            data-no-drag
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

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
