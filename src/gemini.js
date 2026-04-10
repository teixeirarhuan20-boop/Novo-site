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
        productName: obj.productName || obj.product_name || obj.produto || null,
        location: obj.location || obj.city || obj.cidade || null,
        cep: obj.cep || obj.postal_code || obj.postal || null,
        address: obj.address || obj.endereco || null,
        orderId: obj.orderId || obj.order_id || obj.pedido || null,
        nf: obj.nf || obj.nota_fiscal || obj.invoice || null,
        rastreio: obj.rastreio || obj.tracking || obj.codigo_rastreio || null,
        bairro: obj.bairro || obj.neighborhood || null,
        modalidade: obj.modalidade || obj.modality || null,
        remetente: obj.remetente || obj.sender || null,
        quantity: Number(obj.quantity || obj.qtd || obj.quantidade || 1),
        productId: obj.productId || obj.product_id || null,
        customerId: obj.customerId || obj.customer_id || null,
        email: obj.email || null,
        telefone: obj.telefone || obj.phone || null,
        orderType: obj.orderType || null
      };
    } catch (e) {
      console.error("Erro no parse de JSON extraído:", e, rawJson);
      return null;
    }
  }
  return null;
}

// ─── CONEXÃO DIRETA COM GOOGLE API (v1beta) ──────────────────────────────────
async function callGeminiDirectV1beta(payload) {
  const models = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
  let errs = [];

  for (const modelName of models) {
    try {
      if (window.addSystemLog) window.addSystemLog(`Tentando modelo (${modelName})...`, 'info');

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      );

      const data = await response.json();
      if (data.error) throw new Error(`${data.error.code}: ${data.error.message}`);

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;
    } catch (e) {
      errs.push(`[${modelName}]: ${e.message}`);
      if (window.addSystemLog) window.addSystemLog(`${modelName} falhou: ${e.message}`, 'warn');
    }
  }

  const errorString = errs.join('\n');
  if (errorString.includes('429') || errorString.includes('Quota')) {
    throw new Error("⏳ Limite de leituras atingido! Aguarde cerca de 1 minuto e tente novamente.");
  }
  throw new Error(`A API do Google recusou a conexão:\n${errorString}`);
}

// ─── CHAT COM VENDEDORA ───────────────────────────────────────────────────────
export async function sendMessageToGemini(chatHistory, currentMessage, inventory, onLeadCaptured, onOrderPlaced) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Prepare chat history for Gemini API
    let geminiHistory = chatHistory.map(msg => ({
      role: msg.role === 'bot' ? 'model' : 'user', // Gemini uses 'model' for bot
      parts: [{ text: msg.text }]
    }));

    // O SDK do Gemini exige que o histórico comece obrigatoriamente com um 'user'.
    // Removemos saudações iniciais do bot do histórico enviado à API.
    const firstUserIndex = geminiHistory.findIndex(m => m.role === 'user');
    geminiHistory = firstUserIndex !== -1 ? geminiHistory.slice(firstUserIndex) : [];

    // Construct inventory list for the AI to reference
    const inventoryList = inventory.map(item =>
      `- ${item.name} (Categoria: ${item.category}, Estoque: ${item.quantity}, Preço: R$${Number(item.price).toFixed(2)})`
    ).join('\n');

    // System instruction for the AI
    const systemInstruction = `Você é uma vendedora virtual amigável e prestativa.
Seu objetivo é ajudar o cliente com dúvidas sobre produtos, verificar estoque, preços e, se possível, coletar informações para um novo lead ou registrar um pedido.

Você tem acesso ao seguinte inventário de produtos:
${inventoryList}

Se o cliente expressar uma intenção clara de COMPRAR um produto específico com uma QUANTIDADE (ex: "Quero 2 unidades do Monitor Dell 24 para João Silva em São Paulo"), responda APENAS com um JSON válido no seguinte formato e NADA MAIS. Use 'null' para campos não encontrados:
{
  "orderType": "order",
  "customerName": "Nome completo do cliente",
  "productName": "Nome do produto de interesse",
  "quantity": "Quantidade desejada (número)",
  "location": "Cidade/Estado do cliente",
  "cep": "CEP do cliente (se fornecido)",
  "address": "Endereço completo do cliente (se fornecido)",
  "bairro": "Bairro do cliente (se fornecido)",
  "orderId": "Referência do pedido (se fornecida)",
  "nf": "Número da NF (se fornecida)",
  "rastreio": "Código de rastreio (se fornecido)",
  "modalidade": "Modalidade de envio (se fornecida)"
}

Se o cliente fornecer informações como nome, email, telefone, ou expressar interesse em um produto que possa ser um lead (mas sem intenção clara de compra imediata), responda APENAS com um JSON válido no seguinte formato e NADA MAIS. Use 'null' para campos não encontrados:
{
  "customerName": "Nome completo do cliente",
  "email": "Email do cliente",
  "telefone": "Telefone do cliente (apenas números)",
  "productName": "Nome do produto de interesse",
  "quantity": "Quantidade desejada (número)",
  "location": "Cidade/Estado do cliente"
}

Caso contrário, responda de forma natural e conversacional, usando as informações do inventário para ajudar o cliente. Mantenha as respostas concisas e úteis.`;

    const chat = model.startChat({ history: geminiHistory });
    const result = await chat.sendMessage(systemInstruction + "\n\nCliente: " + currentMessage);
    const botResponseText = result.response.text();

    const extractedData = extractJson(botResponseText);

    if (extractedData && extractedData.orderType === 'order' && extractedData.productName && extractedData.quantity > 0) {
      // Handle order placement
      onOrderPlaced(extractedData);
      return `Pedido de ${extractedData.quantity}x ${extractedData.productName} para ${extractedData.customerName} em ${extractedData.location} registrado!`;
    } else if (extractedData && extractedData.customerName) {
      // Passa o objeto completo para o App.jsx, que já espera customerName, email, etc.
      onLeadCaptured(extractedData);
      return "Obrigada! Anotei seus dados e em breve entraremos em contato. Como posso ajudar mais?";
    } else {
      return botResponseText;
    }
  } catch (err) {
    return `Erro no Chat: ${err.message}`;
  }
}

