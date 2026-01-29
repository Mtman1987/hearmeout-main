// This file does not use 'dotenv/config' because it's intended to be used
// in a Next.js server environment where process.env is already populated.

/**
 * Sends a pre-defined control embed to a specified Discord channel.
 * This embed shows room info and provides buttons for Settings, custom links, and Close.
 *
 * @param channelId The ID of the Discord channel to send the message to.
 * @param roomId The room ID to fetch data from.
 * @param roomName The name of the room.
 * @param description Optional description for the room.
 * @param link1Label Optional label for first custom link.
 * @param link1Url Optional URL for first custom link.
 * @param link2Label Optional label for second custom link.
 * @param link2Url Optional URL for second custom link.
 */
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
    const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

    if (!DISCORD_BOT_TOKEN) {
        console.error("[sendControlEmbed] DISCORD_BOT_TOKEN is not set in environment variables.");
        throw new Error("Discord bot token is not configured. Add DISCORD_BOT_TOKEN to your environment.");
    }
    
    if (!channelId) {
        throw new Error("Channel ID is required");
    }
    
    console.log('[sendControlEmbed] Sending to channel:', channelId);
    
    const url = `https://discord.com/api/v10/channels/${channelId}/messages`;

    const buttons = [
        {
            type: 2,
            style: 1,
            label: 'Settings',
            emoji: { name: '⚙️' },
            custom_id: `settings_${roomId?.slice(0, 20) || 'room'}`,
        }
    ];

    // Add custom link buttons if provided (validate they're not empty arrays or invalid)
    if (link1Label && link1Url && link1Label !== '[]' && link1Url !== '[]') {
        buttons.push({
            type: 2,
            style: 5,
            label: link1Label.slice(0, 80),
            url: link1Url,
        });
    }
    if (link2Label && link2Url && link2Label !== '[]' && link2Url !== '[]') {
        buttons.push({
            type: 2,
            style: 5,
            label: link2Label.slice(0, 80),
            url: link2Url,
        });
    }

    // Add close button
    buttons.push({
        type: 2,
        style: 4,
        label: 'Close',
        emoji: { name: '❌' },
        custom_id: `close_${roomId?.slice(0, 20) || 'room'}`,
    });

    const body = {
        embeds: [
            {
                title: (roomName || 'HearMeOut Music Room').slice(0, 256),
                description: (description || 'Join us for music and chat!').slice(0, 4096),
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
                    text: `Room ID: ${(roomId || 'N/A').slice(0, 2048)}`
                }
            }
        ],
        components: [
            {
                type: 1,
                components: buttons
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
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        console.error("[sendControlEmbed] Failed to send Discord message:", {
            status: response.status,
            statusText: response.statusText,
            error: errorData
        });
        throw new Error(`Discord API error: ${errorData.message || response.statusText}`);
    }

    console.log('[sendControlEmbed] Successfully sent embed');
    return response.json();
}
