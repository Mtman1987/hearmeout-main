// This file does not use 'dotenv/config' because it's intended to be used
// in a Next.js server environment where process.env is already populated.

/**
 * Sends a pre-defined control embed to a specified Discord channel.
 * This embed shows room info and provides buttons for Settings, Twitch, Discord, and Close.
 *
 * @param channelId The ID of the Discord channel to send the message to.
 * @param roomId The room ID to fetch data from.
 * @param roomName The name of the room.
 * @param description Optional description for the room.
 * @param twitchUrl Optional Twitch stream URL.
 * @param discordUrl Optional Discord server URL.
 */
export async function sendControlEmbed(
  channelId: string,
  roomId?: string,
  roomName?: string,
  description?: string,
  twitchUrl?: string,
  discordUrl?: string
) {
    const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

    if (!DISCORD_BOT_TOKEN) {
        console.error("DISCORD_BOT_TOKEN is not set in environment variables.");
        throw new Error("Discord bot is not configured on the server.");
    }
    
    const url = `https://discord.com/api/v10/channels/${channelId}/messages`;

    const body = {
        embeds: [
            {
                title: `🎵 ${roomName || 'HearMeOut Music Room'}`,
                description: description || 'Join us for music and chat!',
                color: 5814783,
                fields: [
                    {
                        name: '👥 Listeners',
                        value: 'Loading...',
                        inline: true
                    },
                    {
                        name: '🎧 Now Playing',
                        value: 'Nothing playing',
                        inline: true
                    }
                ],
                footer: {
                    text: `Room ID: ${roomId || 'N/A'}`
                }
            }
        ],
        components: [
            {
                type: 1,
                components: [
                    {
                        type: 2,
                        style: 1,
                        label: 'Settings',
                        emoji: { name: '⚙️' },
                        custom_id: `room_settings:${roomId}`,
                    },
                    ...(twitchUrl ? [{
                        type: 2,
                        style: 5,
                        label: 'Twitch',
                        emoji: { name: '📺' },
                        url: twitchUrl,
                    }] : []),
                    ...(discordUrl ? [{
                        type: 2,
                        style: 5,
                        label: 'Discord',
                        emoji: { name: '💬' },
                        url: discordUrl,
                    }] : []),
                    {
                        type: 2,
                        style: 4,
                        label: 'Close',
                        emoji: { name: '❌' },
                        custom_id: `room_close:${roomId}`,
                    },
                ]
            }
        ]
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorData = await response.json();
        console.error("Failed to send Discord message:", errorData);
        throw new Error(`Failed to send message to Discord. Status: ${response.status}`);
    }

    return response.json();
}
