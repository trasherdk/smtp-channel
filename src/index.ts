/// <reference types="node" />

import net from "node:net";
import tls from "node:tls";
import stream from "node:stream";
import { EventEmitter } from "node:events";
import { LineBuffer } from "@trasherdk/line-buffer";
import { timeout } from "@trasherdk/promised-timeout";

export interface SMTPChannelConfig {
  host?: string;
  port?: number;
  timeout?: number;
  secure?: boolean;
  [key: string]: unknown;
}

export interface ConnectOptions {
  handler?: (line: string, args: { isLast: boolean; code: string | null }) => void | Promise<void>;
  timeout?: number;
}

export interface WriteOptions {
  handler?: (line: string, args: { isLast: boolean; code: string | null }) => void | Promise<void>;
  timeout?: number;
}

export interface NegotiateTLSOptions {
  timeout?: number;
  rejectUnauthorized?: boolean;
  [key: string]: unknown;
}

export interface SMTPChannelEvents {
  close: [];
  command: [line: string];
  connect: [];
  end: [];
  error: [error: Error];
  receive: [chunk: Buffer | string];
  reply: [line: string];
  send: [chunk: string];
  timeout: [];
}

type SocketType = net.Socket | tls.TLSSocket;

export class SMTPChannel extends EventEmitter<SMTPChannelEvents> {
  #config: Required<Pick<SMTPChannelConfig, "host" | "port" | "timeout">> &
    Pick<SMTPChannelConfig, "secure"> &
    Record<string, unknown>;
  #socket: SocketType | null = null;
  #receiveBuffer = new LineBuffer();
  #sendBuffer = new LineBuffer();
  #isSecure = false;

