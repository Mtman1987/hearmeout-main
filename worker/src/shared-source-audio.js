'use strict';
// Select once at the producer. Every listener receives this same rendition.
function selectSharedAudioStream(streams) {
  const audio = streams.filter(stream => stream.codec_type === 'audio');
  const preferred = audio.find(stream => /^(eng|en|english)$/i.test(stream.tags?.language || ''))
    || audio.find(stream => stream.disposition?.default === 1) || audio[0];
  return Number.isInteger(preferred?.index) ? preferred.index : null;
}
module.exports = { selectSharedAudioStream };
