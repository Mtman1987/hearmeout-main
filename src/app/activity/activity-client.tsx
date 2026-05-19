'use client';

import { useEffect, useMemo, useState } from 'react';
import WatchRoomClient from '../watch/[sessionId]/watch-room-client';

type ActivityState = {
  sessionId: string;
  status: string;
};

function sessionIdFor(guildId: string | null | undefined, channelId: string | null | undefined) {
  return `${guildId || 'local'}-${channelId || 'watch'}`.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error('Discord Activity SDK timed out.')), milliseconds);
    }),
  ]);
}

export default function ActivityClient() {
  const [activity, setActivity] = useState<ActivityState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;

  const fallbackSessionId = useMemo(() => {
    if (typeof window === 'undefined') return 'local-watch';
    const params = new URLSearchParams(window.location.search);
    return params.get('sessionId') || sessionIdFor(params.get('guild_id'), params.get('channel_id')) || 'local-watch';
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function startActivity() {
      if (!clientId) {
        setError('Discord client id is not configured.');
        setActivity({ sessionId: fallbackSessionId, status: 'Fallback room' });
        return;
      }

      try {
        const { DiscordSDK } = await import('@discord/embedded-app-sdk');
        const discordSdk = new DiscordSDK(clientId);
        await withTimeout(discordSdk.ready(), 5000);

        if (cancelled) return;

        setActivity({
          sessionId: sessionIdFor(discordSdk.guildId, discordSdk.channelId),
          status: 'Connected',
        });
      } catch (sdkError: any) {
        if (cancelled) return;
        console.warn('[Activity] Discord SDK failed, using fallback session:', sdkError);
        setError(sdkError?.message || 'Discord Activity SDK failed.');
        setActivity({ sessionId: fallbackSessionId, status: 'Fallback room' });
      }
    }

    startActivity();
    return () => {
      cancelled = true;
    };
  }, [clientId, fallbackSessionId]);

  if (!activity) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#101318] p-6 text-slate-100">
        <div className="w-full max-w-md rounded-lg border border-slate-700 bg-[#171b20] p-5">
          <p className="text-sm text-slate-400">Opening Discord Activity...</p>
        </div>
      </main>
    );
  }

  return (
    <div>
      <div className="border-b border-slate-800 bg-[#101318] px-4 py-2 text-xs text-slate-400">
        Discord Activity: {activity.status}
        {error ? <span className="ml-2 text-amber-300">{error}</span> : null}
      </div>
      <WatchRoomClient sessionId={activity.sessionId} />
    </div>
  );
}
