import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
const groqApiKey = import.meta.env.VITE_GROQ_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

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
      .replace(/:\s*None/g, ': null')
      .replace(/:None/g, ':null')
      .replace(/True/g, 'true')
      .replace(/False/g, 'false');

    try {
      let obj = JSON.parse(rawJson);
      return {
        customerName: obj.nome_cliente || obj.customerName || obj.customer_name || obj.cliente || obj.destinatario || obj.destinatário || "",
        productName: obj.productName || obj.product_name || obj.produto || "",
        location: obj.location || obj.city || obj.cidade || "",
        cep: obj.cep || obj.postal_code || obj.postal || "",
        address: obj.endereco_completo || obj.address || obj.endereco || "",
        orderId: obj.id_pedido || obj.orderId || obj.order_id || obj.pedido || obj.id || "",
        nf: obj.nf || obj.nota_fiscal || obj.invoice || "",
        rastreio: obj.rastreio || obj.tracking || obj.codigo_rastreio || "",
        bairro: obj.bairro || obj.neighborhood || "",
        modalidade: obj.modalidade || obj.modality || "",
        remetente: obj.remetente || obj.sender || "",
        quantity: Number(obj.quantity || obj.qtd || obj.quantidade || 1),
        productId: obj.productId || obj.product_id || "",
        customerId: obj.customerId || obj.customer_id || "",
        email: obj.email || "",
        telefone: obj.telefone || obj.phone || "",
        orderType: obj.orderType || ""
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
  if (!genAI) return "Chat indisponível (chave Gemini não configurada).";
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
  if (!genAI) return "Mensagem indisponível.";
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
async function callGroqVisionDirect(promptText, base64Image, mimeType) {
  if (!groqApiKey) throw new Error("Chave da Groq não configurada.");
  
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${groqApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-3.2-90b-vision-preview", // Modelo de visão nativo do Groq
      temperature: 0.1,
      messages: [{ 
        role: "user", 
        content: [
          { type: "text", text: promptText },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } }
        ]
      }]
    })
  });
  
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 429) throw new Error("LIMITE_EXCEDIDO");
    throw new Error(`Groq Vision Erro: ${data.error?.message || response.statusText}`);
  }
  
  return data.choices[0].message.content;
}

