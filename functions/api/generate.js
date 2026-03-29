// Cloudflare Pages Function - /api/generate
// File: functions/api/generate.js

const CONFIG = {
  FIREBASE_URL: "https://zedping999-default-rtdb.asia-southeast1.firebasedatabase.app",
  FIREBASE_SECRET: "eeqLA8qlmxD1Wna21p6ds3xPj0kTowWOoM7vpAg6"
};

const URL_TEMPLATES = {
  'Taplayma': (token, url) => `https://api.taplayma.com/api?token=${token}&url=${encodeURIComponent(url)}&alias=`,
  'Link4m': (token, url) => `https://link4m.co/api-shorten/v2?api=${token}&url=${encodeURIComponent(url)}`,
  'YeuMoney': (token, url) => `https://yeumoney.com/QL_api.php?token=${token}&format=json&url=${encodeURIComponent(url)}`,
  'Traffic1M': (token, url) => `https://traffic1m.net/apidevelop?api=${token}&url=${encodeURIComponent(url)}`,
  'Traffic68': (token, url) => `https://traffic68.com/api/quicklink/api?api=${token}&url=${encodeURIComponent(url)}&alias=`,
  'NhapMa': (token, url) => `https://service.nhapma.com/api?token=${token}&url=${encodeURIComponent(url)}&alias=`
};

function generateKey(keyFormat) {
  const charsetMap = {
    'AZ09': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    'AZ': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    '09': '0123456789',
    'az09': 'abcdefghijklmnopqrstuvwxyz0123456789'
  };

  const charset = charsetMap[keyFormat.Charset] || charsetMap['AZ09'];
  const segments = keyFormat.Segments || 4;
  const charsPerSeg = keyFormat.CharsPerSegment || 4;
  const prefix = keyFormat.Prefix || 'GB';

  let key = prefix;
  for (let i = 0; i < segments; i++) {
    let segment = '';
    for (let j = 0; j < charsPerSeg; j++) {
      segment += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    key += '-' + segment;
  }
  return key;
}

// --- HÀM TÍNH THỜI GIAN ĐÃ FIX UTC+7 ---
function calculateExpiration(hours) {
  const now = new Date();
  // Lấy timestamp hiện tại, cộng thêm số giờ của Key + 7 giờ (múi giờ VN)
  const vnTime = new Date(now.getTime() + (hours + 7) * 60 * 60 * 1000);

  // Sử dụng getUTC để lấy dữ liệu từ mốc thời gian đã được offset +7
  const yyyy = vnTime.getUTCFullYear();
  const mm = String(vnTime.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(vnTime.getUTCDate()).padStart(2, '0');
  const hh = String(vnTime.getUTCHours()).padStart(2, '0');

  return {
    ExpiredDay: `${dd}/${mm}/${yyyy} ${hh}:00`,
    ExpiredDate: `${yyyy}-${mm}-${dd}-${hh}`
  };
}

async function loadConfig() {
  const url = `${CONFIG.FIREBASE_URL}/Config.json?auth=${CONFIG.FIREBASE_SECRET}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Cannot load config from Firebase');
  return await res.json();
}

async function shortenUrl(provider, targetUrl) {
  const template = URL_TEMPLATES[provider.Kind];
  if (!template) throw new Error(`Unknown provider: ${provider.Kind}`);

  const apiUrl = template(provider.Token, targetUrl);
  
  const res = await fetch(apiUrl, { 
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  });
  
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${provider.Kind}`);
  
  const data = await res.json();
  
  const shortUrl = data.shortenedUr1 || 
                  data.shortened || 
                  data.short_url || 
                  data.url || 
                  data.shortenedUrl ||
                  data.link;
                  
  if (!shortUrl) {
    throw new Error(`No shortened URL in ${provider.Kind} response`);
  }
  
  return shortUrl;
}

export async function onRequest(context) {
  const request = context.request;
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return new Response(JSON.stringify({ message: "Method not allowed" }), { status: 405, headers: corsHeaders });

  try {
    const body = await request.json();
    const { hours, keyType } = body;
    const h = parseInt(hours) || parseInt(keyType) || 24;

    if (h !== 12 && h !== 24) return new Response(JSON.stringify({ message: "hours phải là 12 hoặc 24" }), { status: 400, headers: corsHeaders });

    const config = await loadConfig();
    if (!config) return new Response(JSON.stringify({ message: "Không đọc được config từ Firebase!" }), { status: 500, headers: corsHeaders });

    const providers12h = (config.LinkProviders12h || []).filter(p => p.Enabled && p.Token);
    const providers24h = (config.LinkProviders24h || []).filter(p => p.Enabled && p.Token);

    if (h === 12 && providers12h.length === 0) return new Response(JSON.stringify({ message: "Chưa cấu hình provider 12h!" }), { status: 400, headers: corsHeaders });
    if (h === 24 && providers24h.length === 0) return new Response(JSON.stringify({ message: "Chưa cấu hình provider 24h!" }), { status: 400, headers: corsHeaders });

    const keyFormat = config.KeyFormat || { Prefix: 'GB', Segments: 4, CharsPerSegment: 4, Charset: 'AZ09' };
    const key = generateKey(keyFormat);
    const exp = calculateExpiration(h);

    // Lấy ngày tạo chuẩn VN để đồng bộ
    const vnNow = new Date(new Date().getTime() + 7 * 60 * 60 * 1000);
    const createdAt = vnNow.getUTCFullYear() + '-' + String(vnNow.getUTCMonth() + 1).padStart(2, '0') + '-' + String(vnNow.getUTCDate()).padStart(2, '0');

    const keyData = {
      ExpiredDay: exp.ExpiredDay,
      ExpiredDate: exp.ExpiredDate,
      CreatedAt: createdAt,
      Type: "NORMAL",
      MaxDevices: config.MaxDevices || 1
    };

    const saveRes = await fetch(`${CONFIG.FIREBASE_URL}/ValidKeys/NormalKey/${key}.json?auth=${CONFIG.FIREBASE_SECRET}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(keyData)
    });
    
    if (!saveRes.ok) throw new Error("Lỗi lưu key vào Firebase!");

    const callbackUrl = config.CallbackUrl || "https://gamebooster.thedev.me/getkey";
    const separator = callbackUrl.includes('?') ? '&' : '?';
    let finalUrl = `${callbackUrl}${separator}key=${encodeURIComponent(key)}`;

    let shortenedUrl = "";
    if (h === 12) {
      shortenedUrl = await shortenUrl(providers12h[0], finalUrl);
    } else {
      const chain = [...providers24h].reverse();
      let currentUrl = finalUrl;
      for (const provider of chain) currentUrl = await shortenUrl(provider, currentUrl);
      shortenedUrl = currentUrl;
    }

    return new Response(JSON.stringify({ success: true, url: shortenedUrl, key: key, hours: h }), { status: 200, headers: corsHeaders });

  } catch (e) {
    return new Response(JSON.stringify({ message: "Server lỗi: " + e.message }), { status: 500, headers: corsHeaders });
  }
}
