import { NextRequest, NextResponse } from 'next/server';
import { DiscordChatService } from '@/lib/discord-chat-service';
import { handleMusicCommand } from '@/lib/music-command-service';
import { handleWatchRequestCommand } from '@/lib/watch/watch-request-service';
import { db, ensureDb } from '@/lib/db';
import { HARDCODED_GUILD_ID } from '@/lib/constants';

type DiscordBotTarget = {
  guildId: string;
  channelId: string;
  roomId?: string;
};

type DiscordBotListener = {
  stop: () => void;
  target: DiscordBotTarget;
};

const listeners = new Map<string, DiscordBotListener>();
let isInitialized = false;
let syncTimer: ReturnType<typeof setInterval> | null = null;

function getPublicBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.APP_URL ||
    'https://hearmeout-main.fly.dev'
  ).replace(/\/$/, '');
}

function getConfiguredDiscordTargets(): DiscordBotTarget[] {
  const fallbackGuildId =
    process.env.HARDCODED_GUILD_ID ||
    process.env.NEXT_PUBLIC_HARDCODED_GUILD_ID ||
    HARDCODED_GUILD_ID ||
    'local';
  const fallbackChannelId = String(process.env.DISCORD_CHANNEL_ID || '').trim();
  const targets = new Map<string, DiscordBotTarget>();

  const rooms = db.list('rooms');
  for (const room of rooms) {
    const users = db.list(`rooms/${room.id}/users`);
    for (const user of users) {
      const guildId = String(user.data?.discordGuildId || '').trim() || fallbackGuildId;
      const channelId = String(user.data?.discordSelectedChannel || '').trim();
      if (!channelId) continue;
      targets.set(`${guildId}:${channelId}`, {
        guildId,
        channelId,
        roomId: room.id,
      });
    }
  }

  if (targets.size === 0 && fallbackChannelId) {
    targets.set(`${fallbackGuildId}:${fallbackChannelId}`, {
      guildId: fallbackGuildId,
      channelId: fallbackChannelId,
    });
  }

  return Array.from(targets.values());
}

function stopListener(key: string) {
  const listener = listeners.get(key);
  if (!listener) return;
  try {
    listener.stop();
  } catch (error) {
    console.error('[Discord Bot] Failed to stop listener:', error);
  }
  listeners.delete(key);
}

function startListener(target: DiscordBotTarget) {
  const key = `${target.guildId}:${target.channelId}`;
  if (listeners.has(key)) return;

  const stop = DiscordChatService.subscribeToChannel(
    target.channelId,
    async (message) => {
      if (!message.content?.trim()) return;
      if (message.role === 'bot') return;

      try {
        const handled = await handleWatchRequestCommand({
          message: message.content,
          discordUserId: message.authorId,
          discordUserName: message.author,
          guildId: target.guildId,
          channelId: target.channelId,
          userMessageId: message.id,
          publicBaseUrl: getPublicBaseUrl(),
        });
        if (!handled) {
          await handleMusicCommand({
            message: message.content,
            userId: message.authorId,
            username: message.author,
            platform: 'discord',
            roomId: target.roomId,
            guildId: target.guildId,
            channelId: target.channelId,
            publicBaseUrl: getPublicBaseUrl(),
          });
        }
      } catch (error) {
        console.error('[Discord Bot] command handler failed:', error);
      }
    },
    (error) => {
      console.error(`[Discord Bot] Polling failed for ${key}:`, error);
    },
    5000
  );

  listeners.set(key, { stop, target });
  console.log(`[Discord Bot] Listening on guild ${target.guildId} channel ${target.channelId}`);
}

async function syncDiscordListeners() {
  await ensureDb();
  const targets = getConfiguredDiscordTargets();
  const desired = new Set(targets.map((target) => `${target.guildId}:${target.channelId}`));

  for (const key of Array.from(listeners.keys())) {
    if (!desired.has(key)) {
      stopListener(key);
    }
  }

  for (const target of targets) {
    startListener(target);
  }
}

async function initializeDiscordBot() {
  if (isInitialized) return;

  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    console.error('[Discord Bot] DISCORD_BOT_TOKEN is not configured');
    return;
  }

  DiscordChatService.initialize(botToken);
  await syncDiscordListeners();

  if (!syncTimer) {
    syncTimer = setInterval(() => {
      syncDiscordListeners().catch((error) => {
        console.error('[Discord Bot] Sync failed:', error);
      });
    }, 30000);
  }

  isInitialized = true;
}

export async function GET() {
  await initializeDiscordBot();

  return NextResponse.json({
    status: isInitialized ? 'running' : 'not initialized',
    listenerCount: listeners.size,
    listeners: Array.from(listeners.values()).map((listener) => listener.target),
  });
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  if (action === 'restart') {
    for (const key of Array.from(listeners.keys())) {
      stopListener(key);
    }
    isInitialized = false;
    await initializeDiscordBot();
    return NextResponse.json({
      success: isInitialized,
      status: isInitialized ? 'restarted' : 'failed',
      listenerCount: listeners.size,
    });
  }

  return NextResponse.json(
    { error: 'Use ?action=restart' },
    { status: 400 }
  );
}
