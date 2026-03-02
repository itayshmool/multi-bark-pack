declare module 'whatsapp-web.js' {
  export class Client {
    constructor(options?: any);
    on(event: string, callback: (...args: any[]) => void): this;
    initialize(): Promise<void>;
    destroy(): Promise<void>;
    sendMessage(
      chatId: string,
      content: string | MessageMedia,
      options?: any,
    ): Promise<any>;
    getChats(): Promise<any[]>;
  }
  export class LocalAuth {
    constructor(options?: any);
  }
  export class MessageMedia {
    static fromFilePath(filePath: string): MessageMedia;
    mimetype: string;
    data: string;
    filename: string | null;
  }
  export class Buttons {
    constructor(
      body: string,
      buttons: any[],
      title?: string,
      footer?: string,
    );
  }
}

declare module 'qrcode-terminal' {
  export function generate(
    text: string,
    options?: { small?: boolean },
  ): void;
}
