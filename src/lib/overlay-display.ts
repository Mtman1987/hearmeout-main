export function shouldShowNowPlayingPanel(input: {
  cleanMode: boolean;
  userPreference: boolean;
  sourceRequested: boolean;
}) {
  return input.sourceRequested || (!input.cleanMode && input.userPreference);
}

export function shouldRenderCleanIdle(input: {
  cleanMode: boolean;
  hasPlaybackUrl: boolean;
  showNowPlayingPanel: boolean;
}) {
  return input.cleanMode && !input.hasPlaybackUrl && !input.showNowPlayingPanel;
}
