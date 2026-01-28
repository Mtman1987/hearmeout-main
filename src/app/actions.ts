"use server";

import { moderateContent } from "@/ai/flows/sentiment-based-moderation";
import type { ModerateContentOutput } from "@/ai/flows/sentiment-based-moderation";
import { getYoutubeInfo as getYoutubeInfoFlow } from "@/ai/flows/get-youtube-info-flow";
import type { PlaylistItem } from "@/types/playlist";
import { AccessToken } from 'livekit-server-sdk';
import { sendControlEmbed } from '@/bots/discord-bot';

export async function runModeration(
  conversationHistory: string
): Promise<ModerateContentOutput> {
  try {
    const result = await moderateContent({ conversationHistory });
    return result;
  } catch (error) {
    console.error("Error running moderation:", error);
    return {
      overallSentiment: "Error",
      isHarmful: true,
      alertReason: "Failed to analyze content.",
    };
  }
}

export async function getYoutubeInfo(url: string): Promise<PlaylistItem[] | null> {
  try {
    const result = await getYoutubeInfoFlow({ url }) as PlaylistItem[] | null;
    return result;
  } catch (error) {
    console.error("Error getting YouTube info:", error);
    return null;
  }
}

export async function generateLiveKitToken(roomName: string, participantIdentity: string, participantName: string, participantMetadata: string) {
  if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET || !process.env.NEXT_PUBLIC_LIVEKIT_URL) {
    throw new Error('LiveKit server environment variables are not configured.');
  }

  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity: participantIdentity,
    name: participantName,
    metadata: participantMetadata,
    ttl: '10m', // The token is valid for 10 minutes
  });

  at.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true });

  return at.toJwt();
}

export async function postToDiscord() {
    const channelId = process.env.DISCORD_CHANNEL_ID;
    if (!channelId) {
        console.error("DISCORD_CHANNEL_ID is not set in environment variables.");
        throw new Error("Discord channel ID is not configured on the server.");
    }
    try {
        await sendControlEmbed(channelId);
    } catch (error) {
        console.error("Error posting to Discord:", error);
        // We throw the error so the client can catch it and display a message.
        // The error from sendControlEmbed is already descriptive.
        throw error;
    }
}
