'use strict';

/**
 * Selects a single YouTube format that already contains both video and audio.
 * This keeps Apollo on one media URL instead of preparing separate tracks or
 * building an intermediate HLS source for ordinary YouTube playback.
 */
function isCombinedYoutubeFormat(format) {
  if (!format || typeof format.url !== 'string' || !/^https?:\/\//i.test(format.url)) return false;
  const mimeType = String(format.mimeType || format.mime_type || '');
  const hasVideo = Boolean(format.has_video || format.width || format.height || /^video\//i.test(mimeType));
  const hasAudio = Boolean(format.has_audio || format.audioQuality || format.audio_quality || format.audioSampleRate || format.audio_sample_rate);
  return hasVideo && hasAudio;
}

function combinedYoutubeFormatScore(format) {
  const mimeType = String(format.mimeType || format.mime_type || '');
  const height = Number(format.height || 0);
  const boundedHeight = height > 720 ? 0 : height;
  const mp4 = /video\/mp4/i.test(mimeType) ? 1 : 0;
  const h264 = /avc1|h264/i.test(mimeType) ? 1 : 0;
  const bitrate = Number(format.bitrate || 0);
  return mp4 * 1e12 + h264 * 1e11 + boundedHeight * 1e6 + bitrate;
}

function pickCombinedYoutubeFormat(formats) {
  return [...(Array.isArray(formats) ? formats : [])]
    .filter(isCombinedYoutubeFormat)
    .sort((a, b) => combinedYoutubeFormatScore(b) - combinedYoutubeFormatScore(a))[0] || null;
}

module.exports = { isCombinedYoutubeFormat, pickCombinedYoutubeFormat };
