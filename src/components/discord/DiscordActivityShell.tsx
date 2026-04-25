"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useDiscordActivity } from "@/hooks/use-discord-activity";

type SearchParamValue = string | string[] | undefined;

export interface DiscordActivityShellProps {
  searchParams?: Record<string, SearchParamValue>;
}

function firstValue(value: SearchParamValue): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function sanitizePath(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  if (!value.startsWith("/")) {
    return null;
  }

  return value;
}

function buildTargetHref(searchParams: Record<string, SearchParamValue>): string {
  const roomId = firstValue(searchParams.roomId) ?? firstValue(searchParams.room);
  const nextPath =
    sanitizePath(firstValue(searchParams.next)) ??
    sanitizePath(firstValue(searchParams.path)) ??
    sanitizePath(firstValue(searchParams.redirect));

  if (roomId) {
    return `/rooms/${encodeURIComponent(roomId)}`;
  }

  return nextPath ?? "/";
}

function ActivityFrame({ href }: { href: string }) {
  return (
    <iframe
      className="h-full w-full rounded-2xl border border-white/10 bg-slate-900 shadow-2xl"
      src={href}
      title="HearMeOut activity"
      allow="autoplay; fullscreen; microphone; camera; clipboard-read; clipboard-write"
      allowFullScreen
      referrerPolicy="no-referrer"
    />
  );
}

function StatusPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-200">
      {label}
    </span>
  );
}

export function DiscordActivityShell({ searchParams = {} }: DiscordActivityShellProps) {
  const [mounted, setMounted] = useState(false);
  const { error, isLoading, isReady, isEmbedded } = useDiscordActivity({
    autoInitialize: true,
    cleanupOnUnmount: true,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  const targetHref = useMemo(() => buildTargetHref(searchParams), [searchParams]);
  const isRoomTarget = targetHref.startsWith("/rooms/");
  const isLoginTarget = targetHref === "/login";
  const primaryLabel = isRoomTarget
    ? "Open the selected room"
    : isLoginTarget
      ? "Open the login page"
      : "Open HearMeOut";
  const secondaryHref = targetHref === "/" ? "/login" : "/";

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
        <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur">
          <StatusPill label="Preparing Discord activity" />
          <h1 className="mt-4 text-2xl font-semibold">Loading embedded HearMeOut…</h1>
          <p className="mt-2 text-sm text-slate-300">
            Initializing the activity shell and checking for the Discord SDK.
          </p>
        </div>
      </div>
    );
  }

  if (isReady) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-white">HearMeOut</p>
            <p className="text-xs text-slate-400">Discord voice channel activity</p>
          </div>
          <StatusPill label={isEmbedded ? "Connected to Discord" : "Ready"} />
        </header>
        <main className="flex min-h-0 flex-1 p-3 sm:p-4">
          <div className="min-h-0 flex-1 overflow-hidden rounded-3xl border border-white/10 bg-black/20 shadow-2xl">
            <ActivityFrame href={targetHref} />
          </div>
        </main>
      </div>
    );
  }

  const headline = isLoading
    ? "Connecting to Discord…"
    : isEmbedded
      ? "Discord activity is not ready yet"
      : "Open HearMeOut in your browser";

  const description = error
    ? error
    : isEmbedded
      ? "The embedded SDK is still initializing. If this keeps failing, open the regular app instead."
      : "This route is optimized for Discord voice channel embeds, but you can continue in the regular web app.";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-8 text-slate-100">
      <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur sm:p-8">
        <StatusPill label={isLoading ? "Starting up" : "Browser fallback"} />
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">{headline}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">{description}</p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link
            className="inline-flex items-center justify-center rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
            href={targetHref}
          >
            {primaryLabel}
          </Link>
          <Link
            className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            href={secondaryHref}
          >
            {secondaryHref === "/login" ? "Go to login" : "Open the home page"}
          </Link>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-slate-900/60 p-4 text-sm text-slate-300">
          <p className="font-medium text-white">Tip</p>
          <p className="mt-1">
            If you expected to see the Discord embedded experience, open this route from a Discord
            voice channel or continue in the main app using the button above.
          </p>
        </div>
      </div>
    </div>
  );
}

export default DiscordActivityShell;