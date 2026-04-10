import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
const groqApiKey = import.meta.env.VITE_GROQ_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

// ─── UTILITÁRIO GLOBAL: extrator de JSON ─────────────────────────────────────
function extractJson(text) {
  if (!text) return null;
  let cleanText = text.trim();
  const start = cleanText.indexOf('{');
  const end = cleanText.lastIndexOf('}');
  
  // Remove blocos de código markdown se existirem (```json ... ```)
  cleanText = cleanText.replace(/```json|```/g, "").trim();

  if (cleanText.includes('{') && cleanText.includes('}')) {
    let rawJson = cleanText.substring(start, end + 1);
    rawJson = rawJson
      .replace(/(\w+)'(\w+)/g, "$1\\'$2") // Escapa apóstrofos internos (ex: D'Angelo)
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, "") // Remove caracteres de controle invisíveis
      .replace(/(?<!\\)'/g, '"') // Tenta converter aspas simples em duplas para JSON, exceto as já escapadas
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

// ─── CONEXÃO DIRETA COM GROQ API (LLAMA 3) ───────────────────────────────────
async function callGroqDirect(promptText) {
  if (!groqApiKey) throw new Error("Chave da Groq não configurada.");
  
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${groqApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile", // Modelo Atualizado
      response_format: { type: "json_object" }, // Força JSON
      temperature: 0.1,
      messages: [{ role: "user", content: promptText }]
    })
  });
  
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 429) throw new Error("LIMITE_EXCEDIDO");
    throw new Error(`Groq Erro: ${data.error?.message || response.statusText}`);
  }
  
  return data.choices[0].message.content;
}

