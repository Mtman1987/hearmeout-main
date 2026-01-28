// This file does not use 'dotenv/config' because it's intended to be used
// in a Next.js server environment where process.env is already populated.

/**
 * Sends a pre-defined control embed to a specified Discord channel.
 * This embed includes buttons for:
 * - Request a Song
 * - Play/Pause
 * - Skip Track
 *
 * @param channelId The ID of the Discord channel to send the message to.
 */
export async function sendControlEmbed(channelId: string) {
    const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

    if (!DISCORD_BOT_TOKEN) {
        console.error("DISCORD_BOT_TOKEN is not set in environment variables.");
        throw new Error("Discord bot is not configured on the server.");
    }
    
    const url = `https://discord.com/api/v10/channels/${channelId}/messages`;

    const body = {
        embeds: [
            {
                title: "🎵 HearMeOut Player Controls",
                description: "Use the buttons below to control the music player and request songs.",
                color: 5814783, // A nice blue color (#58b9ff)
                fields: [
                    {
                        name: "📝 Request Songs",
                        value: "Click 'Request a Song' to add music to the queue",
                        inline: false
                    },
                    {
                        name: "🎛️ Playback Controls",
                        value: "Use Play/Pause and Skip buttons to control playback",
                        inline: false
                    }
                ],
                thumbnail: {
                    url: "https://media.discordapp.net/attachments/1234567890/1234567890/music_icon.png"
                }
            }
        ],
        components: [
            {
                type: 1, // Action Row
                components: [
                    {
                        type: 2, // Button
                        style: 1, // Primary (blue)
                        label: "Request a Song",
                        emoji: {
                            name: "🎵"
                        },
                        custom_id: "request_song_modal_trigger", 
                    },
                    {
                        type: 2, // Button
                        style: 1, // Primary (blue)
                        label: "Play/Pause",
                        emoji: {
                            name: "⏯️"
                        },
                        custom_id: "music_play_pause_btn",
                    },
                    {
                        type: 2, // Button
                        style: 1, // Primary (blue)
                        label: "Skip",
                        emoji: {
                            name: "⏭️"
                        },
                        custom_id: "music_skip_btn",
                    }
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
