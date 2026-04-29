export interface PopoutState {
  id: string;
  type: 'voice' | 'chat';
  isOpen: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  isDocked?: boolean;
  dockPosition?: 'top' | 'bottom' | 'left' | 'right';
  customSettings?: Record<string, any>;
}

export interface PopoutContextType {
  popouts: PopoutState[];
  openPopout: (
    type: PopoutState['type'],
    initialSize?: { width: number; height: number }
  ) => void;
  closePopout: (id: string) => void;
  updatePopout: (id: string, updates: Partial<PopoutState>) => void;
  getPopout: (id: string) => PopoutState | undefined;
}
