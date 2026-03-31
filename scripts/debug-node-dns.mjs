#!/usr/bin/env node
/**
 * Node resolves DNS via c-ares + /etc/resolv.conf, not the same path as `host` / `nslookup`.
 * If those tools work but `resolveMx` fails, compare dns.getServers() to your nameserver lines.
 *
 * Usage: node scripts/debug-node-dns.mjs [domain ...]
 * Default domains: gmail.com fumlersoft.dk
 */
import dns from "node:dns";
import { resolveMx } from "node:dns/promises";

const domains =
  process.argv.length > 2
    ? process.argv.slice(2)
    : ["gmail.com", "fumlersoft.dk"];

console.log("dns.getServers():", dns.getServers());

let failed = false;
for (const domain of domains) {
  try {
    console.log(domain, await resolveMx(domain));
  } catch (err) {
    failed = true;
    console.error(domain, err instanceof Error ? err.message : err);
  }
}
process.exit(failed ? 1 : 0);
