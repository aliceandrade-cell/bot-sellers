const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

// =================== CONFIGURAÇÃO ===========================
const CONFIG = {
  SOP_APP_ID: 'MTkyNzY0MTk5MjQx',
  SOP_APP_SECRET: '7tLCy6chguHYmh2fl_-GWoUDzNCCrv8g',
  SIGNING_SECRET: 'nijrLGlzldKDm3yxEhkaqKvoUPg0Q78Y',
  SEATALK_API: 'https://openapi.seatalk.io',
  KNOWLEDGE_CALLBACK: 'https://knowledge.alpha.insea.io/s2sapi/sopbot/callback/9765',
  WEBAPP_URL: 'https://script.google.com/a/macros/shopee.com/s/AKfycbzqSZhLMsoebpm5KOVJxq4tn34hfBPjuwpq40xztKapLFxxUg76syn7_qSJ2e5UzzMJTg/exec'
};

let tokenCache = { token: null, expiry: 0 };

// =================== KEEP ALIVE (evita cold start) ==========
setInterval(() => {
  fetch('https://bot-sellers.onrender.com/')
    .then(() => console.log('Keep alive ping'))
    .catch(() => {});
}, 840000); // 14 minutos

// =================== CHALLENGE (POST e GET) ==================
app.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    console.log('POST recebido:', JSON.stringify(body).substring(0, 200));

    // Challenge de verificação
    if (body.seatalk_challenge) {
      console.log('Challenge:', body.seatalk_challenge);
      res.set('Content-Type', 'application/json');
      return res.status(200).send(JSON.stringify({ seatalk_challenge: body.seatalk_challenge }));
    }

    // Responde 200 OK imediatamente
    res.status(200).json({ code: 0 });

    // Processa a mensagem em background
    const eventType = body.event_type || '';
    if (eventType === 'message_from_bot_subscriber') {
      const message = body.message || {};
      const texto = (message.text || message.content || '').trim();
      const employeeCode = body.employee_code || '';

      if (!texto || !employeeCode) return;
      console.log('Msg:', texto, 'De:', employeeCode);

      const numeros = texto.match(/\d{6,}/g);

      if (numeros && numeros.length > 0) {
        const shopId = numeros[0];
        console.log('Buscando Shop ID:', shopId);
        const resultado = await buscarNaPlanilha(shopId);
        const resposta = formatarResposta(resultado);
        await sendMessage(employeeCode, resposta);
      } else {
        console.log('Encaminhando pro Knowledge:', texto);
        await encaminharParaKnowledge(body);
      }
    } else {
      await encaminharParaKnowledge(body);
    }
  } catch (err) {
    console.error('Erro:', err.message);
    if (!res.headersSent) res.status(200).json({ code: 0 });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'online', bot: 'Bot Sellers SeaTalk', time: new Date().toISOString() });
});

// =================== SEATALK API ============================
async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiry) return tokenCache.token;
  const res = await fetch(CONFIG.SEATALK_API + '/auth/app_access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: CONFIG.SOP_APP_ID, app_secret: CONFIG.SOP_APP_SECRET })
  });
  const data = await res.json();
  const token = data.app_access_token || data.access_token;
  if (token) tokenCache = { token, expiry: Date.now() + 3600000 };
  return token;
}

async function sendMessage(employeeCode, text) {
  const token = await getAccessToken();
  if (!token) { console.log('Sem token'); return; }
  const res = await fetch(CONFIG.SEATALK_API + '/messaging/v2/single_chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ employee_code: employeeCode, message: { tag: 'text', text } })
  });
  const r = await res.json();
  console.log('Enviado:', r.code === 0 ? 'OK' : JSON.stringify(r));
}

// =================== BUSCA NA PLANILHA ======================
async function buscarNaPlanilha(shopId) {
  try {
    const url = CONFIG.WEBAPP_URL + '?shopId=' + encodeURIComponent(shopId);
    const res = await fetch(url, { redirect: 'follow' });
    return await res.json();
  } catch (err) {
    console.log('Erro planilha:', err.message);
    return { found: false };
  }
}

function formatarResposta(r) {
  if (!r.found) return '❌ Shop ID/Seller não encontrado na base de dados.\nVerifique o número e tente novamente.';
  const s = r.seller || (r.sellers && r.sellers[0]);
  if (!s) return '❌ Erro ao processar dados.';
  return [
    '📦 Shop ID: ' + (s['Shop_Id'] || s['Shop_id'] || 'N/A'),
    '🏪 Shop Name: ' + (s['Shop_name'] || s['Shop_Name'] || 'N/A'),
    '📞 Telefone: ' + (s['Telefone'] || 'N/A'),
    '📧 E-mail: ' + (s['E-mail'] || s['Email'] || 'N/A'),
    '📍 Endereço: ' + (s['Endereço'] || s['Endereco'] || 'N/A'),
    '🏙️ Cidade: ' + (s['Cidade'] || 'N/A'),
    '📮 CEP: ' + (s['CEP'] || 'N/A')
  ].join('\n');
}

// =================== ALPHA KNOWLEDGE ========================
async function encaminharParaKnowledge(body) {
  try {
    const res = await fetch(CONFIG.KNOWLEDGE_CALLBACK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    console.log('Knowledge:', res.status);
  } catch (err) {
    console.log('Erro Knowledge:', err.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Bot rodando na porta ' + PORT));
