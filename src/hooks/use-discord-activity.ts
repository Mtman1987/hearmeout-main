"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDiscordClientId } from "@/lib/runtime-config";

type MaybePromise<T> = T | Promise<T>;

export type DiscordSdkLike = {
  ready?: () => MaybePromise<void>;
  initialize?: () => MaybePromise<void>;
  close?: (code?: number, reason?: string) => MaybePromise<void>;
  destroy?: () => MaybePromise<void>;
  disconnect?: () => MaybePromise<void>;
  setActivity?: (activity: unknown) => MaybePromise<void>;
  commands?: Record<string, unknown>;
  [key: string]: unknown;
};

export interface UseDiscordActivityOptions {
  autoInitialize?: boolean;
  cleanupOnUnmount?: boolean;
  sdkTimeoutMs?: number;
}

export interface UseDiscordActivityResult {
  sdk: DiscordSdkLike | null;
  error: string | null;
  isLoading: boolean;
  loading: boolean;
  isReady: boolean;
  ready: boolean;
  isInitialized: boolean;
  initialized: boolean;
  isAvailable: boolean;
  available: boolean;
  isEmbedded: boolean;
  isInIframe: boolean;
  initialize: () => Promise<DiscordSdkLike | null>;
  reset: () => void;
}

declare global {
  interface Window {
    DiscordSDK?: DiscordSdkLike;
    DiscordSdk?: DiscordSdkLike;
    discordSdk?: DiscordSdkLike;
  }
}

const DEFAULT_SDK_TIMEOUT_MS = 5_000;

let sharedSdkPromise: Promise<DiscordSdkLike | null> | null = null;
let sharedSdk: DiscordSdkLike | null = null;

function getBrowserWindow(): Window | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window;
}

function getGlobalDiscordSdk(): DiscordSdkLike | null {
  const browserWindow = getBrowserWindow();

  if (!browserWindow) {
    return null;
  }

  return (
    browserWindow.DiscordSDK ??
    browserWindow.DiscordSdk ??
    browserWindow.discordSdk ??
    sharedSdk
  );
}

function isInIframeEnvironment(): boolean {
  const browserWindow = getBrowserWindow();

  if (!browserWindow) {
    return false;
  }

  try {
    return browserWindow.self !== browserWindow.top;
  } catch {
    return true;
  }
}

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown Discord activity error.";
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function createDiscordSdk(): Promise<DiscordSdkLike | null> {
  const existing = getGlobalDiscordSdk();
  if (existing) {
    return existing;
  }

  if (!isInIframeEnvironment()) {
    return null;
  }

  try {
    const imported = await import("@discord/embedded-app-sdk");
    const sdk = new imported.DiscordSDK(getDiscordClientId()) as unknown as DiscordSdkLike;
    sharedSdk = sdk;
    return sdk;
  } catch {
    return null;
  }
}

async function runSdkReadyLifecycle(
  sdk: DiscordSdkLike,
  timeoutMs: number,
): Promise<void> {
  const lifecyclePromise =
    typeof sdk.ready === "function"
      ? sdk.ready()
      : typeof sdk.initialize === "function"
        ? sdk.initialize()
        : Promise.resolve();

  await withTimeout(
    Promise.resolve(lifecyclePromise),
    timeoutMs,
    "Discord SDK connection timed out.",
  );
}

async function cleanupDiscordSdk(sdk: DiscordSdkLike | null): Promise<void> {
  if (!sdk) {
    return;
  }

  const candidates: Array<keyof DiscordSdkLike> = ["disconnect", "destroy", "close"];

  for (const methodName of candidates) {
    const method = sdk[methodName];

    if (typeof method === "function") {
      try {
        await method.call(sdk);
      } catch {
        // Best effort cleanup only.
      }

      return;
    }
  }
}

export function useDiscordActivity(
  options: UseDiscordActivityOptions = {},
): UseDiscordActivityResult {
  const {
    autoInitialize = true,
    cleanupOnUnmount = true,
    sdkTimeoutMs = DEFAULT_SDK_TIMEOUT_MS,
  } = options;

  const [sdk, setSdk] = useState<DiscordSdkLike | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const sdkRef = useRef<DiscordSdkLike | null>(null);
  const initializationRef = useRef<Promise<DiscordSdkLike | null> | null>(null);
  const isEmbedded = useMemo(() => isInIframeEnvironment(), []);

  const initialize = useCallback(async (): Promise<DiscordSdkLike | null> => {
    if (typeof window === "undefined") {
      return null;
    }

    if (sdkRef.current) {
      return sdkRef.current;
    }

    if (sharedSdk) {
      sdkRef.current = sharedSdk;
      setSdk(sharedSdk);
      setStatus("ready");
      setError(null);
      return sharedSdk;
    }

    if (initializationRef.current) {
      return initializationRef.current;
    }

    const promise = (async () => {
      setStatus("loading");
      setError(null);

      try {
        const resolvedSdk = await createDiscordSdk();

        if (!resolvedSdk) {
          throw new Error(
            isEmbedded
              ? "Discord SDK is not available in this embedded environment."
              : "Open this experience inside Discord to continue.",
          );
        }

        await runSdkReadyLifecycle(resolvedSdk, sdkTimeoutMs);

        if (mountedRef.current) {
          sharedSdk = resolvedSdk;
          sdkRef.current = resolvedSdk;
          setSdk(resolvedSdk);
          setStatus("ready");
          setError(null);
        }

        return resolvedSdk;
      } catch (caughtError) {
        const message = toMessage(caughtError);

        if (mountedRef.current) {
          setSdk(null);
          setStatus("error");
          setError(message);
        }

        return null;
      } finally {
        initializationRef.current = null;
      }
    })();

    initializationRef.current = promise;
    return promise;
  }, [isEmbedded, sdkTimeoutMs]);

  const reset = useCallback(() => {
    sdkRef.current = null;
    setSdk(null);
    setStatus("idle");
    setError(null);
    initializationRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    if (autoInitialize) {
      void initialize();
    }

    return () => {
      mountedRef.current = false;

      if (cleanupOnUnmount) {
        void cleanupDiscordSdk(sdkRef.current);
        sharedSdk = null;
      }

      reset();
    };
  }, [autoInitialize, cleanupOnUnmount, initialize, reset]);

  const isLoading = status === "loading";
  const isReady = status === "ready";
  const isInitialized = Boolean(sdk ?? sharedSdk ?? sdkRef.current ?? isReady);
  const isAvailable = Boolean(sdk ?? sharedSdk ?? getGlobalDiscordSdk() ?? isEmbedded);

  return {
    sdk,
    error,
    isLoading,
    loading: isLoading,
    isReady,
    ready: isReady,
    isInitialized,
    initialized: isInitialized,
    isAvailable,
    available: isAvailable,
    isEmbedded,
    isInIframe: isEmbedded,
    initialize,
    reset,
  };
}

export default useDiscordActivity;
