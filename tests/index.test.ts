/// <reference types="node" />

import "dotenv/config";
import fs from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import stream from "node:stream";
import MailDev from "maildev";
import { SMTPServer } from "smtp-server";
import { SMTPChannel } from "../src/index.js";

const TLS_CERT = process.env.SMTP_CHANNEL_TLS_CERT;
const TLS_KEY = process.env.SMTP_CHANNEL_TLS_KEY;
const hasTlsCerts =
  TLS_CERT &&
  TLS_KEY &&
  fs.existsSync(TLS_CERT) &&
  fs.existsSync(TLS_KEY);

const server = new MailDev({
  autoRelayRules: [{ allow: "*" }],
} as Record<string, unknown>);

describe("SMTPChannel", () => {
  beforeAll(
    () =>
      new Promise<void>((resolve, reject) => {
        server.listen((err) => (err ? reject(err) : resolve()));
      }),
  );

  afterAll(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  );

  it("should connect to and disconnect from the server", async () => {
    const c = new SMTPChannel({ port: 1025 });

    const connectReplies: string[] = [];
    const connectCode = await c.connect({
      handler: (line) => {
        connectReplies.push(line);
      },
    });

    expect(connectReplies.length).toBe(1);
    expect(connectCode).toBe("220");

    await c.close();
  });

  it("`write` should send data to the server", async () => {
    const c = new SMTPChannel({ port: 1025 });
    await c.connect();

    const writeReplies: string[] = [];
    const writeCode = await c.write("EHLO domain.com\r\n", {
      handler: (line) => {
        writeReplies.push(line);
      },
    });

    expect(writeReplies.length).toBeGreaterThanOrEqual(1);
    expect(writeCode).toBe("250");

    await c.close();
  });

  it("`write` should stream data to the server", async () => {
    const c = new SMTPChannel({ port: 1025 });
    await c.connect();

    const command = "EHLO domain.com\r\n".split("");
    const dataStream = new stream.Readable({
      read () {
        const chunk = command.shift();
        this.push(chunk);
      },
    });
    const writeReplies: string[] = [];
    const writeCode = await c.write(dataStream, {
      handler: (line) => {
        writeReplies.push(line);
      },
    });

    expect(writeReplies.length).toBeGreaterThanOrEqual(1);
    expect(writeCode).toBe("250");

    await c.close();
  });

  it.skipIf(!hasTlsCerts)(
    "should upgrade the existing socket to TLS",
    async () => {
      const tlsServer = new SMTPServer({
        secure: false,
        cert: fs.readFileSync(TLS_CERT!),
        key: fs.readFileSync(TLS_KEY!),
      });
      await new Promise<void>((resolve) => {
        tlsServer.listen(1587, "localhost", resolve);
      });

      try {
        const c = new SMTPChannel({ port: 1587, host: "localhost" });
        await c.connect();
        await c.write("EHLO domain.com\r\n");
        await c.write("STARTTLS\r\n");
        await c.negotiateTLS({
          rejectUnauthorized: false,
        });

        const writeReplies: string[] = [];
        const writeCode = await c.write("EHLO domain.com\r\n", {
          handler: (line) => {
            writeReplies.push(line);
          },
        });

        expect(writeReplies.length).toBeGreaterThanOrEqual(1);
        expect(writeCode).toBe("250");
        expect(writeReplies.filter((r) => r.substring(4) === "STARTTLS").length).toBe(0);

        await c.close();
      } finally {
        await new Promise<void>((resolve) => {
          tlsServer.close(() => resolve());
        });
      }
    },
  );
});
