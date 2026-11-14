import { getStore } from "@netlify/blobs";

const TYPES = ["image/jpeg", "image/png", "image/webp"];
const DEFAULTS = { codEnabled: false, upiId: "harsh.1330@ptyes", upiName: "Harsh Tiwari" };
const clip = (v, n) => String(v ?? "").slice(0, n);

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, "");
  const store = getStore("fitcheck");
  const json = (d, s = 200) =>
    new Response(JSON.stringify(d), {
      status: s,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  const authed = () =>
    !!process.env.ADMIN_PASSWORD &&
    req.headers.get("x-admin-password") === process.env.ADMIN_PASSWORD;
  const deny = () => json({ error: "Unauthorized" }, 401);
  const getSettings = async () => ({ ...DEFAULTS, ...((await store.get("settings", { type: "json" })) || {}) });
  const M = req.method;

  try {
    // ---- products ----
    if (path === "products" && M === "GET") return json((await store.get("products", { type: "json" })) || []);
    if (path === "login" && M === "POST") return authed() ? json({ ok: true }) : json({ error: "Wrong password" }, 401);
    if (path === "products" && M === "PUT") {
      if (!authed()) return deny();
      const body = await req.json();
      if (!Array.isArray(body)) return json({ error: "Invalid data" }, 400);
      await store.setJSON("products", body);
      return json({ ok: true });
    }

    // ---- images ----
    if (path === "image" && M === "POST") {
      if (!authed()) return deny();
      const type = req.headers.get("content-type") || "";
      if (!TYPES.includes(type)) return json({ error: "Only JPG, PNG or WebP" }, 400);
      const buf = await req.arrayBuffer();
      if (buf.byteLength > 3_000_000) return json({ error: "Image too large" }, 413);
      const id = crypto.randomUUID();
      await store.set("img-" + id, buf, { metadata: { type } });
      return json({ url: "/api/img/" + id });
    }
    if (path.startsWith("img/") && M === "GET") {
      const id = path.slice(4);
      if (!/^[\w-]+$/.test(id)) return json({ error: "Not found" }, 404);
      const r = await store.getWithMetadata("img-" + id, { type: "arrayBuffer" });
      if (!r) return json({ error: "Not found" }, 404);
      return new Response(r.data, {
        headers: { "content-type": r.metadata?.type || "image/jpeg", "cache-control": "public, max-age=31536000, immutable" },
      });
    }

    // ---- settings (COD on/off, UPI details) ----
    if (path === "settings" && M === "GET") return json(await getSettings());
    if (path === "settings" && M === "PUT") {
      if (!authed()) return deny();
      const b = await req.json();
      const next = {
        codEnabled: !!b.codEnabled,
        upiId: clip(b.upiId, 80).trim(),
        upiName: clip(b.upiName, 60).trim(),
      };
      if (!/^[\w.\-]{2,}@[A-Za-z]{2,}$/.test(next.upiId)) return json({ error: "Enter a valid UPI ID" }, 400);
      if (!next.upiName) return json({ error: "Enter the payee name" }, 400);
      await store.setJSON("settings", next);
      return json(next);
    }

    // ---- orders ----
    if (path === "orders" && M === "POST") {
      let b;
      try { b = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }
      const name = clip(b.name, 80).trim(), phone = clip(b.phone, 20).trim();
      const address = clip(b.address, 300).trim(), note = clip(b.note, 200).trim();
      const method = b.method === "cod" ? "cod" : "upi";
      const items = Array.isArray(b.items) ? b.items.slice(0, 30) : [];
      if (!name || !phone || !address || !items.length) return json({ error: "Missing order details" }, 400);
      if (method === "cod" && !(await getSettings()).codEnabled)
        return json({ error: "Cash on Delivery is not available right now" }, 400);
      const prods = (await store.get("products", { type: "json" })) || [];
      let total = 0;
      const lines = [];
      for (const it of items) {
        const p = prods.find((x) => x.id === String(it.id));
        const qty = Math.min(Math.max(parseInt(it.qty) || 0, 0), 20);
        if (!p || p.soldOut || !qty) return json({ error: `${p ? p.name : "An item"} is no longer available` }, 400);
        lines.push({ id: p.id, name: p.name, size: clip(it.size, 10), qty, price: p.price });
        total += p.price * qty;
      }
      const id = "FC" + Date.now().toString(36).toUpperCase().slice(-5) + Math.random().toString(36).slice(2, 4).toUpperCase();
      await store.setJSON("order-" + id, {
        id, createdAt: new Date().toISOString(), name, phone, address, note, method,
        items: lines, total, status: "pending", paidAmount: 0,
      });
      return json({ ok: true, id, total });
    }
    if (path === "orders" && M === "GET") {
      if (!authed()) return deny();
      const { blobs } = await store.list({ prefix: "order-" });
      const all = await Promise.all(blobs.slice(-200).map((b) => store.get(b.key, { type: "json" })));
      return json(all.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }
    if (path === "orders" && M === "PUT") {
      if (!authed()) return deny();
      const b = await req.json();
      if (!/^[\w-]+$/.test(String(b.id))) return json({ error: "Bad id" }, 400);
      const o = await store.get("order-" + b.id, { type: "js
