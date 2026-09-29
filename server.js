const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

// =================== CONFIGURAÇÃO ===========================
const CONFIG = {
  // SeaTalk
  SOP_APP_ID: 'MTkyNzY0MTk5MjQx',
  SOP_APP_SECRET: '7tLCy6chguHYmh2fl_-GWoUDzNCCrv8g',
  SIGNING_SECRET: 'nijrLGlzldKDm3yxEhkaqKvoUPg0Q78Y',
  SEATALK_API: 'https://openapi.seatalk.io',

  // Alpha Knowledge (callback original)
  KNOWLEDGE_CALLBACK: 'https://knowledge.alpha.insea.io/s2sapi/sopbot/callback/9765',

  // Web App do Apps Script (busca na planilha)
  WEBAPP_URL: 'https://script.google.com/a/macros/shopee.com/s/AKfycbzqSZhLMsoebpm5KOVJxq4tn34hfBPjuwpq40xztKapLFxxUg76syn7_qSJ2e5UzzMJTg/exec'
};

// Cache do token
let tokenCache = { token: null, expiry: 0 };

// =================== OBTER TOKEN SEATALK ====================
async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiry) {
    return tokenCache.token;
  }

  const res = await fetch(CONFIG.SEATALK_API + '/auth/app_access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: CONFIG.SOP_APP_ID,
      app_secret: CONFIG.SOP_APP_SECRET
    })
  });

  const data = await res.json();
  const token = data.app_access_token || data.access_token;

  if (token) {
    tokenCache = { token, expiry: Date.now() + 3600000 }; // 1h cache
  }

  return token;
}

// =================== ENVIAR MENSAGEM SEATALK ================
async function sendMessage(employeeCode, text) {
  const token = await getAccessToken();
  if (!token) {
    console.log('Erro: sem token');
    return;
  }

  const res = await fetch(CONFIG.SEATALK_API + '/messaging/v2/single_chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify({
      employee_code: employeeCode,
      message: { tag: 'text', text: text }
    })
  });

  const result = await res.json();
  console.log('Mensagem enviada:', result.code === 0 ? 'OK' : result);
}

// =================== BUSCAR NA PLANILHA =====================
async function buscarNaPlanilha(shopId) {
  try {
    const url = CONFIG.WEBAPP_URL + '?shopId=' + encodeURIComponent(shopId);
    const res = await fetch(url, { redirect: 'follow' });
    const data = await res.json();
    return data;
  } catch (err) {
    console.log('Erro ao buscar na planilha:', err.message);
    return { found: false, message: 'Erro ao consultar a base.' };
  }
}

// =================== FORMATAR RESPOSTA ======================
function formatarResposta(resultado) {
  if (!resultado.found) {
    return '❌ Shop ID/Seller não encontrado na base de dados.\nVerifique o número e tente novamente.';
  }

  const s = resultado.seller || (resultado.sellers && resultado.sellers[0]);
  if (!s) return '❌ Erro ao processar os dados do seller.';

  const shopId = s['Shop_Id'] || s['Shop_id'] || s['shop_id'] || 'N/A';
  const shopName = s['Shop_name'] || s['Shop_Name'] || s['shop_name'] || 'N/A';
  const telefone = s['Telefone'] || s['telefone'] || 'N/A';
  const email = s['E-mail'] || s['Email'] || s['email'] || 'N/A';
  const endereco = s['Endereço'] || s['Endereco'] || s['endereco'] || 'N/A';
  const cidade = s['Cidade'] || s['cidade'] || 'N/A';
  const cep = s['CEP'] || s['cep'] || 'N/A';

  return `📦 Shop ID: ${shopId}\n🏪 Shop Name: ${shopName}\n📞 Telefone: ${telefone}\n📧 E-mail: ${email}\n📍 Endereço: ${endereco}\n🏙️ Cidade: ${cidade}\n📮 CEP: ${cep}`;
}

// =================== ENCAMINHAR PRO ALPHA KNOWLEDGE =========
async function encaminharParaKnowledge(body) {
  try {
    const res = await fetch(CONFIG.KNOWLEDGE_CALLBACK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    console.log('Encaminhado pro Knowledge - Status:', res.status);
  } catch (err) {
    console.log('Erro ao encaminhar:', err.message);
  }
}

// =================== CALLBACK DO SEATALK ====================
app.post('/', async (req, res) => {
  try {
    const body = req.body;

    // 1. Challenge de verificação
    if (body.seatalk_challenge) {
      console.log('Challenge recebido');
      return res.json({ seatalk_challenge: body.seatalk_challenge });
    }

    // Responde rápido pro SeaTalk (200 OK)
    res.json({ status: 'ok' });

    // 2. Processar mensagem
    const eventType = body.event_type || '';

    if (eventType === 'message_from_bot_subscriber') {
      const message = body.message || {};
      const texto = (message.text || message.content || '').trim();
      const employeeCode = body.employee_code || '';

      if (!texto || !employeeCode) return;

      console.log('Mensagem recebida:', texto, 'de:', employeeCode);

      // Extrair números da mensagem
      const numeros = texto.match(/\d{6,}/g);

      if (numeros && numeros.length > 0) {
        // É um Shop ID → busca DIRETA na planilha
        const shopId = numeros[0];
        console.log('Buscando Shop ID:', shopId);

        const resultado = await buscarNaPlanilha(shopId);
        const resposta = formatarResposta(resultado);

        await sendMessage(employeeCode, resposta);
        console.log('Respondido com dados da planilha');
      } else {
        // NÃO é número → encaminha pro Alpha Knowledge
        console.log('Encaminhando pro Alpha Knowledge:', texto);
        await encaminharParaKnowledge(body);
      }
    } else {
      // Outros eventos → encaminha pro Alpha Knowledge
      await encaminharParaKnowledge(body);
    }

  } catch (err) {
    console.error('Erro:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'online', bot: 'Bot Sellers SeaTalk' });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Bot Sellers rodando na porta ' + PORT);
});
