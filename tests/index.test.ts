/// <reference types="node" />

import "dotenv/config";
import fs from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import stream from "node:stream";
import { SMTPServer } from "smtp-server";
import { SMTPChannel } from "../src/index.js";

/** Optional: override smtp-server’s bundled localhost cert for the STARTTLS test. */
const TLS_CERT = process.env.SMTP_TLS_CERT;
const TLS_KEY = process.env.SMTP_TLS_KEY;
const hasTlsCerts =
  TLS_CERT &&
  TLS_KEY &&
  fs.existsSync(TLS_CERT) &&
  fs.existsSync(TLS_KEY);

const server = new SMTPServer({
  secure: false,
  authOptional: true,
  ...(hasTlsCerts
    ? {
        key: fs.readFileSync(TLS_KEY!),
        cert: fs.readFileSync(TLS_CERT!),
      }
    : {}),
});

/** `0` = ephemeral port when *listening* only. Clients must use the assigned port below. */
const LISTEN_PORT_EPHEMERAL = 0;
let serverPort = 0;

describe("SMTPChannel", () => {
  beforeAll(
    () =>
      new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen({ port: LISTEN_PORT_EPHEMERAL, host: "127.0.0.1" }, () => {
          server.removeListener("error", reject);
          const addr = server.server.address();
          if (addr && typeof addr !== "string") {
            serverPort = addr.port;
          }
          if (!serverPort) {
            reject(new Error("could not read SMTP test server port"));
            return;
          }
          resolve();
        });
      }),
  );

  afterAll(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  );

  it("should connect to and disconnect from the server", async () => {
    const c = new SMTPChannel({ port: serverPort, host: "127.0.0.1" });

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
    const c = new SMTPChannel({ port: serverPort, host: "127.0.0.1" });
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
    const c = new SMTPChannel({ port: serverPort, host: "127.0.0.1" });
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

  it("should upgrade the existing socket to TLS", async () => {
    const c = new SMTPChannel({ port: serverPort, host: "127.0.0.1" });
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
  });
});
