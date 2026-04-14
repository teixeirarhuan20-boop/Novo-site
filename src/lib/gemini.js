import { GoogleGenerativeAI } from '@google/generative-ai'

const geminiKey = import.meta.env.VITE_GEMINI_API_KEY
const groqKey   = import.meta.env.VITE_GROQ_API_KEY

const genAI = geminiKey ? new GoogleGenerativeAI(geminiKey) : null

// ─── Helpers ────────────────────────────────────────────────────────────────

// Valida se parece um nome real (mínimo 2 chars, tem pelo menos uma letra)
function isValidName(name) {
  if (!name || typeof name !== 'string') return false
  const trimmed = name.trim()
  if (trimmed.length < 2) return false
  if (/^null$/i.test(trimmed)) return false
  if (/^n\/a$/i.test(trimmed)) return false
  return /[a-záéíóúãõâêîôûàèìòùç]/i.test(trimmed)
}

function normalizeExtracted(obj) {
  if (!obj || typeof obj !== 'object') return null
  const rawName = obj.customerName || obj.customer_name || obj.cliente
    || obj.destinatario || obj.nome || obj.recipient || obj.name || null
  return {
    customerName: isValidName(rawName) ? rawName.trim() : null,
    productName:  obj.productName  || obj.product_name  || obj.produto   || null,
    location:     obj.location     || obj.city          || obj.cidade    || null,
    cep:          obj.cep          || obj.postal_code   || null,
    address:      obj.address      || obj.endereco      || null,
    orderId:      obj.orderId      || obj.order_id      || obj.pedido    || null,
    nf:           obj.nf           || obj.nota_fiscal   || null,
    rastreio:     obj.rastreio     || obj.tracking      || null,
    bairro:       obj.bairro       || obj.neighborhood  || null,
    modalidade:   obj.modalidade   || obj.modality      || null,
    quantity:     Number(obj.quantity || obj.qtd || obj.quantidade || 1),
    email:        obj.email        || null,
    telefone:     obj.telefone     || obj.phone         || null,
    orderType:    obj.orderType    || null,
  }
}

function extractJson(text) {
  if (!text) return null
  const clean = text.replace(/```json|```/g, '').trim()
  const start = clean.indexOf('{')
  const end   = clean.lastIndexOf('}')
  if (start === -1 || end === -1) return null

  // Remove caracteres de controle e normaliza valores Python/None
  const raw = clean.substring(start, end + 1)
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/:\s*None\b/g, ': null')
    .replace(/:\s*True\b/g,  ': true')
    .replace(/:\s*False\b/g, ': false')

  // 1ª tentativa: JSON válido com aspas duplas (retorno padrão da IA)
  try {
    return normalizeExtracted(JSON.parse(raw))
  } catch { /* segue */ }

  // 2ª tentativa: IA retornou aspas simples — converte apenas chaves e valores,
  // preservando apóstrofos dentro de nomes (ex: "D'Addario", "O'Brien")
  try {
    const fixed = raw
      .replace(/'([^'\n\r]+?)'\s*:/g,  '"$1":') // 'chave': → "chave":
      .replace(/:\s*'([^'\n\r]*)'/g,   ': "$1"') // : 'valor' → : "valor"
    return normalizeExtracted(JSON.parse(fixed))
  } catch { /* segue */ }

  // 3ª tentativa: extração por regex campo a campo (fallback robusto)
  try {
    const grab = (key) => {
      const m = raw.match(new RegExp(`["']?${key}["']?\\s*:\\s*["']?([^"',}\\]]+?)["']?\\s*[,}]`))
      return m ? m[1].trim() : null
    }
    return normalizeExtracted({
      customerName: grab('customerName') || grab('cliente') || grab('destinatario'),
      productName:  grab('productName')  || grab('produto'),
      location:     grab('location')     || grab('city')    || grab('cidade'),
      cep:          grab('cep')          || grab('postal_code'),
      address:      grab('address')      || grab('endereco'),
      orderId:      grab('orderId')      || grab('order_id') || grab('pedido'),
      nf:           grab('nf')           || grab('nota_fiscal'),
      rastreio:     grab('rastreio')     || grab('tracking'),
      bairro:       grab('bairro')       || grab('neighborhood'),
      modalidade:   grab('modalidade')   || grab('modality'),
      quantity:     grab('quantity')     || grab('qtd') || grab('quantidade') || 1,
    })
  } catch {
    return null
  }
}

