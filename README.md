# @trasherdk/smtp-channel

> Low level SMTP communication layer.

This is a maintained fork of [smtp-channel](https://github.com/xpepermint/smtp-channel) by Kristijan Sedlak, which is no longer actively maintained. This fork has been modernized with TypeScript strict mode, ESM-only output, and current tooling.

## Related Projects

- [smtp-client](https://github.com/trasherdk/smtp-client): Simple, promisified, protocol-based SMTP client.

## Changes from the original

- Rewritten as strict TypeScript
- ESM-only (no CommonJS)
- Vitest instead of AVA
- Node.js >= 18

## Install

```
pnpm add @trasherdk/smtp-channel
```

## Example

```ts
import { SMTPChannel } from "@trasherdk/smtp-channel";

const smtp = new SMTPChannel({
  host: "mx.domain.com",
  port: 25,
});

await smtp.connect({ handler: console.log, timeout: 3000 });
await smtp.write("EHLO mx.me.com\r\n", { handler: console.log });
await smtp.write("QUIT\r\n", { handler: console.log });
await smtp.close();
```

## API

**SMTPChannel(config)**

> The core SMTP class. Passes options to [net.connect](https://nodejs.org/api/net.html#net_net_connect_options_connectlistener) or [tls.connect](https://nodejs.org/api/tls.html#tls_tls_connect_options_callback).

| Option | Type | Required | Default | Description
|--------|------|----------|---------|------------
| secure | `boolean` | No | `false` | Connect using TLS.
| timeout | `number` | No | `0` | Milliseconds before auto-close (`0` disables).

**smtp.connect({ handler, timeout }): Promise\<string | null\>**

> Connects to the SMTP server and starts socket I/O.

| Option | Type | Required | Default | Description
|--------|------|----------|---------|------------
| handler | `(line, args) => void \| Promise<void>` | No | - | Handle SMTP server replies.
| timeout | `number` | No | `0` | Milliseconds before reject (`0` disables).

**smtp.close({ timeout }): Promise\<void\>**

> Destroys the socket.

**smtp.write(data, { handler, timeout }): Promise\<string | null\>**

> Sends data on the socket. `data` can be `string`, `Buffer`, or `stream.Readable`.

**smtp.negotiateTLS(config): Promise\<void\>**

> Upgrades the connection to TLS after `STARTTLS`.

**smtp.isSecure(): boolean**

> Returns `true` if connected over TLS.

**smtp.parseReplyCode(line): string | null**

> Returns the reply code from a server reply line.

**smtp.isLastReply(line): boolean**

> Returns `true` if the line is the last reply in a multi-line response.

**Events:** `close`, `command`, `connect`, `end`, `error`, `receive`, `reply`, `send`, `timeout`

See [PUBLISH.md](PUBLISH.md) for release and publish instructions.

## License (MIT)

```
Copyright (c) 2016 Kristijan Sedlak <xpepermint@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
