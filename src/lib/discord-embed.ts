/**
 * Discord embed utility — delegates to DSH's /api/discord/post.
 * DSH owns the Discord bot token and handles all embed posting.
 * HMO just tells DSH what to send and where.
 */

import { getDshUrl } from '@/lib/runtime-config';

async function readResponseError(res: Response): Promise<string> {
  const fallback = res.statusText || 'Unknown error';

  try {
    const text = await res.text();
    if (!text) return fallback;

    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string; details?: unknown };
      return parsed.error || parsed.message || text;
    } catch {
      return text;
    }
  } catch {
    return fallback;
  }
}

export async function sendControlEmbed(
  channelId: string,
  roomId?: string,
  roomName?: string,
  description?: string,
  link1Label?: string,
  link1Url?: string,
  link2Label?: string,
  link2Url?: string
) {
  if (!channelId) throw new Error('Channel ID is required');

  const buttons: any[] = [
    { type: 2, style: 1, label: 'Settings', emoji: { name: '⚙️' }, custom_id: `room_settings:${roomId || 'room'}` },
  ];

  if (link1Label && link1Url && link1Label !== '[]' && link1Url !== '[]') {
    buttons.push({ type: 2, style: 5, label: link1Label.slice(0, 80), url: link1Url });
  }
  if (link2Label && link2Url && link2Label !== '[]' && link2Url !== '[]') {
    buttons.push({ type: 2, style: 5, label: link2Label.slice(0, 80), url: link2Url });
  }

  buttons.push({ type: 2, style: 4, label: 'Close', emoji: { name: '❌' }, custom_id: `room_close:${roomId || 'room'}` });

  const res = await fetch(`${getDshUrl()}/api/discord/post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channelId,
      embeds: [{
        title: (roomName || 'HearMeOut Music Room').slice(0, 256),
        description: (description || 'Join us for music and chat!').slice(0, 4096),
        color: 5814783,
        footer: { text: `Room ID: ${(roomId || 'N/A').slice(0, 2048)}` },
      }],
      components: [{ type: 1, components: buttons }],
    }),
  });

  if (!res.ok) {
    const error = await readResponseError(res);
    throw new Error(`DSH embed post failed: ${error}`);
  }

  return res.json();
}