// ─── Chamadas diretas às APIs ────────────────────────────────────────────────

async function callGroq(prompt, isVision = false, base64Image = null, mimeType = null) {
  if (!groqKey) throw new Error('Chave Groq não configurada.')

  const content = isVision
    ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }]
    : prompt

  const body = {
    model: isVision ? 'llama-3.2-90b-vision-preview' : 'llama-3.3-70b-versatile',
    temperature: 0.1,
    messages: [{ role: 'user', content }],
    ...(!isVision && { response_format: { type: 'json_object' } }),
  }

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  if (!res.ok) {
    if (res.status === 429) throw new Error('RATE_LIMIT')
    throw new Error(data.error?.message || res.statusText)
  }
  return data.choices[0].message.content
}

async function callGeminiText(prompt) {
  if (!geminiKey) throw new Error('Chave Gemini não configurada.')
  const models = ['gemini-1.5-flash', 'gemini-2.0-flash']

  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, topP: 0.1, response_mime_type: 'application/json' },
          }),
        }
      )
      const data = await res.json()
      if (data.error?.code === 429) throw new Error('RATE_LIMIT')
      if (data.error) throw new Error(data.error.message)
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text
      if (text) return text
    } catch (e) {
      if (e.message === 'RATE_LIMIT') throw new Error('⏳ Limite de leituras atingido! Aguarde 1 minuto.')
    }
  }
  throw new Error('Todos os modelos Gemini falharam.')
}

async function callGeminiVision(prompt, base64Image, mimeType) {
  if (!geminiKey) throw new Error('Chave Gemini não configurada.')
  const models = ['gemini-1.5-flash', 'gemini-2.0-flash']

  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Image } }] }],
            generationConfig: { temperature: 0.1 },
          }),
        }
      )
      const data = await res.json()
      if (data.error?.code === 429) throw new Error('RATE_LIMIT')
      if (data.error) throw new Error(data.error.message)
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text
      if (text) return text
    } catch (e) {
      if (e.message === 'RATE_LIMIT') throw new Error('⏳ Limite atingido! Aguarde 1 minuto.')
    }
  }
  throw new Error('Visão Gemini falhou.')
}

// ─── Exports públicos ────────────────────────────────────────────────────────

export async function sendMessageToGemini(history, message, inventory, onLeadCaptured, onOrderPlaced) {
  if (!genAI) return 'Chat indisponível (chave Gemini não configurada).'

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

    const inventoryList = inventory
      .map(i => `- ${i.name} (Cat: ${i.category}, Estoque: ${i.quantity}, Preço: R$${Number(i.price).toFixed(2)})`)
      .join('\n')

    const systemPrompt = `Você é uma vendedora virtual amigável chamada Luna.
Ajude o cliente com dúvidas, preços e pedidos. Fale português brasileiro de forma natural.

INVENTÁRIO ATUAL:
${inventoryList || 'Sem produtos cadastrados.'}

Se o cliente quiser COMPRAR com nome, produto e quantidade, responda APENAS em JSON:
{"orderType":"order","customerName":"...","productName":"...","quantity":1,"location":"...","cep":null,"address":null,"bairro":null,"orderId":null,"nf":null,"rastreio":null,"modalidade":null}

Se o cliente fornecer dados de contato (lead), responda APENAS em JSON:
{"customerName":"...","email":null,"telefone":null,"productName":null}

Caso contrário, responda de forma natural e amigável.`

    let geminiHistory = history
      .map(m => ({ role: m.role === 'bot' ? 'model' : 'user', parts: [{ text: m.text }] }))

    const firstUser = geminiHistory.findIndex(m => m.role === 'user')
    geminiHistory = firstUser !== -1 ? geminiHistory.slice(firstUser) : []

    const chat = model.startChat({ history: geminiHistory })
    const result = await chat.sendMessage(`${systemPrompt}\n\nCliente: ${message}`)
    const responseText = result.response.text()

    const extracted = extractJson(responseText)

    if (extracted?.orderType === 'order' && extracted.productName && extracted.quantity > 0) {
      onOrderPlaced(extracted)
      return `Pedido de ${extracted.quantity}x **${extracted.productName}** para **${extracted.customerName}** em ${extracted.location} registrado com sucesso!`
    } else if (extracted?.customerName) {
      onLeadCaptured(extracted)
      return 'Obrigada! Anotei seus dados e em breve entraremos em contato.'
    }

    return responseText
  } catch (err) {
    return `Erro no chat: ${err.message}`
  }
}

