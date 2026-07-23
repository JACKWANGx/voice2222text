/**
 * Voice2Text - 语音转文字 API (Cloudflare Pages Functions)
 * 支持：腾讯云、阿里云、OpenAI Whisper
 * 
 * API 密钥通过 Cloudflare Pages 环境变量注入
 */

export async function onRequest(context) {
  const { request, env } = context;

  // CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  if (request.method !== 'POST') {
    return jsonResp({ error: '仅支持 POST 请求' }, 405);
  }

  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio');
    const provider = formData.get('provider') || 'tencent';
    const lang = formData.get('lang') || 'zh';

    if (!audioFile) {
      return jsonResp({ error: '未收到音频文件' }, 400);
    }

    const audioBuffer = await audioFile.arrayBuffer();

    let result;
    switch (provider) {
      case 'tencent':
        result = await transcribeTencent(audioBuffer, audioFile.name, lang, env);
        break;
      case 'aliyun':
        result = await transcribeAliyun(audioBuffer, audioFile.name, lang, env);
        break;
      case 'openai':
        result = await transcribeOpenAI(audioBuffer, audioFile.name, lang, env);
        break;
      default:
        return jsonResp({ error: '不支持的供应商: ' + provider }, 400);
    }

    return jsonResp({ text: result });
  } catch (err) {
    return jsonResp({ error: err.message || '转写失败' }, 500);
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

// ==================== 腾讯云 ASR ====================
async function transcribeTencent(audioBuffer, fileName, lang, env) {
  const secretId = env.TENCENT_SECRET_ID;
  const secretKey = env.TENCENT_SECRET_KEY;
  if (!secretId || !secretKey) {
    throw new Error('请先在 Cloudflare Pages 环境变量中设置 TENCENT_SECRET_ID 和 TENCENT_SECRET_KEY');
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const host = 'asr.tencentcloudapi.com';
  const service = 'asr';
  const action = 'SentenceRecognition';
  const version = '2019-06-14';

  const audioBase64 = btoa(String.fromCharCode(...new Uint8Array(audioBuffer)));
  const ext = getExt(fileName) || 'wav';

  const body = JSON.stringify({
    ProjectId: 0,
    SubServiceType: 1,
    EngSerViceType: '1',
    SourceType: 1,
    VoiceFormat: ext,
    Data: audioBase64,
  });

  // TC3-HMAC-SHA256 签名
  const payloadHash = await sha256Hex(body);
  const date = new Date().toISOString().split('T')[0];
  const credentialScope = `${date}/${service}/tc3_request`;
  const canonicalRequest = [
    'POST', '/', '',
    'content-type:application/json; charset=utf-8',
    `host:${host}`,
    `x-tc-action:${action.toLowerCase()}`,
    '',
    'content-type;host;x-tc-action',
    payloadHash
  ].join('\n');

  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;
  const secretDate = await hmacSha256(`TC3${secretKey}`, date);
  const secretService = await hmacSha256(secretDate, service);
  const secretSigning = await hmacSha256(secretService, 'tc3_request');
  const signature = await hmacSha256Hex(secretSigning, stringToSign);

  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=content-type;host;x-tc-action, Signature=${signature}`;

  const resp = await fetch(`https://${host}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Host': host,
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': timestamp.toString(),
      'Authorization': authorization,
    },
    body,
  });

  const data = await resp.json();
  if (data.Response?.Error) {
    throw new Error(`腾讯云错误: ${data.Response.Error.Message} (Code: ${data.Response.Error.Code})`);
  }
  return data.Response?.Result || '';
}

// ==================== 阿里云 ASR ====================
async function transcribeAliyun(audioBuffer, fileName, lang, env) {
  const accessKeyId = env.ALIYUN_ACCESS_KEY_ID;
  const accessKeySecret = env.ALIYUN_ACCESS_KEY_SECRET;
  const appKey = env.ALIYUN_ASR_APP_KEY;
  if (!accessKeyId || !accessKeySecret || !appKey) {
    throw new Error('请设置 ALIYUN_ACCESS_KEY_ID、ALIYUN_ACCESS_KEY_SECRET 和 ALIYUN_ASR_APP_KEY');
  }

  // 获取阿里云 NLS Token
  const token = await getAliyunToken(accessKeyId, accessKeySecret);

  const audioBase64 = btoa(String.fromCharCode(...new Uint8Array(audioBuffer)));
  const ext = getExt(fileName) || 'wav';

  const body = JSON.stringify({
    appkey: appKey,
    token: token,
    format: ext,
    sample_rate: 16000,
    enable_punctuation_prediction: true,
    enable_inverse_text_normalization: true,
    audio: audioBase64,
  });

  const resp = await fetch('https://nls-gateway-cn-shanghai.aliyuncs.com/stream/v1/asr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  const data = await resp.json();
  if (data.status !== 200) {
    throw new Error(`阿里云错误: ${data.message || JSON.stringify(data)}`);
  }
  return data.result || '';
}

async function getAliyunToken(akId, akSecret) {
  const timestamp = new Date().toISOString().replace(/[^0-9TZ]/g, '').split('.')[0] + 'Z';
  const body = JSON.stringify({});

  // 通过 POP API 获取 NLS token
  const resp = await fetch('https://nls-meta.cn-shanghai.aliyuncs.com/api/v2/tenant/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Access-Key-Id': akId,
      'X-Access-Key-Secret': akSecret,
    },
    body,
  });

  const data = await resp.json();
  if (data.status !== 200) {
    throw new Error(`阿里云 Token 获取失败: ${data.message || '请检查密钥'}`);
  }
  return data.token;
}

// ==================== OpenAI Whisper ====================
async function transcribeOpenAI(audioBuffer, fileName, lang, env) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('请设置 OPENAI_API_KEY');
  }

  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer], { type: 'audio/wav' }), fileName || 'audio.wav');
  formData.append('model', 'whisper-1');
  
  const langMap = { zh: 'zh', en: 'en', ja: 'ja', ko: 'ko' };
  const langCode = langMap[lang];
  if (langCode) formData.append('language', langCode);

  const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
  });

  const data = await resp.json();
  if (data.error) throw new Error(`OpenAI 错误: ${data.error.message}`);
  return data.text || '';
}

// ==================== 工具函数 ====================
function getExt(filename) {
  if (!filename) return '';
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

async function sha256Hex(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(key, msg) {
  const encoder = new TextEncoder();
  const keyBuf = typeof key === 'string' ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey('raw', keyBuf, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(msg));
}

async function hmacSha256Hex(key, msg) {
  const sig = await hmacSha256(key, msg);
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}