  constructor(config: SMTPChannelConfig = {}) {
    super();
    this.#config = Object.assign(
      {
        host: "localhost",
        port: 25,
        timeout: 0,
      },
      config,
    ) as never;
  }

  connect({ handler, timeout: time = 0 }: ConnectOptions = {}): Promise<string | null> {
    return timeout({
      time,
      action: this.#connectAsPromised({ handler }),
      error: new Error("Command has timed out"),
    });
  }

  close({ timeout: time = 0 }: { timeout?: number } = {}): Promise<void> {
    return timeout({
      time,
      action: this.#closeAsPromised(),
      error: new Error("Command has timed out"),
    });
  }

  write(
    data: string | Buffer | stream.Readable,
    { handler, timeout: time = 0 }: WriteOptions = {},
  ): Promise<string | null> {
    return timeout({
      time,
      action: this.#writeAsPromised(data, { handler }),
      error: new Error("Command has timed out"),
    });
  }

  negotiateTLS(config: NegotiateTLSOptions = {}): Promise<void> {
    return timeout({
      time: config.timeout ?? 0,
      action: this.#negotiateTLSAsPromised(config),
      error: new Error("Command has timed out"),
    });
  }

  isSecure(): boolean {
    return this.#isSecure;
  }

  parseReplyCode(line: string): string | null {
    return line ? line.substring(0, 3) : null;
  }

  isLastReply(line: string): boolean {
    return line ? line.charAt(3) === " " : false;
  }

  #createSocket(
    config: net.NetConnectOpts & Record<string, unknown>,
    onConnect: () => void,
  ): net.Socket | tls.TLSSocket {
    const isSecure = this.#config.secure || config.secure === true;
    const lib = isSecure ? tls : net;
    return (lib as typeof net).connect(config as net.NetConnectOpts, onConnect);
  }

  #connectAsPromised({ handler }: { handler: ConnectOptions["handler"] }): Promise<string | null> {
    return new Promise((resolve, reject) => {
      if (this.#socket) {
        return resolve(null);
      }

      const options = { ...this.#config };

      this.#socket = this.#createSocket(options, () => {
        this.#isSecure = !!options.secure;
        this.#socket!.removeAllListeners("error");
        this.#socket!.on("close", this.#onClose.bind(this));
        this.#socket!.on("data", this.#onReceive.bind(this));
        this.#socket!.on("end", this.#onEnd.bind(this));
        this.#socket!.on("error", this.#onError.bind(this));
        this.#socket!.on("timeout", this.#onTimeout.bind(this));
        this.#socket!.setEncoding("utf8");
        this.#socket!.setTimeout(this.#config.timeout);
        this.#onConnect();
      });

      this.#resolveCommand({ resolve, reject, handler });
    });
  }

  #closeAsPromised(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.#socket) {
        return resolve();
      }
      this.#socket.once("close", resolve);
      this.#socket.destroy();
      this.#socket = null;
    });
  }

  #writeAsPromised(
    data: string | Buffer | stream.Readable,
    { handler }: { handler: WriteOptions["handler"] },
  ): Promise<string | null> {
    return new Promise((resolve, reject) => {
      if (!this.#socket) {
        return reject(new Error("Socket has closed"));
      }
      this.#resolveCommand({ resolve, reject, handler });
      const channel = this.#convertToStream(data);
      channel.pipe(this.#createOnSendStream());
      channel.pipe(this.#socket, { end: false });
    });
  }

  #negotiateTLSAsPromised(config: NegotiateTLSOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = this.#socket!;
      s.removeAllListeners("close");
      s.removeAllListeners("data");
      s.removeAllListeners("end");
      s.removeAllListeners("error");
      s.removeAllListeners("timeout");

      const options = Object.assign({}, this.#config, config, {
        socket: s,
        secure: true,
      });

      this.#socket = this.#createSocket(options, () => {
        this.#isSecure = true;
        this.#socket!.removeAllListeners("error");
        this.#socket!.on("close", this.#onClose.bind(this));
        this.#socket!.on("data", this.#onReceive.bind(this));
        this.#socket!.on("end", this.#onEnd.bind(this));
        this.#socket!.on("error", this.#onError.bind(this));
        this.#socket!.on("timeout", this.#onTimeout.bind(this));
        this.#socket!.setEncoding("utf8");
        this.#socket!.setTimeout(this.#config.timeout);
        resolve();
      });
      this.#socket.on("error", reject);
    });
  }

  #resolveCommand({
    resolve,
    reject,
    handler,
  }: {
    resolve: (value: string | null) => void;
    reject: (reason: unknown) => void;
    handler?: ConnectOptions["handler"];
  }): void {
    const onClose = (): void => {
      if (this.#socket) {
        this.#socket.removeListener("error", onError);
      }
      this.#receiveBuffer.removeListener("line", onLine);
      reject(new Error("Socket has closed unexpectedly"));
    };

    const onError = (error: Error): void => {
      this.#socket!.removeListener("close", onClose);
      this.#receiveBuffer.removeListener("line", onLine);
      reject(error);
    };

    const onLine = (line: string): void => {
      const isLast = this.isLastReply(line);
      const code = this.parseReplyCode(line);
      const args = { isLast, code };

      Promise.resolve()
        .then(() => {
          if (handler) handler(line, args);
        })
        .then(() => {
          if (isLast) resolve(code);
        })
        .catch(reject);

      if (isLast) {
        this.#socket!.removeListener("close", onClose);
        this.#socket!.removeListener("error", onError);
        this.#receiveBuffer.removeListener("line", onLine);
      }
    };

    this.#socket!.once("close", onClose);
    this.#socket!.once("error", onError);
    this.#receiveBuffer.on("line", onLine);
  }

  #convertToStream(data: string | Buffer | stream.Readable): stream.Readable {
    if (typeof data === "object" && data !== null && "pipe" in data) {
      return data as stream.Readable;
    }
    const rs = new stream.Readable();
    rs.push(data);
    rs.push(null);
    return rs;
  }

  #createOnSendStream(): stream.PassThrough {
    const logger = new stream.PassThrough();
    logger.on("data", (data: Buffer) => this.#onSend(data.toString("utf8")));
    return logger;
  }

  #onClose(): void {
    this.#socket = null;
    this.emit("close");
  }

  #onCommand(line: string): void {
    this.emit("command", line);
  }

  #onConnect(): void {
    this.emit("connect");
  }

  #onEnd(): void {
    this.emit("end");
  }

  #onError(error: Error): void {
    this.emit("error", error);
  }

  #onReceive(chunk: Buffer | string): void {
    this.emit("receive", chunk);
    const lines = this.#receiveBuffer.feed(chunk);
    for (const line of lines) {
      this.#onReply(line);
    }
  }

  #onReply(line: string): void {
    this.emit("reply", line);
  }

  #onSend(chunk: string): void {
    this.emit("send", chunk);
    const lines = this.#sendBuffer.feed(chunk);
    for (const line of lines) {
      this.#onCommand(line);
    }
  }

  #onTimeout(): void {
    this.emit("timeout");
    this.write("QUIT\r\n").catch((error) => this.emit("error", error));
  }
}
