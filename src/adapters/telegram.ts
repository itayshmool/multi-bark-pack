import { errorMessage } from '../utils/error.js';
import { truncateMessage } from '../utils/text.js';
import { getTelegramCommands } from '../server/command-registry.js';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TMP_DIR } from '../config/paths.js';
import type {
  Adapter,
  NormalizedMessage,
  DownloadedMedia,
  QuotedMessage,
} from '../types/index.js';

const CHAT_ID_FILE = path.join(TMP_DIR, 'telegram-chat-id');

// Configurable via env
const TG_POLL_TIMEOUT_SECS = parseInt(
  process.env.TG_POLL_TIMEOUT_SECS || '30',
  10,
);
const TG_POLL_BACKOFF_BASE_MS = parseInt(
  process.env.TG_POLL_BACKOFF_BASE_MS || '5000',
  10,
);
const TG_POLL_BACKOFF_MAX_MS = parseInt(
  process.env.TG_POLL_BACKOFF_MAX_MS || '60000',
  10,
);
// Telegram hard limit is 4096 chars; leave a small buffer for safety
const TG_MAX_MSG_LEN = parseInt(
  process.env.TG_MAX_MSG_LEN || '4096',
  10,
);

interface TelegramAdapterConfig {
  token: string;
  chatId?: string;
}

