/// <reference types="node" />

/**
 * Integration send — `pnpm test:live` + `.env`; excluded from `pnpm test`.
 * Relay: MAIL_HOST, MAIL_FROM, MAIL_TO. Direct MX: MAIL_FROM + MAIL_TO_MX (any external inbox; MX from recipient domain).
 * TLS: `servername` defaults to connected host (MAIL_TLS_SERVERNAME). SMTP_TLS_CA is merged with default roots so relay + public MX both verify.
 * Verify failures: MAIL_TLS_INSECURE=1 (tests only), NODE_EXTRA_CA_CERTS, or OS CA bundle.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import fs from "node:fs";
import tls from "node:tls";
import { resolveMx } from "node:dns/promises";
import dotenv from "dotenv";
import { describe, it, expect } from "vitest";
import { SMTPChannel } from "../src/index.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(packageRoot, ".env") });

const mailFrom = process.env.MAIL_FROM?.trim();
const mailTo = process.env.MAIL_TO?.trim();
const mailToMx = process.env.MAIL_TO_MX?.trim();
const mailHost = process.env.MAIL_HOST?.trim();

const relayPort = process.env.MAIL_PORT ? Number(process.env.MAIL_PORT) : 587;
const implicitTlsRelay =
  relayPort === 465 ||
  process.env.MAIL_SECURE === "1" ||
  process.env.MAIL_SECURE === "true";

const MX_PORT = 25;

function domainFromAddress(addr: string): string | null {
  const i = addr.lastIndexOf("@");
  if (i < 0 || i >= addr.length - 1) return null;
  const d = addr.slice(i + 1).trim();
  return d.length ? d : null;
}

function clientEhloHostname(): string {
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

const mailEhloHost = clientEhloHostname();

function messageBody(subject: string, to: string): string {
  const date = new Date().toUTCString();
  const headers = [
    `From: <${mailFrom}>`,
    `To: <${to}>`,
    `Date: ${date}`,
    `Subject: ${subject}`,
  ].join("\r\n");
  return `${headers}\r\n\r\nSent at ${new Date().toISOString()}\r\n`;
}

const tlsInsecure =
  process.env.MAIL_TLS_INSECURE === "1" ||
  process.env.MAIL_TLS_INSECURE === "true";
const rejectUnauthorized = tlsInsecure ? false : undefined;

const tlsCaPath =
  process.env.SMTP_TLS_CA?.trim() || process.env.SMTP_TLS_CERT;
const tlsCaExtraPem =
  tlsCaPath && fs.existsSync(tlsCaPath)
    ? fs.readFileSync(tlsCaPath, "utf8")
    : undefined;

const tlsCa =
  tlsCaExtraPem !== undefined
    ? [...tls.rootCertificates, tlsCaExtraPem]
    : undefined;

const mailTlsServername = process.env.MAIL_TLS_SERVERNAME?.trim();

const tlsBaseOpts = {
  ...(tlsCa !== undefined ? { ca: tlsCa } : {}),
  ...(rejectUnauthorized !== undefined ? { rejectUnauthorized } : {}),
};

function tlsOptsForHost(host: string) {
  return {
    ...tlsBaseOpts,
    servername: mailTlsServername ?? host,
  };
}

const hasRelay = Boolean(mailHost && mailFrom && mailTo);
const hasMx = Boolean(mailFrom && mailToMx);

const hasAnyLive = hasRelay || hasMx;

async function primaryMxHost(to: string): Promise<string> {
  const domain = domainFromAddress(to);
  if (!domain) {
    throw new Error("invalid recipient address");
  }
  const records = await resolveMx(domain);
  if (!records.length) {
    throw new Error(`no MX records for ${domain}`);
  }
  records.sort((a, b) => a.priority - b.priority);
  return records[0].exchange.replace(/\.$/, "");
}

async function ehloLines(
  c: SMTPChannel,
  t: number,
): Promise<string[]> {
  const lines: string[] = [];
  const code = await c.write(`EHLO ${mailEhloHost}\r\n`, {
    timeout: t,
    handler: (line) => {
      lines.push(line);
    },
  });
  expect(code?.charAt(0)).toBe("2");
  return lines;
}

function linesAdvertiseStartTls(lines: string[]): boolean {
  return lines.some((l) => /\bSTARTTLS\b/i.test(l));
}

async function negotiateStartTlsIfNeeded(
  c: SMTPChannel,
  t: number,
  alreadyImplicitTls: boolean,
  tlsHost: string,
): Promise<void> {
  const lines = await ehloLines(c, t);
  if (!alreadyImplicitTls && linesAdvertiseStartTls(lines)) {
    let code = await c.write("STARTTLS\r\n", { timeout: t });
    expect(code?.charAt(0)).toBe("2");
    await c.negotiateTLS({ timeout: t, ...tlsOptsForHost(tlsHost) });
    await ehloLines(c, t);
  }
}

describe.skipIf(!hasAnyLive)("live send", () => {
  it.skipIf(!hasRelay)(`relay via MAIL_HOST (${mailHost ?? "—"})`, async () => {
    const c = new SMTPChannel({
      host: mailHost!,
      port: relayPort,
      secure: implicitTlsRelay,
      timeout: 60_000,
      ...tlsOptsForHost(mailHost!),
    });

    const t = 60_000;
    const dataT = 120_000;

    try {
      await c.connect({ timeout: t });
      await negotiateStartTlsIfNeeded(c, t, implicitTlsRelay, mailHost!);

      let code = await c.write(`MAIL FROM:<${mailFrom}>\r\n`, { timeout: t });
      expect(code?.charAt(0)).toBe("2");

      code = await c.write(`RCPT TO:<${mailTo}>\r\n`, { timeout: t });
      expect(code?.charAt(0)).toBe("2");

      code = await c.write("DATA\r\n", { timeout: t });
      expect(code?.charAt(0)).toBe("3");

      code = await c.write(`${messageBody("live send (relay)", mailTo!)}.\r\n`, {
        timeout: dataT,
      });
      expect(code?.charAt(0)).toBe("2");

      code = await c.write("QUIT\r\n", { timeout: t });
      expect(code?.charAt(0)).toBe("2");
    } finally {
      await c.close({ timeout: t }).catch(() => {});
    }
  });

  it.skipIf(!hasMx)("direct MX (MAIL_TO_MX)", async () => {
      const mxHost = await primaryMxHost(mailToMx!);
      console.info(`[smtp-channel tests] MX ${mxHost}:${MX_PORT} → ${mailToMx}`);

      const c = new SMTPChannel({
        host: mxHost,
        port: MX_PORT,
        secure: false,
        timeout: 60_000,
        ...tlsOptsForHost(mxHost),
      });

      const t = 60_000;
      const dataT = 120_000;

      try {
        await c.connect({ timeout: t });
        await negotiateStartTlsIfNeeded(c, t, false, mxHost);

        let code = await c.write(`MAIL FROM:<${mailFrom}>\r\n`, { timeout: t });
        expect(code?.charAt(0)).toBe("2");

        code = await c.write(`RCPT TO:<${mailToMx}>\r\n`, { timeout: t });
        expect(code?.charAt(0)).toBe("2");

        code = await c.write("DATA\r\n", { timeout: t });
        expect(code?.charAt(0)).toBe("3");

        code = await c.write(
          `${messageBody("live send (direct MX)", mailToMx!)}.\r\n`,
          {
            timeout: dataT,
          },
        );
        expect(code?.charAt(0)).toBe("2");

        code = await c.write("QUIT\r\n", { timeout: t });
        expect(code?.charAt(0)).toBe("2");
      } finally {
        await c.close({ timeout: t }).catch(() => {});
      }
  });
});
