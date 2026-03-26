const FIREBASE   = "https://zedxping-default-rtdb.asia-southeast1.firebasedatabase.app";
const GETKEY_URL = "https://zedping.pages.dev/getkey";
const KEY_PREFIX = "ZED";

const LINK4M_APIS = [
  "693a35dba7278507ed3944ed",
  "69986a45fdc37d7e7135022c",
  "692c2c794975965623647ae8"
];

async function fbSet(path, data) {
  const res = await fetch(`${FIREBASE}/${path}.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  return res.json();
}

async function fbDelete(path) {
  await fetch(`${FIREBASE}/${path}.json`, { method: "DELETE" });
}

function generateKey() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const arr   = crypto.getRandomValues(new Uint8Array(12));
  const rnd   = Array.from(arr).map(b => chars[b % chars.length]).join("");
  return `${KEY_PREFIX}-${rnd.slice(0,4)}-${rnd.slice(4,8)}-${rnd.slice(8,12)}`;
}

async function shortenLink4m(targetUrl) {
  const apiKey = LINK4M_APIS[Math.floor(Math.random() * LINK4M_APIS.length)];
  const res    = await fetch(`https://link4m.co/api-shorten/v2?api=${apiKey}&url=${encodeURIComponent(targetUrl)}`);
  const data   = await res.json();
  if (data.status !== "success" || !data.shortenedUrl)
    throw new Error("link4m_failed: " + JSON.stringify(data));
  return data.shortenedUrl;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

export async function onRequest(context) {
  if (context.request.method === "OPTIONS")
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" } });

  if (context.request.method !== "GET")
    return json({ success: false, message: "Method not allowed" }, 405);

  const key    = generateKey();
  const now    = Date.now();
  const expiry = now + 24 * 60 * 60 * 1000;
  const expStr = new Date(expiry).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

  await fbSet(`ValidKeys/NormalKey/${key}`, {
    Type:           "NormalKey",
    ExpiryMs:       expiry,
    ExpiryReadable: expStr,
    CreatedAt:      now
  });

  try {
    const finalUrl = await shortenLink4m(`${GETKEY_URL}?key=${key}`);
    return json({ success: true, url: finalUrl });
  } catch (err) {
    await fbDelete(`ValidKeys/NormalKey/${key}`);
    return json({ success: false, message: err.message }, 500);
  }
}
