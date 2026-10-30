import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

// Runs public/sw.js in a sandbox with fake caches and fetch, and drives its fetch handler.
function loadWorker(network: (url: string) => Response) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const store = new Map<string, Map<string, Response>>();
  const caches = {
    open: async (name: string) => {
      if (!store.has(name)) store.set(name, new Map());
      const c = store.get(name)!;
      return { put: async (req: Request, res: Response) => void c.set(req.url, res), addAll: async () => {} };
    },
    match: async (req: Request) => {
      for (const c of store.values()) if (c.has(req.url)) return c.get(req.url);
      return undefined;
    },
    keys: async () => [...store.keys()],
  };
  const self = { location: { origin: "https://forma.test" }, addEventListener: (t: string, fn: (e: unknown) => void) => (listeners[t] = fn) };
  vm.runInNewContext(readFileSync(path.resolve(__dirname, "../../../public/sw.js"), "utf8"), {
    self, caches, URL, Request, Response, Promise,
    fetch: async (req: Request) => network(req.url),
  });
  const get = async (url: string) => {
    let pending: Promise<Response> | undefined;
    listeners.fetch({ request: new Request(url), respondWith: (p: Promise<Response>) => (pending = p) });
    const res = await pending!;
    await new Promise((r) => setTimeout(r, 0)); // let the cache write settle
    return res;
  };
  const cached = (url: string) => [...store.values()].some((c) => c.has(url));
  return { get, cached };
}

const chunk = "https://forma.test/_next/static/chunks/charts-abc123.js";
// Response.type is "default" outside a browser; the worker sees "basic" for same-origin fetches.
const basic = (body: string, status: number) => Object.defineProperty(new Response(body, { status }), "type", { value: "basic" });

describe("service worker static cache", () => {
  it("never keeps a failed script response, so the next load retries the network", async () => {
    let status = 404;
    const sw = loadWorker(() => basic(status === 200 ? "ok" : "missing", status));
    expect((await sw.get(chunk)).status).toBe(404);
    expect(sw.cached(chunk)).toBe(false);
    status = 200;
    expect((await sw.get(chunk)).status).toBe(200);
    expect(sw.cached(chunk)).toBe(true);
  });

  it("does not cache server errors", async () => {
    const sw = loadWorker(() => basic("boom", 503));
    await sw.get(chunk);
    expect(sw.cached(chunk)).toBe(false);
  });
});
