const DISCORD_API = "https://discord.com/api/v10";

function getConfig() {
  const token = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;
  return { token, channelId };
}

/**
 * Send a message to the configured Discord channel via Bot API.
 * Same pattern as deluge-monitor.sh.
 */
export async function sendDiscordMessage(content: string): Promise<boolean> {
  const { token, channelId } = getConfig();

  if (!token || !channelId) {
    console.log("[discord] Not configured, skipping notification");
    return false;
  }

  try {
    const res = await fetch(
      `${DISCORD_API}/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
      }
    );

    if (!res.ok) {
      console.error(
        `[discord] Failed to send message: ${res.status} ${await res.text()}`
      );
      return false;
    }

    return true;
  } catch (err) {
    console.error("[discord] Error sending message:", err);
    return false;
  }
}

export async function notifyDownloadComplete(
  artist: string,
  title: string,
  album?: string
) {
  const albumPart = album ? ` (${album})` : "";
  await sendDiscordMessage(`🎵 **Downloaded:** ${artist} - ${title}${albumPart}`);
}

export async function notifyPlaylistNewTracks(
  playlistName: string,
  count: number
) {
  await sendDiscordMessage(
    `📋 **${playlistName}:** ${count} new track${count !== 1 ? "s" : ""} found, downloading...`
  );
}

export async function notifyError(
  artist: string,
  title: string,
  error: string
) {
  await sendDiscordMessage(
    `❌ **Failed:** ${artist} - ${title}: ${error.slice(0, 200)}`
  );
}