export async function generateAnaMessage(lead, inventory) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const inventoryList = inventory.map(item =>
      `- ${item.name} (Categoria: ${item.category}, Estoque: ${item.quantity}, Preço: R$${Number(item.price).toFixed(2)})`
    ).join('\n');

    const prompt = `Você é a Ana, uma assistente de vendas proativa.
Sua tarefa é criar uma mensagem de abordagem inicial para um lead, focando em um produto de interesse (se houver) e incentivando o contato.
O lead é:
Nome: ${lead.nome || 'Não informado'}
Email: ${lead.email || 'Não informado'}
Telefone: ${lead.telefone || 'Não informado'}

Inventário disponível para referência:
${inventoryList}

Crie uma mensagem curta e amigável, com no máximo 3 frases, para ser enviada via WhatsApp.
Exemplo: "Olá [Nome do Lead]! Vi seu interesse em [Produto]. Temos ótimas opções e posso te ajudar a escolher. Que tal conversarmos?"

Mensagem para ${lead.nome}:`;

    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (e) { return "Erro na mensagem."; }
}

// ─── EXTRAÇÃO DE IMAGEM ──────────────────────────────────────────────────────
export async function analyzeOrderDocument(fileBase64, inventory, customers) {
  const b64Data = fileBase64.includes(',') ? fileBase64.split(',')[1] : fileBase64;
  const payload = {
    contents: [{
      parts: [
        { text: "Extraia os dados desta etiqueta de envio brasileira para JSON puro com os campos: customerName, location, cep, address, bairro, orderId, nf, rastreio, modalidade, remetente." },
        { inlineData: { mimeType: "image/jpeg", data: b64Data } }
      ]
    }]
  };
  try {
    const text = await callGeminiDirectV1beta(payload);
    return extractJson(text);
  } catch (e) {
    throw e;
  }
}

