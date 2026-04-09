import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

// ─── UTILITÁRIO GLOBAL: extrator de JSON ─────────────────────────────────────
function extractJson(text) {
  if (!text) return null;
  let cleanText = text.trim();
  const start = cleanText.indexOf('{');
  const end = cleanText.lastIndexOf('}');
  
  if (start !== -1 && end !== -1) {
    let rawJson = cleanText.substring(start, end + 1);
    
    // Traduz formatos Python/Alucinações comuns para JSON válido
    rawJson = rawJson
      .replace(/'/g, '"')
      .replace(/: None/g, ': null')
      .replace(/:None/g, ':null')
      .replace(/True/g, 'true')
      .replace(/False/g, 'false');

    try {
      let obj = JSON.parse(rawJson);
      return {
        customerName: obj.customerName || obj.customer_name || obj.cliente || obj.destinatario || null,
        productName:  obj.productName || obj.product_name || obj.produto || null,
        location:     obj.location || obj.city || obj.cidade || null,
        cep:          obj.cep || obj.postal_code || obj.postal || null,
        address:      obj.address || obj.endereco || null,
        orderId:      obj.orderId || obj.order_id || obj.pedido || null,
        nf:           obj.nf || obj.nota_fiscal || obj.invoice || null,
        quantity:     Number(obj.quantity || obj.qtd || obj.quantidade || 1),
        productId:    obj.productId || obj.product_id || null,
        customerId:   obj.customerId || obj.customer_id || null
      };
    } catch (e) {
      console.error("Erro no parse de JSON extraído:", e, rawJson);
      return null;
    }
  }
  return null;
}

// ─── CONEXÃO DIRETA COM GOOGLE API (v1beta) ──────────────────────────────────
// Esta função ignora o SDK problemático e fala direto com o endpoint v1beta
async function callGeminiDirectV1beta(payload) {
  // Removido o gemini-pro (descontinuado) e adicionado o gemini-2.5-flash e 1.5-pro
  const models = ['gemini-2.5-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-pro-latest'];
  let errs = [];

  for (const modelName of models) {
    try {
      if (window.addSystemLog) window.addSystemLog(`Tentando API v1beta direta (${modelName})...`, 'info');
      
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (data.error) throw new Error(`${data.error.code}: ${data.error.message}`);
      
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;
    } catch (e) {
      errs.push(`[${modelName}]: ${e.message}`);
      if (window.addSystemLog) window.addSystemLog(`v1beta (${modelName}) falhou: ${e.message}`, 'warn');
    }
  }
  
  const errorString = errs.join('\n');
  if (errorString.includes('429') || errorString.includes('Quota')) {
    throw new Error("⏳ Limite de leituras rápido atingido (Camada Gratuita)! Por favor, respire fundo, aguarde cerca de 1 minutinho e tente novamente. 🤖");
  }
  throw new Error(`A API do Google recusou a conexão:\n${errorString}`);
}

export async function sendMessageToGemini(history, message, inventory, onLeadCaptured) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
    const result = await model.generateContent(message);
    return result.response.text();
  } catch (err) {
    return `Erro no Chat: ${err.message}`;
  }
}

export async function generateAnaMessage(lead, inventory) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent("Oi");
    return result.response.text();
  } catch (e) { return "Erro na mensagem."; }
}

// ─── EXTRAÇÃO DE IMAGEM ──────────────────────────────────────────────────────
export async function analyzeOrderDocument(fileBase64, inventory, customers) {
  const b64Data = fileBase64.includes(',') ? fileBase64.split(',')[1] : fileBase64;
  const payload = {
    contents: [{
      parts: [
        { text: "Extraia os dados desta etiqueta de envio brasileira para JSON puro." },
        { inlineData: { mimeType: "image/jpeg", data: b64Data } }
      ]
    }]
  };
  try {
    const text = await callGeminiDirectV1beta(payload);
    return extractJson(text);
  } catch (e) { 
    throw e; // Agora ele joga o erro pra tela do usuário!
  }
}

// ─── PARSER LOCAL (EXTRAÇÃO RÁPIDA SEM API) ──────────────────────────────────
function extractTextLocally(text) {
  if (!text) return null;
  const extract = (regex) => {
    const match = text.match(regex);
    return match ? match[1].trim() : null;
  };

  // Padrões comuns de etiquetas (Shopee, Mercado Livre, etc)
  const customerName = extract(/Destinatário[\s\S]*?Nome:\s*(.+)/i) || extract(/Nome:\s*(.+)/i);
  const location = extract(/Cidade\/Estado:\s*([^,\n]+)/i) || extract(/Cidade:\s*(.+)/i);
  const cep = extract(/CEP:\s*([\d-]+)/i);
  const address = extract(/Endereço:\s*(.+)/i);
  const orderId = extract(/Pedido:\s*([a-zA-Z0-9-]+)/i);
  const nf = extract(/NF:\s*(\d+)/i) || extract(/Nota Fiscal:\s*(\d+)/i);

  if (customerName || orderId || cep) {
    return {
      customerName: customerName || null,
      location: location || null,
      cep: cep || null,
      address: address || null,
      orderId: orderId || null,
      nf: nf || null,
      quantity: 1
    };
  }
  return null;
}

// ─── EXTRAÇÃO DE TEXTO ───────────────────────────────────────────────────────
export async function analyzeOrderText(inputText, isCooldownActive = false) {
  // 1. Tenta extrair localmente primeiro (Instantâneo e sem gastar a cota da API)
  const localData = extractTextLocally(inputText);
  if (localData && (localData.customerName || localData.orderId)) {
    return localData;
  }

  // Se estiver em tempo de espera e não achou offline, bloqueia
  if (isCooldownActive) {
    throw new Error("A extração instantânea offline falhou pois o texto está fora do padrão. Aguarde o tempo acabar para usar a Inteligência Artificial novamente.");
  }

  const payload = {
    contents: [{
      parts: [{
        text: `Extraia rigorosamente para JSON:
Texto: """${inputText}"""

JSON: {
  "customerName": "Nome",
  "location": "Cidade",
  "cep": "00000-000",
  "orderId": "Pedido",
  "nf": "NF",
  "address": "Endereço Completo",
  "productName": "Produto"
}`
      }]
    }]
  };
  try {
    const text = await callGeminiDirectV1beta(payload);
    return extractJson(text);
  } catch (e) { 
    throw e; // Joga o erro pra tela
  }
}

// ─── ASSISTENTE DE DIGITAÇÃO (Texto Limpo para Cópia) ────────────────────────
export async function formatTextForCopy(inputText) {
  const prompt = `Aja como um assistente de digitação. 
Lê o texto abaixo (uma etiqueta de envio) e extraia os dados essenciais.
Retorne APENAS uma lista simples no seguinte formato (se não achar, deixe vazio):

Nome: [DADO]
Cidade: [DADO]
CEP: [DADO]
Pedido: [DADO]
NF: [DADO]
Endereco: [DADO]

TEXTO:
"""
${inputText}
"""`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }]
  };

  try {
    const text = await callGeminiDirectV1beta(payload);
    return text.trim();
  } catch (e) {
    console.error("DEBUG GEMINI:", e);
    return `❌ ERRO GOOGLE: ${e.message}`;
  }
}