export async function generateOutreachMessage(lead, inventory) {
  if (!genAI) return 'IA indisponível.'
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
    const inventoryList = inventory.slice(0, 10).map(i => `- ${i.name} (R$${Number(i.price).toFixed(2)})`).join('\n')
    const prompt = `Você é a Ana, assistente de vendas proativa.
Crie uma mensagem de WhatsApp curta (máx 3 frases) e amigável para o lead abaixo.

Lead: ${lead.nome || 'Cliente'}
Telefone: ${lead.telefone || 'não informado'}
Produtos disponíveis: ${inventoryList}

Mensagem:`
    const result = await model.generateContent(prompt)
    return result.response.text().trim()
  } catch {
    return 'Erro ao gerar mensagem.'
  }
}

export async function analyzeDocument(fileBase64, inventory, customers) {
  const b64 = fileBase64.includes(',') ? fileBase64.split(',')[1] : fileBase64
  let mimeType = 'image/jpeg'
  if (fileBase64.includes(';base64,')) {
    mimeType = fileBase64.split(';base64,')[0].split(':')[1]
  }

  const inventoryCtx = inventory?.slice(0, 40).map(i => i.name).join(' | ') || 'Vazio'

  const prompt = `Você é um scanner especializado em etiquetas de envio brasileiras (Shopee, Correios, Mercado Livre, Jadlog).

TAREFA: Leia TODA a imagem e extraia os dados do DESTINATÁRIO.

ESTRUTURA TÍPICA (de cima para baixo):
1. Caixa/Bloco "DESTINATÁRIO" em negrito — o texto imediatamente abaixo é o NOME DO CLIENTE
2. Linha de endereço (rua, número, complemento, cidade, estado)
3. Linhas: "Bairro: ...", "CEP: ...", "Pedido: ..."
4. QR codes, códigos de rota (SP2-2, LSP-16, etc.)
5. Código de barras = código de rastreio

CAMPOS A EXTRAIR:
- customerName: NOME COMPLETO da pessoa logo abaixo de "DESTINATÁRIO". Ex: "Laussani Pereira Campos". NUNCA use nome do remetente/vendedor.
- address: só rua + número + complemento. Ex: "Avenida Abílio Augusto Távora, 3555, Bloco 17 apto 101"
- bairro: bairro do destinatário. Ex: "Jardim Alvorada"
- cep: CEP com traço. Ex: "26265-090"
- location: só o nome da cidade. Ex: "Nova Iguaçu"
- orderId: código do pedido. Ex: "260411FTHFM6A7"
- nf: número da nota fiscal (campo NF:). Ex: "1795"
- rastreio: código de rastreio longo (começa com BR, JT, LB). Ex: "BR261423758638I"
- modalidade: código de rota ou serviço. Ex: "JDF-C", "SEDEX", "PAC"
- productName: null (a menos que algum produto abaixo combine: ${inventoryCtx})
- quantity: 1

IMPORTANTE: Se a imagem mostrar claramente o nome do destinatário, SEMPRE inclua em customerName. Não deixe null se conseguir ler.

Retorne APENAS JSON puro (sem markdown, sem explicações):
{"customerName":"...","address":"...","bairro":"...","cep":"...","location":"...","orderId":"...","nf":null,"rastreio":null,"modalidade":null,"productName":null,"quantity":1}`

  // Verifica se o resultado tem pelo menos algum campo útil
  const hasUsefulData = (r) => r && (r.customerName || r.orderId || r.rastreio || r.address || r.cep || r.location)

  // Gemini Vision como primário (mais preciso para fotos de etiqueta)
  try {
    const text = await callGeminiVision(prompt, b64, mimeType)
    console.log('[Gemini Vision] resposta bruta:', text)
    const result = extractJson(text)
    console.log('[Gemini Vision] dados extraídos:', result)
    if (hasUsefulData(result)) return result
  } catch (e) {
    console.warn('[Gemini Vision] falhou:', e.message)
  }

  // Fallback: Groq Vision
  if (groqKey) {
    try {
      const response = await callGroq(prompt, true, b64, mimeType)
      console.log('[Groq Vision] resposta bruta:', response)
      const result = extractJson(response)
      console.log('[Groq Vision] dados extraídos:', result)
      if (hasUsefulData(result)) return result
    } catch (e) {
      console.warn('[Groq Vision] falhou:', e.message)
    }
  }

  return null
}