export async function analyzeOrderDocument(fileBase64, inventory, customers) {
  const b64Data = fileBase64.includes(',') ? fileBase64.split(',')[1] : fileBase64;
  
  let mimeType = "image/jpeg";
  if (fileBase64.includes(';base64,')) {
    mimeType = fileBase64.split(';base64,')[0].split(':')[1];
  }

  const inventoryContext = inventory?.slice(0, 40).map(i => i.name).join(' | ') || 'Vazio';
  const customerContext = customers?.slice(0, 40).map(c => c.name).join(' | ') || 'Vazio';

  const promptText = `Analise esta etiqueta logística brasileira e retorne APENAS um objeto JSON estruturado, sem blocos de código markdown ou texto explicativo. Se um campo não for encontrado na imagem, retorne uma string vazia ("").

Campos obrigatórios no JSON:
{ "customerName": "", "location": "", "cep": "", "address": "", "bairro": "", "orderId": "", "nf": "", "rastreio": "", "modalidade": "", "productName": "", "quantity": 1 }

Contexto Adicional (Produtos): ${inventoryContext}`;

  // Se tiver Chave Groq, tenta usar a visão hiper-rápida do Llama 3.2 
  if (groqApiKey) {
     try {
       console.log("👁️ Acionando Groq Vision (LLaMA 3.2 90B)...");
       const groqResponse = await callGroqVisionDirect(promptText, b64Data, mimeType);
       return extractJson(groqResponse);
     } catch (e) {
       console.warn("Groq Vision falhou, caindo para Gemini...", e.message);
       // Continua para o Gemini se a Groq engasgar (fallback do fallback)
     }
  }

  const payload = {
    contents: [{
      parts: [
        { text: promptText },
        { inlineData: { mimeType: mimeType, data: b64Data } }
      ]
    }]
  };

  try {
    console.log("👁️ Acionando Gemini Vision (Google AI)...");
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
  cleanText = cleanText.replace(/\b(?:R\s*A\s*S\s*T\s*R\s*E\s*I\s*O|O\s*B\s*J\s*E\s*T\s*O)\b/gi, 'Rastreio');

  console.log("🧹 Texto após 3 Passes de Limpeza (Força Bruta):", cleanText);

  // Lista de palavras-chave que marcam o início de novos campos
  const keywords = '(?:Cliente|Destino|CEP|Pedido|Ref|NF|Produto|Quantidade|Qtd|Endereço|Bairro|Rastreio|Modalidade|Nome|Destinatário|Recebedor|Remetente)';
  const fieldEnd = `(?=\\s*${keywords}|\\n|$)`;

  const extract = (regex) => {
    const match = cleanText.match(new RegExp(regex.source, regex.flags + 'i'));
    return (match && match[1]) ? match[1].trim() : null;
  };

  // Extração de Nome mais robusta para Shopee/ML/Correios
  let customerName = extract(/(?:Destinatário|Recebedor|Entregar para|Nome|Cliente)[:\s]*(.+?)(?=\n|,|CEP|Bairro|$)/) || 
                     extract(/DESTINAT[ÁA]RIO\s*\n\s*([^\n]+)/) ||
                     extract(/(?<=DESTINAT[ÁA]RIO[:\s]).+/) ||
                     extract(/^([A-ZÀ-Ÿ][a-zÀ-ÿ]+\s[A-ZÀ-Ÿ][a-zÀ-ÿ]+(?:\s[A-ZÀ-Ÿ][a-zÀ-ÿ]*)*)$/m); // Pega primeira linha que parece um nome real

  const cep = extract(/CEP[:\s]*(\d{2}\.?\d{3}-?\d{3})/) || (cleanText.match(/\b\d{2}\.?\d{3}-?\d{3}\b/)?.[0]) || (cleanText.match(/\b\d{8}\b/)?.[0]);
  const orderId = extract(/(?:Pedido|Ref|ID|Ordem)[:\s]*([#a-zA-Z0-9-]+)/) || extract(/#(\d{4,10})\b/);
  const nf = extract(/(?:NF|Nota Fiscal)[:\s]*(\d+)/);
  const rastreio = extract(/(?:Rastreio|Tracking)[:\s]*([A-Z]{2}\d{9,13}[A-Z\d]*)/) || (cleanText.match(/\b[A-Z]{2}\d{9,13}[A-Z\d]*\b/)?.[0]);
  const bairro = extract(/Bairro[:\s]*([^,\n|]+)/); 
  const modalidade = extract(/(?:Modalidade|Envio|Serviço)[:\s]*([^,\n|]+)/);

  // Cidade: tenta campo explícito, depois detecta "Cidade, Estado" ou "Cidade - UF"
  let location = extract(/(?:Destino|Cidade|Localidade)[:\s]*([^,\n|]+)/);

  // Endereço (Pegar a linha inteira)
  let address = extract(/(?:Endereço|Logradouro)[:\s]*([^\n|]+)/) || 
                 extract(/((?:Rua|Av\.|Avenida|Travessa|Al\.|Alameda|Rod\.|Rodovia)\s+[^\n|]+)/);

  // Extração de Produto e Quantidade
  let productName = extract(/(?:Produto|Item)[:\s]*\n?\s*([^,\n|]+)/);
  let quantityText = extract(/(?:Quantidade|Qtd|Volume)[:\s]*(\d+)/) || extract(/\bx\s*(\d+)\b/) || extract(/\b(\d+)\s*un\b/);
  let quantity = quantityText ? Number(quantityText) : 1;

  // Fallback para o formato antigo da Shopee (ex: "Produto X, e quantidade Ex: 2")
  if (!productName) {
    const productLine = cleanText.split('\n').find(line => line.toLowerCase().includes(', e quantidade'));
    if (productLine) {
      const parts = productLine.split(/,\s*e quantidade/i);
      productName = parts[0].trim();
      const qtyMatch = parts[1].match(/\d+/);
      if (qtyMatch) quantity = Number(qtyMatch[0]);
    }
  }

  if (!location) {
    const estados = 'Acre|Alagoas|Amapá|Amazonas|Bahia|Ceará|Espírito Santo|Goiás|Maranhão|Mato Grosso do Sul|Mato Grosso|Minas Gerais|Pará|Paraíba|Paraná|Pernambuco|Piauí|Rio de Janeiro|Rio Grande do Norte|Rio Grande do Sul|Rondônia|Roraima|Santa Catarina|São Paulo|Sergipe|Tocantins|Distrito Federal|AC|AL|AP|AM|BA|CE|ES|GO|MA|MS|MT|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO|DF';
    const cidadeEstado = cleanText.match(new RegExp(`(?:^|\\n|,|\\s)([^,\\n\\d]+)[,\\s-]+(${estados})\\b`, 'i'));
    if (cidadeEstado) {
      // Remove ruídos comuns de OCR no início do nome da cidade (como dashes e símbolos)
      const cleanCity = cidadeEstado[1].replace(/^[\W_]+/, '').trim();
      if (cleanCity.length > 2) location = `${cleanCity} - ${cidadeEstado[2].toUpperCase()}`;
    }
  }

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
                        localData.cep && 
                        localData.location; 

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

IMPORTANTE: A etiqueta contém um REMETENTE e um DESTINATÁRIO. 
Sua missão é extrair APENAS os dados do DESTINATÁRIO (quem vai receber o pacote).
Ignore os dados do remetente (quem está enviando).

Use o contexto abaixo para corrigir erros de grafia do OCR:
PRODUTOS: [${inventoryContext}]
CLIENTES CADASTRADOS: [${customerContext}]

Retorne APENAS um objeto JSON válido (obrigatório começar com { e terminar com }) com esta estrutura:
{
  "customerName": "Nome completo do destinatário",
  "location": "Cidade/UF",
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
