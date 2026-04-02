const CONFIG = {
  FIREBASE_URL: "https://zedping999-default-rtdb.asia-southeast1.firebasedatabase.app",
  FIREBASE_SECRET: "eeqLA8qlmxD1Wna21p6ds3xPj0kTowWOoM7vpAg6",
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
  const prefix = keyFormat.Prefix || 'ZedPing';

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

function calculateExpiration(hours) {
  const now = new Date();
  // Giờ Việt Nam = Giờ hiện tại + 7 + số giờ Key có hiệu lực
  const vnTime = new Date(now.getTime() + (hours + 7) * 60 * 60 * 1000);

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
  if (!res.ok) throw new Error('Không thể tải cấu hình từ Firebase');
  return await res.json();
}

async function shortenUrl(provider, targetUrl) {
  const template = URL_TEMPLATES[provider.Kind];
  if (!template) throw new Error(`Không hỗ trợ provider: ${provider.Kind}`);

  const apiUrl = template(provider.Token, targetUrl);
  
  const res = await fetch(apiUrl, { 
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  });
  
  if (!res.ok) throw new Error(`Lỗi kết nối API rút gọn link (${res.status})`);
  
  const data = await res.json();
  
  // Đã sửa lỗi chính tả shortenedUr1 thành shortenedUrl
  const shortUrl = data.shortenedUrl || 
                  data.shortened || 
                  data.short_url || 
                  data.url || 
                  data.link ||
                  data.shortenedUr1; 
                  
  if (!shortUrl) throw new Error(`Provider ${provider.Kind} không trả về link rút gọn!`);
  
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
  if (request.method !== "POST") return new Response(JSON.stringify({ message: "Chỉ chấp nhận phương thức POST" }), { status: 405, headers: corsHeaders });

  try {
    const body = await request.json();
    const { token, hours } = body;
    // Lấy số giờ từ frontend, mặc định là 5 nếu không có
    const h = parseInt(hours) || 24;

    // 2. Load Config từ Firebase
    const config = await loadConfig();
    if (!config) return new Response(JSON.stringify({ message: "Lỗi hệ thống: Không có config!" }), { status: 500, headers: corsHeaders });

    // 3. Cơ chế LAZY: Tìm provider tương ứng, nếu không thấy thì dùng tạm 12h
    let providers = (config[`LinkProviders${h}h`] || []).filter(p => p.Enabled && p.Token);
    
    if (providers.length === 0) {
      console.log(`Fallback: Không tìm thấy config ${h}h, mượn tạm config 12h.`);
      providers = (config.LinkProviders12h || []).filter(p => p.Enabled && p.Token);
    }

    if (providers.length === 0) {
      return new Response(JSON.stringify({ message: "Hệ thống chưa cấu hình Link Provider!" }), { status: 400, headers: corsHeaders });
    }

    // 4. Tạo Key và tính thời gian hết hạn (theo đúng số giờ h)
    const keyFormat = config.KeyFormat || { Prefix: 'ZedPing', Segments: 4, CharsPerSegment: 4, Charset: 'AZ09' };
    const key = generateKey(keyFormat);
    const exp = calculateExpiration(h);

    const vnNow = new Date(new Date().getTime() + 7 * 60 * 60 * 1000);
    const createdAt = vnNow.getUTCFullYear() + '-' + String(vnNow.getUTCMonth() + 1).padStart(2, '0') + '-' + String(vnNow.getUTCDate()).padStart(2, '0');

    const keyData = {
      ExpiredDay: exp.ExpiredDay,
      ExpiredDate: exp.ExpiredDate,
      CreatedAt: createdAt,
      Type: "NORMAL",
      MaxDevices: config.MaxDevices || 1
    };

    // 5. Lưu Key vào nhánh NormalKey
    const saveRes = await fetch(`${CONFIG.FIREBASE_URL}/ValidKeys/NormalKey/${key}.json?auth=${CONFIG.FIREBASE_SECRET}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(keyData)
    });
    
    if (!saveRes.ok) throw new Error("Không thể lưu Key vào cơ sở dữ liệu!");

    // 6. Tạo link đích và thực hiện rút gọn link
    const callbackUrl = config.CallbackUrl || "https://zedping.pages.dev/getkey";
    const separator = callbackUrl.includes('?') ? '&' : '?';
    const finalUrl = `${callbackUrl}${separator}key=${encodeURIComponent(key)}`;

    let shortenedUrl = "";
    // Nếu chỉ có 1 provider (như trường hợp 12h của bạn), rút gọn 1 lần
    if (providers.length === 1) {
      shortenedUrl = await shortenUrl(providers[0], finalUrl);
    } else {
      // Nếu có nhiều provider (như 24h), chạy vòng lặp rút gọn lồng nhau
      let currentUrl = finalUrl;
      const chain = [...providers].reverse();
      for (const provider of chain) {
        currentUrl = await shortenUrl(provider, currentUrl);
      }
      shortenedUrl = currentUrl;
    }

    // 7. Trả kết quả về cho giao diện
    return new Response(JSON.stringify({ 
      success: true, 
      url: shortenedUrl, 
      key: key, 
      hours: h 
    }), { status: 200, headers: corsHeaders });

  } catch (e) {
    return new Response(JSON.stringify({ message: "Lỗi xử lý: " + e.message }), { status: 500, headers: corsHeaders });
  }
}
