/**
 * Resilient HTTP GET.
 *
 * Node's built-in fetch (undici) cannot reach some upstreams that curl and
 * Node's own https module reach without trouble. NASA FIRMS is one: undici
 * races the host's IPv4 and IPv6 addresses and gives up with
 * UND_ERR_CONNECT_TIMEOUT, while a plain https request over IPv4 returns in
 * about two seconds.
 *
 * Rather than special-casing one hostname, this helper tries fetch first and
 * falls back to node:https pinned to IPv4 when the failure looks like a
 * connection problem. A non-2xx response is NOT retried — that is the server
 * answering, and retrying would just hide it.
 */

import https from "node:https";
import http from "node:http";

export interface TextResponse {
  ok: boolean;
  status: number;
  text: string;
  /** Which transport actually delivered the response. */
  via: "fetch" | "node:https";
  error: string | null;
}

interface Options {
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/** Connection-level failures worth retrying on the fallback transport. */
function isConnectFailure(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string } })?.cause;
  const code = cause?.code ?? (err as { code?: string })?.code ?? "";
  return (
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN" ||
    code === "ENETUNREACH" ||
    code === "EHOSTUNREACH"
  );
}

function nodeGetText(url: string, opts: Options): Promise<TextResponse> {
  const timeoutMs = opts.timeoutMs ?? 25_000;

  return new Promise((resolve) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return resolve({ ok: false, status: 0, text: "", via: "node:https", error: "Invalid URL" });
    }

    const transport = target.protocol === "http:" ? http : https;
    const req = transport.request(
      {
        protocol: target.protocol,
        host: target.hostname,
        port: target.port || (target.protocol === "http:" ? 80 : 443),
        path: target.pathname + target.search,
        method: "GET",
        // Pin IPv4: the addresses that fail above are the IPv6 ones.
        family: 4,
        headers: opts.headers ?? {},
      },
      (res) => {
        // Follow a single redirect, which some data portals use.
        const location = res.headers.location;
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && location) {
          res.resume();
          const next = new URL(location, url).toString();
          return resolve(nodeGetText(next, opts));
        }

        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({
            ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
            status: res.statusCode ?? 0,
            text: body,
            via: "node:https",
            error: null,
          })
        );
      }
    );

    req.on("error", (err: NodeJS.ErrnoException) =>
      resolve({
        ok: false,
        status: 0,
        text: "",
        via: "node:https",
        error: `${err.code ?? "ERR"}: ${err.message}`,
      })
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({
        ok: false,
        status: 0,
        text: "",
        via: "node:https",
        error: `Timed out after ${timeoutMs} ms`,
      });
    });

    req.end();
  });
}

export async function fetchText(url: string, opts: Options = {}): Promise<TextResponse> {
  const timeoutMs = opts.timeoutMs ?? 25_000;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: opts.headers,
      cache: "no-store",
    });
    return {
      ok: res.ok,
      status: res.status,
      text: await res.text(),
      via: "fetch",
      error: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    // Only a connection-level failure justifies a second attempt; a server
    // that answered has already told us something we should report.
    if (!isConnectFailure(err) && (err as Error)?.name !== "TimeoutError") {
      return {
        ok: false,
        status: 0,
        text: "",
        via: "fetch",
        error: String((err as Error)?.message ?? err),
      };
    }
    return nodeGetText(url, opts);
  }
}