// ─── PARSER LOCAL (EXTRAÇÃO RÁPIDA SEM API) ──────────────────────────────────
function extractTextLocally(text) {
  if (!text) return null;
  const extract = (regex) => {
    const match = text.match(regex);
    return (match && match[1]) ? match[1].trim() : null;
  };

  // Formato DESTINATÁRIO — nome fica na linha seguinte ao bloco
  let customerName = extract(/Cliente:\s*(.+)/i) || extract(/DESTINAT[ÁA]RIO\s*\n([^\n]+)/i) || extract(/Nome:\s*(.+)/i);

  const cep = extract(/CEP:\s*([\d]{5}-?[\d]{3})/i);
  const orderId = extract(/Pedido \(Ref\):\s*([a-zA-Z0-9]+)/i) || extract(/Pedido:\s*([a-zA-Z0-9]+)/i);
  const nf = extract(/NF:\s*(\d+)/i) || extract(/Nota Fiscal:\s*(\d+)/i);
  const rastreio = extract(/Rastreio[^:]*:\s*([A-Z]{2}\d+[A-Z]{2})/i) || extract(/\b([A-Z]{2}\d{13}[A-Z]{2})\b/);
  const bairro = extract(/Bairro:\s*(.+?)(?:,|$)/i); // Captura até a vírgula ou fim da linha
  const modalidade = extract(/Modalidade de Envio:\s*(.+)/i) || extract(/Modalidade:\s*(.+)/i);

  // Cidade: tenta campo explícito, depois detecta "Cidade, Estado"
  let location = extract(/Destino:\s*(.+?)(?:, CEP:|\n|$)/i) || extract(/Cidade:\s*(.+?)(?:,|$)/i);
  if (!location) {
    const estados = 'Acre|Alagoas|Amapá|Amazonas|Bahia|Ceará|Espírito Santo|Goiás|Maranhão|Mato Grosso do Sul|Mato Grosso|Minas Gerais|Pará|Paraíba|Paraná|Pernambuco|Piauí|Rio de Janeiro|Rio Grande do Norte|Rio Grande do Sul|Rondônia|Roraima|Santa Catarina|São Paulo|Sergipe|Tocantins|Distrito Federal';
    const cidadeEstado = text.match(new RegExp(`,\\s*([^,\\n]+),\\s*(${estados})`, 'i'));
    if (cidadeEstado) location = cidadeEstado[1].trim();
  }

  // Para o endereço, tenta capturar tudo após "Endereço Completo:" até "Bairro:", "CEP:" ou fim da linha
  let address = extract(/Endereço Completo:\s*(.+?)(?:,\s*Bairro:|,?\s*CEP:|\n|$)/i) || extract(/(Rua\s+.+)/i) || extract(/Endereço:\s*(.+)/i) || extract(/(Av\.\s+.+)/i);
  if (address) {
      // Limpa quaisquer vírgulas ou espaços no final
      address = address.replace(/,\s*$/, '').trim();
  }

  // Extração de Produto e Quantidade (Suporta: "Produto: X Quantidade: Y" ou "Produto: X \n Y")
  let productName = extract(/Produto:\s*\n?\s*(.+?)(?:\s*Quantidade:|\n|$)/i);
  let quantityText = extract(/Quantidade:\s*(\d+)/i);
  let quantity = quantityText ? Number(quantityText) : 1;

  // Fallback para o formato antigo (ex: "Produto X, e quantidade Ex: 2")
  if (!productName) {
  const productLine = text.split('\n').find(line => line.toLowerCase().includes(', e quantidade'));
  if (productLine) {
    const parts = productLine.split(/,\s*e quantidade/i);
    productName = parts[0].trim();
    const qtyMatch = parts[1].match(/\d+/);
    if (qtyMatch) quantity = Number(qtyMatch[0]);
  }
  }

  // Verifica se algum dado essencial foi extraído para considerar a extração local bem-sucedida
  if (customerName || orderId || cep || rastreio || location || address || bairro || productName) {
    return { customerName, location, cep, address, orderId, nf, rastreio, bairro, modalidade, productName, quantity };
  }
  return null;
}

// ─── EXTRAÇÃO DE TEXTO ───────────────────────────────────────────────────────
export async function analyzeOrderText(inputText, isCooldownActive = false) {
  // 1. Tenta extrair localmente (instantâneo, sem gastar cota da API)
  const localData = extractTextLocally(inputText);
  if (localData && (localData.customerName || localData.orderId || localData.rastreio)) {
    return localData;
  }

  if (isCooldownActive) {
    throw new Error("A extração offline não reconheceu o formato. Aguarde o tempo acabar para usar a IA.");
  }

  // 2. Manda para a IA com prompt completo
  const payload = {
    contents: [{
      parts: [{
        text: `Você é um extrator de dados de etiquetas de envio brasileiras.
Leia o texto abaixo e extraia TODOS os campos disponíveis.
Se encontrar o nome de um produto e uma quantidade no texto (ex: "Produto X, quantidade 2" ou apenas o nome do produto próximo aos dados), extraia também.

Retorne APENAS um JSON válido com esta estrutura (use null para campos não encontrados):
{
  "customerName": "Nome completo do destinatário",
  "location": "Cidade do destinatário",
  "cep": "CEP no formato 00000-000",
  "address": "Endereço completo do destinatário (rua, número, complemento)",
  "bairro": "Bairro do destinatário",
  "orderId": "Número do pedido",
  "nf": "Número da nota fiscal",
  "rastreio": "Código de rastreio completo (ex: BR2641257085334)",
  "modalidade": "Modalidade de envio (ex: COLETA, PAC, SEDEX)",
  "remetente": "Nome do remetente/loja",
  "productName": "Nome do produto encontrado",
  "quantity": 1
}

TEXTO DA ETIQUETA:
"""
${inputText}
"""`
      }]
    }]
  };

  try {
    const text = await callGeminiDirectV1beta(payload);
    return extractJson(text);
  } catch (e) {
    throw e;
  }
}

// ─── ASSISTENTE DE DIGITAÇÃO (Texto Limpo para Cópia) ────────────────────────
export async function formatTextForCopy(inputText) {
  const prompt = `Aja como um assistente de digitação. 
Leia o texto abaixo (uma etiqueta de envio) e extraia os dados essenciais.
Retorne APENAS uma lista simples neste formato (se não encontrar, deixe o campo vazio):

Nome: [DADO]
Cidade: [DADO]
Bairro: [DADO]
CEP: [DADO]
Endereco: [DADO]
Pedido: [DADO]
NF: [DADO]
Rastreio: [DADO]
Modalidade: [DADO]
Remetente: [DADO]

TEXTO:
"""
${inputText}
"""`;

  const payload = { contents: [{ parts: [{ text: prompt }] }] };

  try {
    const text = await callGeminiDirectV1beta(payload);
    return text.trim();
  } catch (e) {
    console.error("DEBUG GEMINI:", e);
    return `❌ ERRO GOOGLE: ${e.message}`;
  }
}
