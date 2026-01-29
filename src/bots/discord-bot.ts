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
        console.error("DISCORD_BOT_TOKEN is not set in environment variables.");
        throw new Error("Discord bot is not configured on the server.");
    }
    
    const url = `https://discord.com/api/v10/channels/${channelId}/messages`;

    const buttons = [
        {
            type: 2,
            style: 1,
            label: 'Settings',
            emoji: { name: '⚙️' },
            custom_id: `room_settings:${roomId}`,
        }
    ];

    // Add custom link buttons if provided
    if (link1Label && link1Url) {
        buttons.push({
            type: 2,
            style: 5,
            label: link1Label,
            url: link1Url,
        });
    }
    if (link2Label && link2Url) {
        buttons.push({
            type: 2,
            style: 5,
            label: link2Label,
            url: link2Url,
        });
    }

    // Add close button
    buttons.push({
        type: 2,
        style: 4,
        label: 'Close',
        emoji: { name: '❌' },
        custom_id: `room_close:${roomId}`,
    });

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
        const errorData = await response.json();
        console.error("Failed to send Discord message:", errorData);
        throw new Error(`Failed to send message to Discord. Status: ${response.status}`);
    }

    return response.json();
}
