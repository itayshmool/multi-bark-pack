import { errorMessage } from '../utils/error.js';
import { truncateMessage } from '../utils/text.js';
import { WebClient } from '@slack/web-api';
import { SocketModeClient } from '@slack/socket-mode';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TMP_DIR } from '../config/paths.js';
import type {
  Adapter,
  NormalizedMessage,
  DownloadedMedia,
  QuotedMessage,
} from '../types/index.js';

// Slack hard limit is 40 000 chars but practical chat limit is 4000
const SLACK_MAX_MSG_LEN = parseInt(
  process.env.SLACK_MAX_MSG_LEN || '4000',
  10,
);
// Status message prefix check (for unpinning old status messages on startup)
const STATUS_PREFIXES = (
  process.env.STATUS_MSG_PREFIXES || '\u{1F4CB},\u{1F43E}'
).split(',');

interface SlackAdapterConfig {
  botToken: string;
  appToken: string;
  owners: Set<string> | 'DANGER-ALL' | null;
}

export function createSlackAdapter({
  botToken,
  appToken,
  owners,
}: SlackAdapterConfig): Adapter {
  let web: WebClient | null = null;
  let socket: SocketModeClient | null = null;
  let socketReady = false;
  let botUserId: string | null = null;
  let dmChannelId: string | null = null; // DM channel with owner for status + fallback sends
  let botMentionRe: RegExp | null = null;

  // User name cache to avoid repeated API calls
  const userNameCache = new Map<string, string>();
  async function getUserName(userId: string): Promise<string> {
    if (userNameCache.has(userId))
      return userNameCache.get(userId)!;
    try {
      const info = await web!.users.info({ user: userId });
      const user = (info.user as any);
      const name =
        user.profile.display_name ||
        user.profile.real_name ||
        user.name;
      userNameCache.set(userId, name);
      return name;
    } catch {
      return 'Unknown';
    }
  }

  const adapter: Adapter = {
    name: 'slack',
    capabilities: { finalMessageBehavior: 'edit', maxMessageLength: SLACK_MAX_MSG_LEN },

    async initialize(onMessage: (msg: NormalizedMessage) => void) {
      web = new WebClient(botToken);
      socket = new SocketModeClient({ appToken });

      // Validate credentials and get bot user ID
      const authResult = await web.auth.test();
      botUserId = authResult.user_id as string;
      botMentionRe = new RegExp(`<@${botUserId}>`, 'g');
      console.log(
        `Slack bot: @${authResult.user} (${botUserId})`,
      );

      // Open DM channel with first owner for status pin + startup messages
      // DANGER-ALL has no specific owner, so status pins are disabled in that mode
      const firstOwner =
        owners instanceof Set
          ? owners.values().next().value
          : null;
      if (!firstOwner && owners === 'DANGER-ALL') {
        console.log(
          `  \u26A0\uFE0F Slack: DANGER-ALL mode \u2014 no owner DM channel, status pins disabled`,
        );
      }
      if (firstOwner) {
        try {
          const dm = await web.conversations.open({
            users: firstOwner,
          });
          dmChannelId = (dm.channel as any).id;
          console.log(
            `Slack DM channel with owner: ${dmChannelId}`,
          );

          // Unpin old status messages from previous runs
          try {
            const pins = await web.pins.list({
              channel: dmChannelId!,
            });
            for (const item of (pins as any).items || []) {
              const msg = item.message;
              if (
                msg &&
                msg.user === botUserId &&
                STATUS_PREFIXES.some((p: string) =>
                  (msg.text ?? '').startsWith(p),
                )
              ) {
                try {
                  await web!.pins.remove({
                    channel: dmChannelId!,
                    timestamp: msg.ts,
                  });
                } catch {
                  // ignore unpin errors
                }
              }
            }
          } catch {
            // ignore pin list errors
          }
        } catch (e: unknown) {
          console.log(
            `  \u26A0\uFE0F Could not open Slack DM with owner: ${errorMessage(e)}`,
          );
        }
      }

      console.log(
        `Slack listening for @mentions in all channels`,
      );

      // Listen for 'message' events directly (emitted by Socket Mode for events_api envelopes)
      // Note: 'slack_event' does NOT include the `event` field -- only 'message' does
      socket.on(
        'message',
        async ({
          event,
          ack,
        }: {
          event: any;
          body: any;
          ack: () => Promise<void>;
        }) => {
          await ack();

          if (!event) return;
          if (event.user === botUserId) return;
          if (event.subtype) return;
          if (event.bot_id) return;

          const text = (event.text || '').trim();

          // Slack encodes mentions as <@U12345>
          const botMention = `<@${botUserId}>`;
          const isMention = text.includes(botMention);
          const isThreadReply =
            !!event.thread_ts &&
            event.thread_ts !== event.ts;
          // channel_type is 'im' for DMs -- but Socket Mode may deliver it
          // via event.channel_type OR we can check if channel starts with 'D'
          const isDM =
            event.channel_type === 'im' ||
            (event.channel &&
              event.channel.startsWith('D'));

          console.log(
            `  [slack] msg from ${event.user} in ${event.channel} (type=${event.channel_type || '?'}, isDM=${isDM}, mention=${isMention}, thread=${isThreadReply}): ${text.substring(0, 80)}`,
          );

          // Respond to: DMs, direct @mentions, or thread replies
          if (!isDM && !isMention && !isThreadReply) return;

          const cleanText = text
            .replace(botMentionRe!, '', )
            .trim();

          const sender = await getUserName(event.user);

          // Determine media type
          let hasMedia = false;
          let mediaType: 'image' | 'voice' | null = null;
          if (event.files && event.files.length > 0) {
            const file = event.files[0];
            if (
              file.mimetype &&
              file.mimetype.startsWith('image/')
            ) {
              hasMedia = true;
              mediaType = 'image';
            } else if (
              file.mimetype &&
              file.mimetype.startsWith('audio/')
            ) {
              hasMedia = true;
              mediaType = 'voice';
            }
          }

          const normalized: NormalizedMessage = {
            id: packId(event.channel, event.ts),
            text: cleanText,
            sender,
            senderId: event.user,
            hasMedia,
            mediaType,
            isQuotedReply: isThreadReply,
            raw: event,
            adapter,
          };

          onMessage(normalized);
        },
      );

      await socket.start();
      socketReady = true;
      console.log('Slack Socket Mode connected');
    },

    async destroy() {
      socketReady = false;
      if (socket) {
        await socket.disconnect();
      }
    },

    isReady() {
      return !!web && socketReady;
    },

    async send(text: string, replyToId?: string | null) {
      const { channel, ts } = replyToId
        ? unpackId(replyToId)
        : { channel: null, ts: null };
      const targetChannel = channel || dmChannelId;
      if (!targetChannel) {
        console.log(
          '  \u26A0\uFE0F Slack send: no channel context and no DM fallback, skipping',
        );
        return null;
      }
      try {
        const opts: Record<string, unknown> = {
          channel: targetChannel,
          text: truncateMessage(text, SLACK_MAX_MSG_LEN - 3),
        };
        if (ts) {
          opts.thread_ts = ts;
        }
        const result = await web!.chat.postMessage(
          opts as any,
        );
        return packId(targetChannel, result.ts as string);
      } catch (e: unknown) {
        console.log(`  ⚠️ Slack send failed: ${errorMessage(e)}`);
        return null;
      }
    },

    async sendFile(
      filePath: string,
      caption?: string,
      replyToId?: string | null,
    ) {
      const { channel, ts } = replyToId
        ? unpackId(replyToId)
        : { channel: null, ts: null };
      const targetChannel = channel || dmChannelId;
      if (!targetChannel) return null;
      try {
        const uploadArgs: Record<string, unknown> = {
          channel_id: targetChannel,
          file: readFileSync(filePath),
          filename: path.basename(filePath),
        };
        if (caption) uploadArgs.initial_comment = caption;
        if (ts) uploadArgs.thread_ts = ts;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await web!.filesUploadV2(uploadArgs as any);
        // filesUploadV2 returns file info, not a message ts
        return null;
      } catch (e: unknown) {
        console.log(
          `  \u26A0\uFE0F Slack sendFile failed: ${errorMessage(e)}`,
        );
        return null;
      }
    },

    async edit(msgId: string, text: string) {
      const { channel, ts } = unpackId(msgId);
      if (!channel || !ts) return false;
      try {
        await web!.chat.update({
          channel,
          ts,
          text: truncateMessage(text, SLACK_MAX_MSG_LEN - 3),
        });
        return true;
      } catch (e: unknown) {
        if (
          (e as any).data?.error === 'message_not_found'
        )
          return false;
        return false;
      }
    },

    async pin(msgId: string) {
      const { channel, ts } = unpackId(msgId);
      if (!channel || !ts) return;
      try {
        await web!.pins.add({
          channel,
          timestamp: ts,
        });
      } catch (e: unknown) {
        if (
          (e as any).data?.error !== 'already_pinned'
        ) {
          console.log(
            `  \u26A0\uFE0F Could not pin Slack message: ${errorMessage(e)}`,
          );
        }
      }
    },

    async unpin(msgId: string) {
      const { channel, ts } = unpackId(msgId);
      if (!channel || !ts) return;
      try {
        await web!.pins.remove({
          channel,
          timestamp: ts,
        });
      } catch {
        // ignore unpin errors
      }
    },

    async deleteMsg(msgId: string) {
      const { channel, ts } = unpackId(msgId);
      if (!channel || !ts) return;
      try {
        await web!.chat.delete({ channel, ts });
      } catch {
        // ignore delete errors
      }
    },

    async downloadMedia(rawMsg: any): Promise<DownloadedMedia | null> {
      try {
        if (!rawMsg.files || rawMsg.files.length === 0)
          return null;
        const file = rawMsg.files[0];

        const url =
          file.url_private_download || file.url_private;
        if (!url) return null;

        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${botToken}`,
          },
        });
        if (!res.ok) return null;
        const buffer = Buffer.from(
          await res.arrayBuffer(),
        );

        if (
          file.mimetype &&
          file.mimetype.startsWith('image/')
        ) {
          const ext =
            file.mimetype === 'image/png'
              ? 'png'
              : file.mimetype === 'image/webp'
                ? 'webp'
                : 'jpg';
          const downloadPath = path.join(
            TMP_DIR,
            `img-${Date.now()}.${ext}`,
          );
          await writeFile(downloadPath, buffer);
          return {
            filePath: downloadPath,
            mimetype: file.mimetype,
          };
        }

        if (
          file.mimetype &&
          file.mimetype.startsWith('audio/')
        ) {
          const ext = file.filetype || 'webm';
          const downloadPath = path.join(
            TMP_DIR,
            `voice-${Date.now()}.${ext}`,
          );
          await writeFile(downloadPath, buffer);
          return {
            filePath: downloadPath,
            mimetype: file.mimetype,
          };
        }

        return null;
      } catch (e: unknown) {
        console.log(
          `  \u26A0\uFE0F Could not download Slack media: ${errorMessage(e)}`,
        );
        return null;
      }
    },

    async getQuotedMessage(
      rawMsg: any,
    ): Promise<QuotedMessage | null> {
      if (
        !rawMsg.thread_ts ||
        rawMsg.thread_ts === rawMsg.ts
      )
        return null;

      try {
        const result = await web!.conversations.replies({
          channel: rawMsg.channel,
          ts: rawMsg.thread_ts,
          limit: 1,
          inclusive: true,
        });
        const parent = (result.messages as any)?.[0];
        if (!parent) return null;
        return {
          id: packId(rawMsg.channel, parent.ts),
          body: parent.text || '',
        };
      } catch {
        return null;
      }
    },

    async sendGoodbye() {
      if (dmChannelId && web) {
        try {
          await web.chat.postMessage({
            channel: dmChannelId,
            text: '\u{1F43A} bark-pack is offline. byebye',
          });
        } catch {
          // ignore goodbye errors
        }
      }
    },
  };

  return adapter;
}

// Encode channel + ts into a single prefixed ID: slack:C123:1234567890.123456
function packId(channel: string, ts: string): string {
  return `slack:${channel}:${ts}`;
}

// Decode: 'slack:C123:1234567890.123456' -> { channel: 'C123', ts: '1234567890.123456' }
function unpackId(msgId: string): {
  channel: string | null;
  ts: string | null;
} {
  const s = String(msgId);
  const parts = s.replace(/^slack:/, '').split(':');
  if (parts.length >= 2) {
    return {
      channel: parts[0],
      ts: parts.slice(1).join(':'),
    };
  }
  return { channel: null, ts: null };
}
