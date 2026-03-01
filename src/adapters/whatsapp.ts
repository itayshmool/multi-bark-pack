import { errorMessage } from '../utils/error.js';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
type ClientInstance = InstanceType<typeof Client>;
import qrcode from 'qrcode-terminal';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { TMP_DIR } from '../config/paths.js';
import type {
  Adapter,
  NormalizedMessage,
  DownloadedMedia,
  QuotedMessage,
} from '../types/index.js';

// Configurable via env
const WA_PROTOCOL_TIMEOUT = parseInt(
  process.env.WA_PROTOCOL_TIMEOUT || '120000',
  10,
);
const WA_PIN_DURATION_SECS = parseInt(
  process.env.WA_PIN_DURATION_SECS || '2592000',
  10,
); // 30 days
const WA_MSG_CACHE_MAX = parseInt(
  process.env.WA_MSG_CACHE_MAX || '5000',
  10,
);
// Status message prefix check (for unpinning old status messages on startup)
const STATUS_PREFIXES = (
  process.env.STATUS_MSG_PREFIXES || '\u{1F4CB},\u{1F43E}'
).split(',');

interface WhatsAppAdapterConfig {
  groupName: string;
}

export function createWhatsAppAdapter({
  groupName,
}: WhatsAppAdapterConfig): Adapter {
  let client: ClientInstance | null = null;
  let groupChat: any = null;
  // Cache msg objects for edit/pin (WhatsApp msgs aren't reconstructible from ID)
  // Bounded to WA_MSG_CACHE_MAX entries to prevent memory leaks on long-running servers
  const msgCache = new Map<string, any>();

  const adapter: Adapter = {
    name: 'whatsapp',
    capabilities: { finalMessageBehavior: 'edit', maxMessageLength: 4096 },

    async initialize(onMessage: (msg: NormalizedMessage) => void) {
      client = new Client({
        authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
        puppeteer: {
          headless: true,
          handleSIGINT: false,
          handleSIGTERM: false,
          handleSIGHUP: false,
          protocolTimeout: WA_PROTOCOL_TIMEOUT,
        },
      });

      client.on('qr', (qr: string) => {
        console.log('Scan this QR code with your WhatsApp:');
        qrcode.generate(qr, { small: true });
      });

      client.on('authenticated', () => {
        console.log('WhatsApp authenticated');
      });

      client.on('disconnected', (reason: string) => {
        console.log('WhatsApp disconnected:', reason);
      });

      return new Promise<void>((resolve) => {
        client!.on('ready', async () => {
          console.log('WhatsApp connected');

          const chats = await client!.getChats();
          groupChat = chats.find(
            (c: any) => c.isGroup && c.name === groupName,
          );

          if (groupChat) {
            console.log(
              `WhatsApp listening on group: "${groupChat.name}"`,
            );

            // Unpin old status messages (recognise by prefix from env)
            try {
              const pinned = await groupChat.getPinnedMessages();
              for (const msg of pinned) {
                if (
                  msg.fromMe &&
                  STATUS_PREFIXES.some((p: string) =>
                    msg.body.startsWith(p),
                  )
                ) {
                  try {
                    await msg.unpin();
                  } catch {
                    // ignore unpin errors
                  }
                }
              }
            } catch (e: unknown) {
              console.log(
                `  \u26A0\uFE0F Could not clean old pins: ${errorMessage(e)}`,
              );
            }
          } else {
            console.log(
              `WhatsApp group "${groupName}" not found. Available groups:`,
            );
            chats
              .filter((c: any) => c.isGroup)
              .forEach((c: any) => console.log(`  - ${c.name}`));
            console.log(
              `\nSet WA_GROUP env var or create a group named "${groupName}"`,
            );
          }

          // Wire up message handler
          client!.on('message', async (msg: any) => {
            const chat = await msg.getChat();
            if (!chat.isGroup || chat.name !== groupName) return;
            if (msg.fromMe) return;

            const contact = await msg.getContact();
            const sender = contact.pushname || contact.number;
            const body = msg.body.trim();

            // Determine media type
            let hasMedia: boolean = msg.hasMedia;
            let mediaType: 'image' | 'voice' | null = null;
            if (hasMedia) {
              if (msg.type === 'image' || msg.type === 'sticker')
                mediaType = 'image';
              else if (msg.type === 'ptt' || msg.type === 'audio')
                mediaType = 'voice';
              else hasMedia = false; // unsupported media type
            }

            const normalized: NormalizedMessage = {
              id: 'wa:' + msg.id._serialized,
              text: body,
              sender,
              senderId:
                contact.number || contact.id?.user || sender,
              hasMedia,
              mediaType,
              isQuotedReply: msg.hasQuotedMsg,
              raw: msg,
              adapter,
            };

            onMessage(normalized);
          });

          resolve();
        });

        client!.initialize();
      });
    },

    async destroy() {
      if (client) {
        await client.destroy();
      }
    },

    isReady() {
      return !!groupChat;
    },

    async send(text: string, replyToId?: string | null) {
      if (!groupChat)
        throw new Error('WhatsApp not connected to group');
      const opts: any = {};
      if (replyToId) {
        opts.quotedMessageId = stripPrefix(replyToId);
      }
      const sent = await groupChat.sendMessage(text, opts);
      msgCache.set(sent.id._serialized, sent);
      // Evict oldest entries when cache grows too large
      if (msgCache.size > WA_MSG_CACHE_MAX) {
        const oldestKey = msgCache.keys().next().value;
        if (oldestKey !== undefined) msgCache.delete(oldestKey);
      }
      return 'wa:' + sent.id._serialized;
    },

    async sendFile(
      filePath: string,
      caption?: string,
      replyToId?: string | null,
    ) {
      if (!groupChat)
        throw new Error('WhatsApp not connected to group');
      try {
        const media = MessageMedia.fromFilePath(filePath);
        const opts: any = {};
        if (caption) opts.caption = caption;
        if (replyToId)
          opts.quotedMessageId = stripPrefix(replyToId);
        const sent = await groupChat.sendMessage(media, opts);
        msgCache.set(sent.id._serialized, sent);
        return 'wa:' + sent.id._serialized;
      } catch (e: unknown) {
        console.log(
          `  \u26A0\uFE0F WhatsApp sendFile failed: ${errorMessage(e)}`,
        );
        return null;
      }
    },

    async edit(msgId: string, text: string) {
      const rawId = stripPrefix(msgId);
      const cached = msgCache.get(rawId);
      if (!cached) return false;
      try {
        await cached.edit(text);
        return true;
      } catch {
        return false;
      }
    },

    async pin(msgId: string) {
      const rawId = stripPrefix(msgId);
      const cached = msgCache.get(rawId);
      if (cached) {
        try {
          await cached.pin(WA_PIN_DURATION_SECS);
        } catch (e: unknown) {
          console.log(
            `  \u26A0\uFE0F Could not pin message: ${errorMessage(e)}`,
          );
        }
      }
    },

    async unpin(msgId: string) {
      const rawId = stripPrefix(msgId);
      const cached = msgCache.get(rawId);
      if (cached) {
        try {
          await cached.unpin();
        } catch {
          // ignore unpin errors
        }
      }
    },

    async deleteMsg(msgId: string) {
      const rawId = stripPrefix(msgId);
      const cached = msgCache.get(rawId);
      if (cached) {
        try {
          await cached.delete(true);
        } catch {
          // ignore delete errors
        }
      }
    },

    async downloadMedia(rawMsg: any): Promise<DownloadedMedia | null> {
      try {
        const media = await rawMsg.downloadMedia();
        if (!media || !media.data) return null;

        if (
          rawMsg.type === 'image' ||
          rawMsg.type === 'sticker'
        ) {
          const ext =
            media.mimetype === 'image/png'
              ? 'png'
              : media.mimetype === 'image/webp'
                ? 'webp'
                : 'jpg';
          const downloadPath = path.join(
            TMP_DIR,
            `img-${Date.now()}.${ext}`,
          );
          writeFileSync(
            downloadPath,
            Buffer.from(media.data, 'base64'),
          );
          return { filePath: downloadPath, mimetype: media.mimetype };
        }

        if (rawMsg.type === 'ptt' || rawMsg.type === 'audio') {
          const downloadPath = path.join(
            TMP_DIR,
            `voice-${Date.now()}.ogg`,
          );
          writeFileSync(
            downloadPath,
            Buffer.from(media.data, 'base64'),
          );
          return { filePath: downloadPath, mimetype: media.mimetype };
        }

        return null;
      } catch (e: unknown) {
        console.log(
          `  \u26A0\uFE0F Could not download WhatsApp media: ${errorMessage(e)}`,
        );
        return null;
      }
    },

    async getQuotedMessage(
      rawMsg: any,
    ): Promise<QuotedMessage | null> {
      if (!rawMsg.hasQuotedMsg) return null;
      try {
        const quoted = await rawMsg.getQuotedMessage();
        return {
          id: 'wa:' + quoted.id._serialized,
          body: quoted.body || '',
        };
      } catch {
        return null;
      }
    },

    async sendGoodbye() {
      if (groupChat) {
        try {
          await groupChat.sendMessage(
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
  if (msgId.startsWith('wa:')) return msgId.slice(3);
  return msgId;
}