export async function analyzeText(inputText, inventory, customers) {
  const inventoryCtx = inventory?.slice(0, 50).map(i => i.name).join(', ') || 'Vazio'
  const customerCtx  = customers?.slice(0, 50).map(c => c.name).join(', ') || 'Vazio'

  const prompt = `Você é um extrator de dados de etiquetas logísticas brasileiras (Shopee, Mercado Livre, Correios).

Regras de extração:
- customerName: nome completo do DESTINATÁRIO
- address: SOMENTE rua + número + complemento, SEM cidade e SEM estado
- bairro: bairro do destinatário
- cep: CEP com traço. Ex: "04521-000"
- location: SOMENTE nome da cidade
- orderId: código do pedido. Ex: "260410FB4GUR2T"
- nf: número da nota fiscal
- rastreio: código de rastreio (BR..., LB..., JT...)
- modalidade: código de rota como "SP2-2", "SEDEX", etc
- productName: identifique nos PRODUTOS abaixo ou null
- quantity: padrão 1

PRODUTOS: [${inventoryCtx}]
CLIENTES: [${customerCtx}]

Retorne APENAS JSON puro:
{"customerName":"...","address":"...","bairro":"...","cep":"...","location":"...","orderId":"...","nf":"...","rastreio":"...","modalidade":"...","productName":null,"quantity":1}

TEXTO DA ETIQUETA:
"""
${inputText}
"""`

  if (groqKey) {
    try {
      const response = await callGroq(prompt)
      return extractJson(response)
    } catch (e) {
      if (e.message !== 'RATE_LIMIT') console.warn('Groq falhou, usando Gemini...', e.message)
    }
  }

  const text = await callGeminiText(prompt)
  return extractJson(text)
}

export async function formatLabelText(inputText) {
  const prompt = `Leia esta etiqueta e extraia os dados em formato de lista simples:

Nome: [DADO]
Cidade: [DADO]
Bairro: [DADO]
CEP: [DADO]
Endereco: [DADO]
Pedido: [DADO]
NF: [DADO]
Rastreio: [DADO]
Modalidade: [DADO]

TEXTO:
"""
${inputText}
"""`

  try {
    return await callGeminiText(prompt)
  } catch (e) {
    return `Erro: ${e.message}`
  }
}