interface TelegramApiResponse {
  ok: boolean;
  result?: any;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

interface TelegramBotInfo {
  id: number;
  username: string;
  first_name: string;
}

interface TelegramAdapter extends Adapter {
  _botInfo: TelegramBotInfo | null;
}

export function createTelegramAdapter({
  token,
  chatId,
}: TelegramAdapterConfig): TelegramAdapter {
  const BASE = `https://api.telegram.org/bot${token}`;
  // Load persisted chat ID if not provided via config
  let defaultChatId: string | null = chatId || null;
  if (!defaultChatId && existsSync(CHAT_ID_FILE)) {
    try {
      defaultChatId = readFileSync(CHAT_ID_FILE, 'utf8').trim();
      console.log(
        `Telegram loaded persisted chat ID: ${defaultChatId}`,
      );
    } catch {
      // ignore read errors
    }
  }
  let polling = false;
  let lastUpdateId = 0;
  let pollTimeout: ReturnType<typeof setTimeout> | null = null;
  let consecutivePollErrors = 0;

  async function api(
    method: string,
    body: Record<string, unknown>,
    retries = 3,
  ): Promise<any> {
    const res = await fetch(`${BASE}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as TelegramApiResponse;
    if (!data.ok) {
      // Handle rate limiting with retry
      if (
        data.error_code === 429 &&
        data.parameters?.retry_after &&
        retries > 0
      ) {
        const delay = (data.parameters.retry_after + 1) * 1000;
        console.log(
          `  \u23F3 Telegram rate limited, waiting ${data.parameters.retry_after}s...`,
        );
        await new Promise((r) => setTimeout(r, delay));
        return api(method, body, retries - 1);
      }
      throw new Error(
        `Telegram API ${method}: ${data.description || 'unknown error'}`,
      );
    }
    return data.result;
  }

  async function pollLoop(
    onMessage: (msg: NormalizedMessage) => void,
  ): Promise<void> {
    while (polling) {
      try {
        const updates = await api('getUpdates', {
          timeout: TG_POLL_TIMEOUT_SECS,
          offset: lastUpdateId + 1,
          allowed_updates: ['message'],
        });

        consecutivePollErrors = 0; // reset on success
        for (const update of updates) {
          lastUpdateId = update.update_id;
          const msg = update.message;
          if (!msg) continue;

          // Auto-detect chat ID from first message (any chat type)
          if (!defaultChatId) {
            defaultChatId = String(msg.chat.id);
            try {
              writeFileSync(CHAT_ID_FILE, defaultChatId);
            } catch {
              // ignore write errors
            }
            console.log(
              `Telegram auto-detected chat ID: ${defaultChatId} (${msg.chat.type})`,
            );
          }

          // Only process messages from the configured chat
          if (String(msg.chat.id) !== String(defaultChatId))
            continue;

          // Skip messages with no sender (channel posts, anonymous)
          if (!msg.from) continue;

          // Skip messages from the bot itself
          const botInfo = adapter._botInfo;
          if (botInfo && msg.from.id === botInfo.id) continue;

          const sender = msg.from
            ? (msg.from.first_name || '') +
              (msg.from.last_name
                ? ' ' + msg.from.last_name
                : '')
            : 'Unknown';
          const text = msg.text || msg.caption || '';

          let hasMedia = false;
          let mediaType: 'image' | 'voice' | null = null;
          if (msg.photo && msg.photo.length > 0) {
            hasMedia = true;
            mediaType = 'image';
          } else if (msg.voice || msg.audio) {
            hasMedia = true;
            mediaType = 'voice';
          }

          const normalized: NormalizedMessage = {
            id: 'tg:' + msg.message_id,
            text: text.trim(),
            sender,
            senderId: String(msg.from.id),
            hasMedia,
            mediaType,
            isQuotedReply: !!msg.reply_to_message,
            raw: msg,
            adapter,
          };

          onMessage(normalized);
        }
      } catch (e: unknown) {
        if (polling) {
          consecutivePollErrors++;
          const delay = Math.min(
            TG_POLL_BACKOFF_BASE_MS *
              Math.pow(2, consecutivePollErrors - 1),
            TG_POLL_BACKOFF_MAX_MS,
          );
          console.log(
            `  \u26A0\uFE0F Telegram poll error (attempt ${consecutivePollErrors}, retry in ${delay / 1000}s): ${errorMessage(e)}`,
          );
          await new Promise<void>((r) => {
            pollTimeout = setTimeout(r, delay);
          });
        }
      }
    }
  }

  const adapter: TelegramAdapter = {
    name: 'telegram',
    _botInfo: null,
    capabilities: { finalMessageBehavior: 'send', maxMessageLength: TG_MAX_MSG_LEN, editIntervalMs: 3000 },

    async initialize(onMessage: (msg: NormalizedMessage) => void) {
      // Validate token
      const me = await api('getMe', {});
      adapter._botInfo = me;
      console.log(
        `Telegram bot: @${me.username} (${me.first_name})`,
      );

      // Register bot commands from central registry (shows in Telegram's / autocomplete menu)
      try {
        await api('setMyCommands', { commands: getTelegramCommands() });
        console.log('  ✅ Telegram bot commands registered');
      } catch (e: unknown) {
        console.log(`  ⚠️ Could not register Telegram commands: ${errorMessage(e)}`);
      }

      if (defaultChatId) {
        console.log(
          `Telegram listening on chat: ${defaultChatId}`,
        );
        // Clean up stale pins from previous session
        try {
          await api('unpinAllChatMessages', {
            chat_id: defaultChatId,
          });
          console.log(
            '  \u{1F9F9} Cleared old Telegram pins',
          );
        } catch (e: unknown) {
          // Bot may not have pin permissions -- not fatal
          console.log(
            `  \u26A0\uFE0F Could not clear old Telegram pins: ${errorMessage(e)}`,
          );
        }
      } else {
        console.log(
          'Telegram waiting for first group message to detect chat ID...',
        );
      }

      // Start polling
      polling = true;
      pollLoop(onMessage).catch((e: unknown) => {
        console.log(
          `  \u274C Telegram poll loop crashed: ${errorMessage(e)}`,
        );
      });
    },

    async destroy() {
      polling = false;
      if (pollTimeout) clearTimeout(pollTimeout);
    },

    isReady() {
      return polling && !!defaultChatId;
    },

    async send(
      text: string,
      replyToId?: string | null,
      { markdown = true }: { markdown?: boolean } = {},
    ) {
      if (!defaultChatId) {
        console.log(
          '  \u26A0\uFE0F Telegram send skipped \u2014 chat ID not set yet',
        );
        return null;
      }
      const body: Record<string, unknown> = {
        chat_id: defaultChatId,
        text: truncateMessage(text, TG_MAX_MSG_LEN - 3),
      };
      if (markdown) body.parse_mode = 'Markdown';
      if (replyToId) {
        body.reply_to_message_id = stripPrefix(replyToId);
      }
      try {
        const result = await api('sendMessage', body);
        return 'tg:' + result.message_id;
      } catch (e: unknown) {
        // Retry without Markdown if parse fails
        if (
          markdown &&
          e instanceof Error &&
          e.message.includes("can't parse")
        ) {
          console.log(
            `  \u26A0\uFE0F Telegram Markdown parse failed in send(), retrying plain: ${e.message.substring(0, 120)}`,
          );
          delete body.parse_mode;
          const result = await api('sendMessage', body);
          return 'tg:' + result.message_id;
        }
        throw e;
      }
    },

    async sendFile(
      filePath: string,
      caption?: string,
      replyToId?: string | null,
    ) {
      if (!defaultChatId) {
        console.log(
          '  \u26A0\uFE0F Telegram sendFile skipped \u2014 chat ID not set yet',
        );
        return null;
      }
      if (
        typeof globalThis.FormData === 'undefined' ||
        typeof globalThis.Blob === 'undefined'
      ) {
        console.log(
          '  \u26A0\uFE0F Telegram sendFile requires Node 18+. FormData/Blob not available.',
        );
        return null;
      }
      try {
        const ext = path.extname(filePath).toLowerCase();
        const isImage = [
          '.jpg',
          '.jpeg',
          '.png',
          '.gif',
          '.webp',
        ].includes(ext);
        const method = isImage ? 'sendPhoto' : 'sendDocument';
        const fieldName = isImage ? 'photo' : 'document';

        const form = new FormData();
        form.append('chat_id', defaultChatId);
        form.append(
          fieldName,
          new Blob([readFileSync(filePath)]),
          path.basename(filePath),
        );
        if (caption) form.append('caption', caption.length > 1024 ? caption.substring(0, 1021) + '...' : caption);
        if (replyToId)
          form.append(
            'reply_to_message_id',
            stripPrefix(replyToId),
          );

        const res = await fetch(`${BASE}/${method}`, {
          method: 'POST',
          body: form,
        });
        const data =
          (await res.json()) as TelegramApiResponse;
        if (!data.ok)
          throw new Error(
            data.description || 'upload failed',
          );
        return 'tg:' + data.result.message_id;
      } catch (e: unknown) {
        console.log(
          `  \u26A0\uFE0F Telegram sendFile failed: ${errorMessage(e)}`,
        );
        return null;
      }
    },

    async edit(
      msgId: string,
      text: string,
      { markdown = true }: { markdown?: boolean } = {},
    ) {
      if (!defaultChatId) return false;
      const body: Record<string, unknown> = {
        chat_id: defaultChatId,
        message_id: Number(stripPrefix(msgId)),
        text: truncateMessage(text, TG_MAX_MSG_LEN - 3),
      };
      if (markdown) body.parse_mode = 'Markdown';
      try {
        await api('editMessageText', body);
        return true;
      } catch (e: unknown) {
        // Retry without Markdown if parse fails
        if (
          markdown &&
          e instanceof Error &&
          e.message.includes("can't parse")
        ) {
          console.log(
            `  \u26A0\uFE0F Telegram Markdown parse failed in edit(), retrying plain: ${(e.message).substring(0, 120)}`,
          );
          delete body.parse_mode;
          try {
            await api('editMessageText', body);
            return true;
          } catch {
            return false;
          }
        }
        // "message is not modified" is not a real error
        if (
          e instanceof Error &&
          e.message.includes('not modified')
        )
          return true;
        return false;
      }
    },

    async pin(msgId: string) {
      if (!defaultChatId) return;
      try {
        await api('pinChatMessage', {
          chat_id: defaultChatId,
          message_id: Number(stripPrefix(msgId)),
          disable_notification: true,
        });
      } catch (e: unknown) {
        console.log(
          `  \u26A0\uFE0F Could not pin Telegram message: ${errorMessage(e)}`,
        );
      }
    },

    async unpin(msgId: string) {
      if (!defaultChatId) return;
      try {
        await api('unpinChatMessage', {
          chat_id: defaultChatId,
          message_id: Number(stripPrefix(msgId)),
        });
      } catch {
        // ignore unpin errors
      }
    },

    async deleteMsg(msgId: string) {
      if (!defaultChatId) return;
      try {
        await api('deleteMessage', {
          chat_id: defaultChatId,
          message_id: Number(stripPrefix(msgId)),
        });
      } catch {
        // ignore delete errors
      }
    },

    async downloadMedia(rawMsg: any): Promise<DownloadedMedia | null> {
      try {
        let fileId: string | null = null;
        let type: string | null = null;

        if (rawMsg.photo && rawMsg.photo.length > 0) {
          // Pick largest photo
          fileId =
            rawMsg.photo[rawMsg.photo.length - 1].file_id;
          type = 'image';
        } else if (rawMsg.voice) {
          fileId = rawMsg.voice.file_id;
          type = 'voice';
        } else if (rawMsg.audio) {
          fileId = rawMsg.audio.file_id;
          type = 'voice';
        }

        if (!fileId) return null;

        const file = await api('getFile', {
          file_id: fileId,
        });
        const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const buffer = Buffer.from(await res.arrayBuffer());

        if (type === 'image') {
          const ext = file.file_path.endsWith('.png')
            ? 'png'
            : 'jpg';
          const downloadPath = path.join(
            TMP_DIR,
            `img-${Date.now()}.${ext}`,
          );
          await writeFile(downloadPath, buffer);
          return {
            filePath: downloadPath,
            mimetype: `image/${ext === 'png' ? 'png' : 'jpeg'}`,
          };
        }

        if (type === 'voice') {
          const ext =
            path.extname(file.file_path) || '.ogg';
          const downloadPath = path.join(
            TMP_DIR,
            `voice-${Date.now()}${ext}`,
          );
          await writeFile(downloadPath, buffer);
          const mimeMap: Record<string, string> = {
            '.ogg': 'audio/ogg',
            '.mp3': 'audio/mpeg',
            '.m4a': 'audio/mp4',
            '.wav': 'audio/wav',
          };
          return {
            filePath: downloadPath,
            mimetype: mimeMap[ext] || 'audio/ogg',
          };
        }

        return null;
      } catch (e: unknown) {
        console.log(
          `  \u26A0\uFE0F Could not download Telegram media: ${errorMessage(e)}`,
        );
        return null;
      }
    },

    async getQuotedMessage(
      rawMsg: any,
    ): Promise<QuotedMessage | null> {
      if (!rawMsg.reply_to_message) return null;
      const reply = rawMsg.reply_to_message;
      return {
        id: 'tg:' + reply.message_id,
        body: reply.text || reply.caption || '',
      };
    },

    async sendGoodbye() {
      if (defaultChatId) {
        try {
          await adapter.send(
            '\u{1F43A} bark-pack is offline. byebye',
          );
        } catch {
          // ignore goodbye errors
        }
      }
    },
  };

  return adapter;
}

function stripPrefix(msgId: string): string {
  const s = String(msgId);
  if (s.startsWith('tg:')) return s.slice(3);
  return s;
}
