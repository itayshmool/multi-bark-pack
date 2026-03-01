export type FinalMessageBehavior = 'edit' | 'send';

export interface AdapterCapabilities {
  finalMessageBehavior: FinalMessageBehavior;
  maxMessageLength?: number;
}

export interface NormalizedMessage {
  id: string;
  text: string;
  sender: string;
  senderId: string;
  hasMedia: boolean;
  mediaType: 'image' | 'voice' | null;
  isQuotedReply: boolean;
  raw: unknown;
  adapter: Adapter;
}

export interface QuotedMessage {
  id: string;
  body: string;
}

export interface DownloadedMedia {
  filePath: string;
  mimetype: string;
}

export interface Adapter {
  name: string;
  capabilities: AdapterCapabilities;
  initialize(onMessage: (msg: NormalizedMessage) => void): Promise<void>;
  destroy(): Promise<void>;
  isReady(): boolean;
  send(text: string, replyToId?: string | null): Promise<string | null>;
  sendFile(filePath: string, caption?: string, replyToId?: string | null): Promise<string | null>;
  edit(msgId: string, text: string): Promise<boolean>;
  pin(msgId: string): Promise<void>;
  unpin(msgId: string): Promise<void>;
  deleteMsg(msgId: string): Promise<void>;
  downloadMedia(rawMsg: unknown): Promise<DownloadedMedia | null>;
  getQuotedMessage(rawMsg: unknown): Promise<QuotedMessage | null>;
  sendGoodbye(): Promise<void>;
}