// ─── CONEXÃO DIRETA COM GOOGLE API (v1beta) ──────────────────────────────────
async function callGeminiDirectV1beta(payload) {
  const models = ['gemini-1.5-flash', 'gemini-2.0-flash']; // 1.5-flash costuma ter limites maiores no gratuito
  let errs = [];

  for (const modelName of models) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            generationConfig: { temperature: 0.1, topP: 0.1, response_mime_type: "application/json" } 
          })
        }
      );

      const data = await response.json();
      if (data.error) {
        const msg = data.error.message || "";
        if (data.error.code === 429 || msg.includes("429") || msg.includes("Quota")) {
          throw new Error("LIMITE_EXCEDIDO");
        }
        throw new Error(`${data.error.code}: ${data.error.message}`);
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;
    } catch (e) {
      // Se for erro de quota, para o loop imediatamente
      if (e.message === "LIMITE_EXCEDIDO") throw new Error("⏳ Limite de leituras atingido! Aguarde 1 minuto.");
      errs.push(`[${modelName}]: ${e.message}`);
    }
  }

  throw new Error(`A API do Google recusou a conexão:\n${errs.join('\n')}`);
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
  
  let mimeType = "image/jpeg";
  if (fileBase64.includes(';base64,')) {
    mimeType = fileBase64.split(';base64,')[0].split(':')[1];
  }

  const inventoryContext = inventory?.slice(0, 40).map(i => i.name).join(' | ') || 'Vazio';
  const customerContext = customers?.slice(0, 40).map(c => c.name).join(' | ') || 'Vazio';

  const payload = {
    contents: [{
      parts: [
        { text: `Aja como um scanner de etiquetas logísticas brasileiras. 
        Extraia as informações para JSON.
        
        REFERÊNCIAS (Se a leitura estiver borrada, use estas listas para corrigir):
        PRODUTOS: ${inventoryContext}
        CLIENTES: ${customerContext}

        Campos Obrigatórios: customerName, location, cep, address, bairro, orderId, nf, rastreio, modalidade, productName, quantity.
        Retorne APENAS o JSON puro.` },
        { inlineData: { mimeType: mimeType, data: b64Data } }
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
  
  // ==========================================
  // FILTRO FORÇA BRUTA: 3 PASSES DE LIMPEZA
  // ==========================================
  
  // 1º Passe: Sanitização Brutal (Mata lixo de OCR como & > { ] | })
  let cleanText = text.replace(/[&>\[\]{}|\\_~@]/g, ' ');

  // 2º Passe: Correção de Quebras de Linha e Espaçamentos Duplos
  cleanText = cleanText.replace(/\n\s*\n/g, '\n'); // Remove linhas em branco duplas
  cleanText = cleanText.replace(/\s{2,}/g, ' '); // Diminui espaços múltiplos para 1

  // 3º Passe: "Cola" palavras-chave que o OCR separou (ex: C E P  -> CEP)
  cleanText = cleanText.replace(/\bC\s*E\s*P\b/gi, 'CEP');
  cleanText = cleanText.replace(/\bN\s*F\b/gi, 'NF');

  console.log("🧹 Texto após 3 Passes de Limpeza (Força Bruta):", cleanText);

  // Lista de palavras-chave que marcam o início de novos campos
  const keywords = '(?:Cliente|Destino|CEP|Pedido|NF|Produto|Quantidade|Endereço|Bairro|Rastreio|Modalidade|Nome|Destinatário|Remetente)';
  const fieldEnd = `(?=\\s*${keywords}|\\n|$)`;

  const extract = (regex) => {
    const match = cleanText.match(regex);
    return (match && match[1]) ? match[1].trim() : null;
  };

  // Formato DESTINATÁRIO — nome fica na linha seguinte ao bloco
  let customerName = extract(new RegExp(`(?:Cliente|Destinatário|Nome)(?:\\s*\\(PESSOA\\))?[:\\s]*(.+?)${fieldEnd}`, 'i')) || 
                     extract(/DESTINAT[ÁA]RIO\s*\n([^\n]+)/i) || 
                     extract(new RegExp(`Nome:\\s*(.+?)${fieldEnd}`, 'i'));

  // Fallback: Se não encontrou por rótulo, tenta pegar a primeira linha válida 
  if (!customerName) {
    const lines = cleanText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    // Só aceita a primeira linha como nome se não contiver ":" e não for uma palavra-chave de campo
    if (lines.length > 0 && !lines[0].includes(':') && !new RegExp(`^${keywords}`, 'i').test(lines[0])) {
      customerName = lines[0];
    }
  }

  const cep = extract(/CEP(?::|\s+)?\s*(\d{2}\.?\d{3}-?\d{3})/i) || (cleanText.match(/\b\d{2}\.?\d{3}-?\d{3}\b/)?.[0]);
  const orderId = extract(/(?:Pedido|Ref|ID)[:\s]*([#a-zA-Z0-9-]+)/i) || extract(/#(\d{4,10})\b/i);
  const nf = extract(/NF[:\s]*(\d+)/i) || extract(/Nota Fiscal[:\s]*(\d+)/i);
  const rastreio = extract(/(?:Rastreio|Tracking)[:\s]*([A-Z]{2}\d{9,13}[A-Z\d]*)/i) || (cleanText.match(/\b[A-Z]{2}\d{9,13}[A-Z\d]*\b/)?.[0]);
  const bairro = extract(/Bairro[:\s]*([^,\n|]+)/i); 
  const modalidade = extract(/Modalidade(?: de Envio)?[:\s]*([^,\n|]+)/i);

  // Cidade: tenta campo explícito, depois detecta "Cidade, Estado" ou "Cidade - UF"
  let location = extract(/Destino(?: \(CIDADE OU CEP\))?[:\s]*([^,\n|]+)/i) || 
                  extract(/Cidade[:\s]*([^,\n|]+)/i);

  if (!location) {
    const estados = 'Acre|Alagoas|Amapá|Amazonas|Bahia|Ceará|Espírito Santo|Goiás|Maranhão|Mato Grosso do Sul|Mato Grosso|Minas Gerais|Pará|Paraíba|Paraná|Pernambuco|Piauí|Rio de Janeiro|Rio Grande do Norte|Rio Grande do Sul|Rondônia|Roraima|Santa Catarina|São Paulo|Sergipe|Tocantins|Distrito Federal|AC|AL|AP|AM|BA|CE|ES|GO|MA|MS|MT|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO|DF';
    const cidadeEstado = cleanText.match(new RegExp(`(?:^|\\n|,|\\s)([^,\\n\\d]+)[,\\s-]+(${estados})\\b`, 'i'));
    if (cidadeEstado) location = `${cidadeEstado[1].trim()} - ${cidadeEstado[2].toUpperCase()}`;
  }

  // Endereço (Pegar a linha inteira até o \n)
  let address = extract(/Endereço(?: Completo)?[:\s]*([^\n|]+)/i) || 
                 extract(/(\b(?:Rua|Av\.|Avenida|Travessa|Al\.|Alameda|Rod\.|Rodovia)\s+[^\n|]+)/i);

  // Extração de Produto e Quantidade
  let productName = extract(/Produto[:\s]*\n?\s*([^,\n|]+)/i);
  let quantityText = extract(/Quantidade[:\s]*(\d+)/i) || extract(/\bx\s*(\d+)\b/i) || extract(/\b(\d+)\s*un\b/i);
  let quantity = quantityText ? Number(quantityText) : 1;

  // Fallback para o formato antigo (ex: "Produto X, e quantidade Ex: 2")
  if (!productName) {
    const productLine = cleanText.split('\n').find(line => line.toLowerCase().includes(', e quantidade'));
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
export async function analyzeOrderText(inputText, inventory, customers, isCooldownActive = false) {
  const inventoryContext = inventory?.slice(0, 50).map(i => i.name).join(', ') || 'Vazio';
  const customerContext = customers?.slice(0, 50).map(c => c.name).join(', ') || 'Vazio';

  // 1. Tenta extrair localmente como fallback eterno
  const localData = extractTextLocally(inputText);
  
  // Confiança: Verifica quão completa foi a extração burra
  const isHighQuality = localData && 
                        localData.customerName && 
                        localData.customerName.length > 3 && 
                        !localData.customerName.includes('&') &&
                        localData.cep && 
                        localData.location &&
                        localData.orderId && // Agora exige que tenha pedido
                        localData.bairro;    // E exige que tenha bairro

  // Só desiste de usar IA se o texto lido localmente estiver PERFEITO
  if (isHighQuality && !groqApiKey) {
    return localData;
  }

  // Se o cooldown do Gemini estiver ativo (e não tiver Groq), a gente bloqueia e devolve o local
  if (isCooldownActive && !groqApiKey) {
    if (localData && (localData.customerName || localData.rastreio)) return localData;
    throw new Error("A extração offline não reconheceu o formato completo. Aguarde a IA voltar.");
  }

  // 2. Manda para a IA Limpadora com prompt completo
  const promptText = `Você é um extrator de dados de etiquetas de envio brasileiras.

CONTEXTO DE INVENTÁRIO (use para corrigir nomes): [${inventoryContext}]
CONTEXTO DE CLIENTES (use para corrigir nomes): [${customerContext}]

Leia o texto sujo de OCR abaixo e extraia TODOS os campos disponíveis para formato JSON. 
Se o nome estiver apenas como uma letra ("A"), mas o endereço estiver completo, ignore a letra e retorne null para o cliente, ou use o contexto para deduzir caso seja o remetente.

Retorne APENAS um objeto JSON válido (obrigatório começar com { e terminar com }) com esta estrutura:
{
  "customerName": "Nome completo do destinatário",
  "location": "Cidade do destinatário",
  "cep": "CEP",
  "address": "Endereço completo",
  "bairro": "Bairro",
  "orderId": "Número do pedido",
  "nf": "Nota fiscal",
  "rastreio": "Código de rastreio",
  "modalidade": "Modalidade",
  "productName": "Nome do produto",
  "quantity": 1
}

TEXTO DA ORDEM:
"""
${inputText}
"""`;

  try {
    let aiResponseText = "";
    
    // Se a Groq Key existir, roteia para o LLaMA 3 (Imune a limites estritos gratuitos de OCR Text)
    if (groqApiKey) {
      console.log("🚀 Roteando limpeza para LLaMA 3 via Groq Cloud...");
      aiResponseText = await callGroqDirect(promptText);
    } else {
      console.log("🚦 Roteando para Gemini Text via Google AI...");
      const payload = { contents: [{ parts: [{ text: promptText }] }] };
      aiResponseText = await callGeminiDirectV1beta(payload);
    }

    return extractJson(aiResponseText) || localData; // Se extração json falhar, retorna localData
  } catch (e) {
    if (e.message.includes("Limite") || e.message.includes("LIMITE_EXCEDIDO") || e.message.includes("429")) {
      console.warn("⚠️ API sobrecarregada (Groq/Gemini)! Retornando os dados locais Brutos que restam.");
      return localData; 
    }
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
