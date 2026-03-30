/// <reference types="node" />

import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import fs from "node:fs";
import dotenv from "dotenv";
import { describe, it, expect } from "vitest";
import { SMTPChannel } from "../src/index.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(packageRoot, ".env") });

const mailHost = process.env.MAIL_HOST?.trim();
const mailFrom = process.env.MAIL_FROM?.trim();
const mailTo = process.env.MAIL_TO?.trim();
const mailPort = process.env.MAIL_PORT ? Number(process.env.MAIL_PORT) : 25;

function domainFromAddress(addr: string): string | null {
  const i = addr.lastIndexOf("@");
  if (i < 0 || i >= addr.length - 1) return null;
  const d = addr.slice(i + 1).trim();
  return d.length ? d : null;
}

/**
 * EHLO names the *client*, not MAIL_HOST. Default is the domain of MAIL_FROM so SPF
 * checks (TXT at that zone) can match HELO; override with MAIL_EHLO_HOST when needed.
 */
function clientEhloHostname(): string {
  const explicit = process.env.MAIL_EHLO_HOST?.trim();
  if (explicit) return explicit;
  if (mailFrom) {
    const d = domainFromAddress(mailFrom);
    if (d) return d;
  }
  let h = os.hostname() ?? "";
  if (h.indexOf(".") < 0) {
    h = "[127.0.0.1]";
  } else if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) {
    h = `[${h}]`;
  }
  return h || "localhost";
}

function liveTestMessageBody(): string {
  const date = new Date().toUTCString();
  const headers = [
    `From: <${mailFrom}>`,
    `To: <${mailTo}>`,
    `Date: ${date}`,
    `Subject: smtp-channel live test`,
  ].join("\r\n");
  return `${headers}\r\n\r\nSent at ${new Date().toISOString()}\r\n`;
}

const mailEhloHost = clientEhloHostname();
const startTls =
  process.env.MAIL_STARTTLS === "1" || process.env.MAIL_STARTTLS === "true";
const implicitTls =
  process.env.MAIL_SECURE === "1" || process.env.MAIL_SECURE === "true";
const tlsInsecure =
  process.env.MAIL_TLS_INSECURE === "1" ||
  process.env.MAIL_TLS_INSECURE === "true";
const rejectUnauthorized = tlsInsecure ? false : undefined;

/** Issuer / chain PEM for verify (prefer over SMTP_TLS_CERT so .env can keep SMTP_TLS_CERT for local SMTPServer test). */
const tlsCaPath =
  process.env.SMTP_TLS_CA?.trim() || process.env.SMTP_TLS_CERT;
const tlsCa =
  tlsCaPath && fs.existsSync(tlsCaPath)
    ? fs.readFileSync(tlsCaPath)
    : undefined;

const mailTlsServername = process.env.MAIL_TLS_SERVERNAME?.trim();

const tlsOpts = {
  ...(tlsCa !== undefined ? { ca: tlsCa } : {}),
  ...(rejectUnauthorized !== undefined ? { rejectUnauthorized } : {}),
  ...(mailTlsServername ? { servername: mailTlsServername } : {}),
};

const hasLiveConfig = Boolean(mailHost && mailFrom && mailTo);

describe.skipIf(!hasLiveConfig)("live mail server (MAIL_HOST, MAIL_FROM, MAIL_TO)", () => {
  it(`sends a minimal message via SMTPChannel to ${mailHost}`, async () => {
    const c = new SMTPChannel({
      host: mailHost!,
      port: mailPort,
      secure: implicitTls,
      timeout: 60_000,
      ...tlsOpts,
    });

    const t = 60_000;
    const dataT = 120_000;

    try {
      await c.connect({ timeout: t });

      let code = await c.write(`EHLO ${mailEhloHost}\r\n`, { timeout: t });
      expect(code?.charAt(0)).toBe("2");

      if (startTls) {
        code = await c.write("STARTTLS\r\n", { timeout: t });
        expect(code?.charAt(0)).toBe("2");
        await c.negotiateTLS({ timeout: t, ...tlsOpts });
        code = await c.write(`EHLO ${mailEhloHost}\r\n`, { timeout: t });
        expect(code?.charAt(0)).toBe("2");
      }

      code = await c.write(`MAIL FROM:<${mailFrom}>\r\n`, { timeout: t });
      expect(code?.charAt(0)).toBe("2");

      code = await c.write(`RCPT TO:<${mailTo}>\r\n`, { timeout: t });
      expect(code?.charAt(0)).toBe("2");

      code = await c.write("DATA\r\n", { timeout: t });
      expect(code?.charAt(0)).toBe("3");

      const body = liveTestMessageBody();
      code = await c.write(`${body}.\r\n`, { timeout: dataT });
      expect(code?.charAt(0)).toBe("2");

      code = await c.write("QUIT\r\n", { timeout: t });
      expect(code?.charAt(0)).toBe("2");
    } finally {
      await c.close({ timeout: t }).catch(() => {});
    }
  });
});
