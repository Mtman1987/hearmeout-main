'use client';

import { useEffect, useMemo, useState } from 'react';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import { DISCORD_CLIENT_ID } from '@/lib/public-config';
import { GLOBAL_WATCH_SESSION_ID } from '@/lib/watch-session';
import WatchRoomClient from '../watch/[sessionId]/watch-room-client';

type ActivityState = {
  sessionId: string;
  status: string;
};

function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error('Discord Activity SDK timed out while waiting for Discord client readiness.')), milliseconds);
    }),
  ]);
}

export default function ActivityClient() {
  const [activity, setActivity] = useState<ActivityState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('Starting Discord Activity...');
  const clientId = DISCORD_CLIENT_ID;

  const fallbackSessionId = useMemo(() => {
    return GLOBAL_WATCH_SESSION_ID;
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
        setStatus('Connecting to Discord...');
        const discordSdk = new DiscordSDK(clientId);
        setStatus('Waiting for Discord ready...');
        await withTimeout(discordSdk.ready(), 20000);

        if (cancelled) return;

        setStatus('Opening watch room...');
        setActivity({
          sessionId: GLOBAL_WATCH_SESSION_ID,
          status: 'Connected',
        });
      } catch (sdkError: any) {
        if (cancelled) return;
        console.warn('[Activity] Discord SDK failed, using fallback session:', sdkError);
        setError(sdkError?.message || 'Discord Activity SDK failed.');
        setStatus('Opening fallback watch room...');
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
          <p className="mt-2 text-xs text-slate-500">{status}</p>
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
      <WatchRoomClient sessionId={activity.sessionId} activityMode />
    </div>
  );
}
