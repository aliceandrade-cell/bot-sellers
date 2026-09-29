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

// Keep alive
setInterval(() => {
  fetch('https://bot-sellers.onrender.com/').catch(() => {});
}, 840000);

// =================== CALLBACK DO SEATALK ====================
app.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    console.log('POST:', JSON.stringify(body).substring(0, 300));

    // CHALLENGE: retorna com o MESMO nome de campo que foi enviado
    if (body.seatalk_challenge) {
      console.log('seatalk_challenge:', body.seatalk_challenge);
      return res.status(200).json({ seatalk_challenge: body.seatalk_challenge });
    }
    if (body.challenge) {
      console.log('challenge:', body.challenge);
      return res.status(200).json({ challenge: body.challenge });
    }

    // Responde 200 OK
    res.status(200).json({ code: 0 });

    // Processa mensagem
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
        await sendMessage(employeeCode, formatarResposta(resultado));
      } else {
        console.log('Encaminhando pro Knowledge');
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
  res.json({ status: 'online', bot: 'Bot Sellers SeaTalk' });
});

// =================== SEATALK API ============================
async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiry) return tokenCache.token;
  const r = await fetch(CONFIG.SEATALK_API + '/auth/app_access_token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: CONFIG.SOP_APP_ID, app_secret: CONFIG.SOP_APP_SECRET })
  });
  const d = await r.json();
  const t = d.app_access_token || d.access_token;
  if (t) tokenCache = { token: t, expiry: Date.now() + 3600000 };
  return t;
}

async function sendMessage(employeeCode, text) {
  const token = await getAccessToken();
  if (!token) return;
  const r = await fetch(CONFIG.SEATALK_API + '/messaging/v2/single_chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ employee_code: employeeCode, message: { tag: 'text', text } })
  });
  const d = await r.json();
  console.log('Enviado:', d.code === 0 ? 'OK' : JSON.stringify(d));
}

// =================== BUSCA NA PLANILHA ======================
async function buscarNaPlanilha(shopId) {
  try {
    const r = await fetch(CONFIG.WEBAPP_URL + '?shopId=' + encodeURIComponent(shopId), { redirect: 'follow' });
    return await r.json();
  } catch (e) { return { found: false }; }
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

async function encaminharParaKnowledge(body) {
  try {
    const r = await fetch(CONFIG.KNOWLEDGE_CALLBACK, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    console.log('Knowledge:', r.status);
  } catch (e) { console.log('Erro Knowledge:', e.message); }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Bot rodando na porta ' + PORT));
