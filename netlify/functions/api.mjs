import { getStore } from "@netlify/blobs";

const TYPES = ["image/jpeg", "image/png", "image/webp"];

export default async (req) => {
  const path = new URL(req.url).pathname.replace(/^\/api\/?/, "");
  const store = getStore("fitcheck");
  const json = (d, s = 200) =>
    new Response(JSON.stringify(d), {
      status: s,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  const authed = () =>
    !!process.env.ADMIN_PASSWORD &&
    req.headers.get("x-admin-password") === process.env.ADMIN_PASSWORD;

  try {
    if (path === "products" && req.method === "GET") {
      return json((await store.get("products", { type: "json" })) || []);
    }
    if (path === "login" && req.method === "POST") {
      return authed() ? json({ ok: true }) : json({ error: "Wrong password" }, 401);
    }
    if (path === "products" && req.method === "PUT") {
      if (!authed()) return json({ error: "Unauthorized" }, 401);
      const body = await req.json();
      if (!Array.isArray(body)) return json({ error: "Invalid data" }, 400);
      await store.setJSON("products", body);
      return json({ ok: true });
    }
    if (path === "image" && req.method === "POST") {
      if (!authed()) return json({ error: "Unauthorized" }, 401);
      const type = req.headers.get("content-type") || "";
      if (!TYPES.includes(type)) return json({ error: "Only JPG, PNG or WebP" }, 400);
      const buf = await req.arrayBuffer();
      if (buf.byteLength > 3_000_000) return json({ error: "Image too large" }, 413);
      const id = crypto.randomUUID();
      await store.set("img-" + id, buf, { metadata: { type } });
      return json({ url: "/api/img/" + id });
    }
    if (path.startsWith("img/") && req.method === "GET") {
      const id = path.slice(4);
      if (!/^[\w-]+$/.test(id)) return json({ error: "Not found" }, 404);
      const r = await store.getWithMetadata("img-" + id, { type: "arrayBuffer" });
      if (!r) return json({ error: "Not found" }, 404);
      return new Response(r.data, {
        headers: {
          "content-type": r.metadata?.type || "image/jpeg",
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    }
    return json({ error: "Not found" }, 404);
  } catch (e) {
    return json({ error: "Server error" }, 500);
  }
};

export const config = { path: "/api/*" };
