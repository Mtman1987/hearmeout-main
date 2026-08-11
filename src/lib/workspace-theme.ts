import type { WorkspaceThemeTokensV1 } from '@spmt/sdk';

const WORKSPACE_BACKGROUND_IMAGES: Record<string, string> = {
  'solar-flare': 'https://spacemountain.live/assets/theme-solar-flare-background.webp',
  'nebula-purple': 'https://spacemountain.live/assets/theme-nebula-purple-background.webp',
  'oceanic-blue': 'https://spacemountain.live/assets/theme-oceanic-blue-background.webp',
  'aurora-green': 'https://spacemountain.live/assets/theme-aurora-green-background.webp',
};

const WORKSPACE_PROPERTIES = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--accent',
  '--ring',
  '--radius',
  '--workspace-background-image',
  '--workspace-glow-intensity',
  '--workspace-star-density',
  '--workspace-glass-opacity',
  '--workspace-blur-strength',
  '--workspace-nebula-intensity',
  '--workspace-parallax-depth',
  '--workspace-border-strength',
  '--workspace-chat-transparency',
  '--workspace-animation-speed',
  '--workspace-shooting-star-duration',
  '--workspace-dock-slot-count',
];

export function hexToHslComponents(hex: string): string {
  const normalized = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) throw new Error(`Invalid workspace color: ${hex}`);
  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return `${Math.round(hue)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`;
}

export function clearWorkspaceThemeTokens(root: HTMLElement): void {
  for (const property of WORKSPACE_PROPERTIES) root.style.removeProperty(property);
  delete root.dataset.workspaceTheme;
  delete root.dataset.workspaceDensity;
  delete root.dataset.workspaceMotion;
  delete root.dataset.workspaceSidebarCollapsed;
  delete root.dataset.workspaceSidebarStyle;
  delete root.dataset.workspaceSidebarPosition;
  delete root.dataset.workspaceTopbarStyle;
  delete root.dataset.workspaceTabStyle;
  delete root.dataset.workspaceTabPosition;
  delete root.dataset.workspaceShowAvatars;
  delete root.dataset.workspaceSmoothTransitions;
  delete root.dataset.workspacePushToTalk;
  delete root.dataset.workspaceParticles;
  delete root.dataset.workspaceShootingStars;
  delete root.dataset.workspaceOverlayEnabled;
  delete root.dataset.workspaceOverlayWidgets;
  delete root.dataset.workspaceOverlayWorkflows;
  delete root.dataset.workspaceTtsSubscriptions;
  delete root.dataset.workspaceDockSlots;
}

export function applyWorkspaceThemeTokens(root: HTMLElement, tokens: WorkspaceThemeTokensV1): void {
  const background = hexToHslComponents(tokens.background);
  const surface = hexToHslComponents(tokens.surface);
  const text = hexToHslComponents(tokens.text);
  const accent = hexToHslComponents(tokens.accent);
  root.classList.add('dark');
  root.style.setProperty('--background', background);
  root.style.setProperty('--foreground', text);
  root.style.setProperty('--card', surface);
  root.style.setProperty('--card-foreground', text);
  root.style.setProperty('--popover', surface);
  root.style.setProperty('--popover-foreground', text);
  root.style.setProperty('--primary', accent);
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--ring', accent);
  root.style.setProperty(
    '--workspace-background-image',
    `url("${WORKSPACE_BACKGROUND_IMAGES[tokens.themeId] || WORKSPACE_BACKGROUND_IMAGES['solar-flare']}")`,
  );
  const radius = ({ sm: '12px', md: '18px', lg: '26px', full: '999px' } as Record<string, string>)[tokens.radius] || tokens.radius;
  root.style.setProperty('--radius', radius);

  const appearance = tokens.appearance;
  if (appearance) {
    root.style.setProperty('--workspace-glow-intensity', String(appearance.glowIntensity / 100));
    root.style.setProperty('--workspace-star-density', String(appearance.starDensity / 100));
    root.style.setProperty('--workspace-glass-opacity', String(appearance.glassOpacity / 100));
    root.style.setProperty('--workspace-blur-strength', `${appearance.blurStrength}px`);
    root.style.setProperty('--workspace-nebula-intensity', String(appearance.nebulaIntensity / 100));
    root.style.setProperty('--workspace-parallax-depth', String(appearance.parallaxDepth / 100));
    root.style.setProperty('--workspace-border-strength', String(appearance.borderStrength / 100));
    root.style.setProperty('--workspace-chat-transparency', String(appearance.chatTransparency / 100));
    root.style.setProperty('--workspace-animation-speed', String(appearance.animation.speed / 100));
    root.style.setProperty('--workspace-shooting-star-duration', `${1200 / appearance.animation.speed}s`);
    root.dataset.workspaceSidebarCollapsed = appearance.sidebarCollapsed ? 'true' : 'false';
    root.dataset.workspaceSidebarStyle = appearance.sidebarStyle;
    root.dataset.workspaceSidebarPosition = appearance.sidebarPosition;
    root.dataset.workspaceTopbarStyle = appearance.topbarStyle;
    root.dataset.workspaceTabStyle = appearance.tabStyle;
    root.dataset.workspaceTabPosition = appearance.tabPosition;
    root.dataset.workspaceShowAvatars = appearance.showAvatars ? 'true' : 'false';
    root.dataset.workspaceSmoothTransitions = appearance.smoothTransitions ? 'true' : 'false';
    root.dataset.workspacePushToTalk = appearance.pushToTalk ? 'true' : 'false';
    root.dataset.workspaceParticles = appearance.animation.particles ? 'true' : 'false';
    root.dataset.workspaceShootingStars = appearance.animation.shootingStars ? 'true' : 'false';
  }

  root.style.setProperty('--workspace-dock-slot-count', String(tokens.dockSlots?.length || 0));
  root.dataset.workspaceTheme = tokens.themeId;
  root.dataset.workspaceDensity = tokens.density;
  root.dataset.workspaceMotion = tokens.motion.enabled ? 'on' : 'off';
  root.dataset.workspaceTtsSubscriptions = (tokens.ttsSubscriptions || []).join(',');
  root.dataset.workspaceDockSlots = encodeURIComponent(JSON.stringify(tokens.dockSlots || []));
  delete root.dataset.workspaceOverlayEnabled;
  delete root.dataset.workspaceOverlayWidgets;
  delete root.dataset.workspaceOverlayWorkflows;
  if (tokens.overlayWorkspace) {
    root.dataset.workspaceOverlayEnabled = tokens.overlayWorkspace.enabled ? 'true' : 'false';
    root.dataset.workspaceOverlayWidgets = encodeURIComponent(JSON.stringify(tokens.overlayWorkspace.widgets || []));
    root.dataset.workspaceOverlayWorkflows = encodeURIComponent(JSON.stringify(tokens.overlayWorkspace.workflows || []));
  }
}
