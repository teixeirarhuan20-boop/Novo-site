import { GoogleGenerativeAI } from '@google/generative-ai'
import { LUNA_TOOLS, LUNA_SYSTEM } from './lunaTools'

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
  const models = ['gemini-2.0-flash', 'gemini-2.0-flash-lite']

  // Tenta todos os modelos — se todos derem 429, espera e repete (até 3 rodadas)
  for (let round = 0; round < 3; round++) {
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
        if (e.message !== 'RATE_LIMIT') throw e
        // rate limit neste modelo — tenta o próximo
      }
    }
    // Todos os modelos deram 429 nesta rodada — espera antes de tentar de novo
    if (round < 2) {
      const waitSec = (round + 1) * 7 // 7s, 14s
      console.warn(`[Gemini Text] Rate limit em todos os modelos — aguardando ${waitSec}s (rodada ${round + 1}/3)`)
      await new Promise(r => setTimeout(r, waitSec * 1000))
    }
  }
  throw new Error('⏳ Limite atingido após 3 tentativas. Tente novamente em alguns minutos.')
}

async function callGeminiVision(prompt, base64Image, mimeType) {
  if (!geminiKey) throw new Error('Chave Gemini não configurada.')
  const models = ['gemini-2.0-flash', 'gemini-2.0-flash-lite']

  // Tenta todos os modelos — se todos derem 429, espera e repete (até 3 rodadas)
  for (let round = 0; round < 3; round++) {
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
        if (e.message !== 'RATE_LIMIT') throw e
        // rate limit neste modelo — tenta o próximo
      }
    }
    // Todos os modelos deram 429 nesta rodada — espera antes de tentar de novo
    if (round < 2) {
      const waitSec = (round + 1) * 7 // 7s, 14s
      console.warn(`[Gemini Vision] Rate limit em todos os modelos — aguardando ${waitSec}s (rodada ${round + 1}/3)`)
      await new Promise(r => setTimeout(r, waitSec * 1000))
    }
  }
  throw new Error('⏳ Limite atingido após 3 tentativas. Tente novamente em alguns minutos.')
}

// ─── Exports públicos ────────────────────────────────────────────────────────

// ─── Sanitiza histórico para o padrão Gemini (user/model alternados) ─────────
function sanitizeHistory(history) {
  const raw = (history || [])
    .filter(m => m.text && !m.text.startsWith('⏳'))
    .map(m => ({
      role:  m.role === 'bot' ? 'model' : 'user',
      parts: [{ text: String(m.text) }],
    }))

  const clean = []
  for (const msg of raw) {
    const last = clean[clean.length - 1]
    if (last && last.role === msg.role) continue
    clean.push(msg)
  }
  while (clean.length > 0 && clean[0].role !== 'user') clean.shift()
  while (clean.length > 0 && clean[clean.length - 1].role !== 'model') clean.pop()
  return clean
}

// ─── Luna — Agente Autônomo com Vision + Function Calling ────────────────────
export async function sendMessageToGemini(
  history, message, inventory,
  onLeadCaptured, onOrderPlaced,   // legado (compatibilidade)
  imageData    = null,             // { base64: string, mimeType: string }
  toolExecutor = null,             // createToolExecutor(...) do lunaTools.js
) {
  if (!genAI) return 'Chat indisponível. Verifique a chave VITE_GEMINI_API_KEY no arquivo .env.'

  const inventoryList = (inventory || [])
    .slice(0, 25)
    .map(i => `- ${i.name} (Estoque: ${i.quantity} un, R$${Number(i.price).toFixed(2)})`)
    .join('\n') || 'Nenhum produto cadastrado.'

  const fullSystem = `${LUNA_SYSTEM}

ESTOQUE ATUAL:
${inventoryList}`

  const cleanHistory = sanitizeHistory(history)

  // ── Montar partes da mensagem (texto + imagem opcional) ──
  const parts = []
  if (imageData?.base64) {
    parts.push({ inlineData: { mimeType: imageData.mimeType || 'image/jpeg', data: imageData.base64 } })
  }
  parts.push({ text: message || 'Analise a imagem acima.' })

  // ── Tentar modelos Gemini em ordem de preferência ────────
  for (const modelName of ['gemini-2.0-flash', 'gemini-2.0-flash-lite']) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        tools: toolExecutor ? LUNA_TOOLS : undefined,
        systemInstruction: { parts: [{ text: fullSystem }] },
      })

      const chat = model.startChat({
        history: cleanHistory,
        generationConfig: { maxOutputTokens: 800 },
      })

      let result = await chat.sendMessage(parts)

      // ── Loop de Function Calling (máx 5 iterações) ──────
      let iterations = 0
      while (iterations < 5) {
        const calls = result.response.functionCalls?.() || []
        if (!calls.length) break
        iterations++

        // Executa todas as ferramentas em paralelo
        const toolResponses = await Promise.all(
          calls.map(async (call) => {
            let output
            try {
              if (!toolExecutor?.[call.name]) throw new Error(`Ferramenta "${call.name}" não encontrada.`)
              output = await toolExecutor[call.name](call.args)
            } catch (e) {
              output = { error: e.message }
            }
            return {
              functionResponse: {
                name:     call.name,
                response: { output: JSON.stringify(output) },
              },
            }
          })
        )

        // Envia resultados de volta para o modelo continuar
        result = await chat.sendMessage(toolResponses)
      }

      // ── Resposta final em texto ─────────────────────────
      const text = result.response.text?.()?.trim() || ''
      if (!text) return 'Ação executada com sucesso!'
      return text

    } catch (err) {
      const is429 = err.message?.includes('429') || err.message?.includes('quota') || err.message?.includes('RESOURCE_EXHAUSTED')
      if (!is429) {
        // Erro diferente de cota — retorna imediatamente
        return `Desculpe, tive um problema técnico. (${err.message?.slice(0, 100)})`
      }
      // É 429 → tenta o próximo modelo Gemini na lista
    }
  }

  // ── Fallback: Groq (llama-3.3-70b) quando Gemini está sem cota ────────────
  if (groqKey) {
    try {
      const groqMessages = [
        { role: 'system', content: fullSystem },
        ...(cleanHistory || []).slice(-6).map(m => ({
          role:    m.role === 'model' ? 'assistant' : 'user',
          content: m.parts?.[0]?.text || '',
        })),
        { role: 'user', content: message || 'Olá!' },
      ]

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:       'llama-3.3-70b-versatile',
          messages:    groqMessages,
          max_tokens:  700,
          temperature: 0.7,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || res.statusText)

      const groqText = data.choices?.[0]?.message?.content?.trim() || ''
      if (!groqText) throw new Error('Resposta vazia')

      return `⚡ *[Modo Groq — Gemini atingiu limite de uso]*\n\n${groqText}`
    } catch (groqErr) {
      return `⚠️ Todos os servidores de IA estão sobrecarregados agora. Aguarde 1 minuto e tente novamente.\n\n_Erro Groq: ${groqErr.message?.slice(0, 80)}_`
    }
  }

  return '⚠️ Limite de uso da IA Gemini atingido. Aguarde alguns minutos.\n\nDica: Adicione `VITE_GROQ_API_KEY` no seu `.env` para usar o Groq como backup automático e gratuito.'
}

export async function generateOutreachMessage(lead, inventory) {
  if (!genAI) return 'IA indisponível.'
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
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

// ─── IA de Prospecção (Ana) ───────────────────────────────────────────────────
export async function generateProspectionOutreach(history, userMessage, leadContext, inventory) {
  if (!genAI) return 'IA indisponível. Configure VITE_GEMINI_API_KEY.'
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
    const inventoryList = (inventory || []).slice(0, 15)
      .map(i => `- ${i.name} (R$${Number(i.price || 0).toFixed(2)})`)
      .join('\n') || 'Itens de decoração variados'

    const systemContext = `Você é a Ana, especialista em prospecção e vendas de itens de decoração.
Você ajuda o vendedor a encontrar e abordar clientes (lojas, decoradores, empresas) em todo o Brasil.

Seus produtos são itens de decoração (quadros, velas, vasos, almofadas, objetos decorativos, presentes, etc.).

Catálogo atual:
${inventoryList}

Lead em foco: ${leadContext || 'Nenhum lead selecionado.'}

Suas habilidades:
- Gerar mensagens de WhatsApp personalizadas e persuasivas
- Criar scripts para Instagram DM
- Sugerir abordagens por e-mail
- Dar dicas de como abordar diferentes tipos de negócio (loja, decorador, empresa)
- Identificar oportunidades de venda para cada tipo de cliente

Seja direta, prática e focada em vender. Use linguagem natural, calorosa e profissional.
Sempre que gerar uma mensagem de contato, formate claramente para o usuário poder copiar.`

    // Usa histórico de até 10 mensagens para não estourar tokens
    const safeHistory = (history || []).slice(-10)
    const chat = model.startChat({
      history: safeHistory.slice(0, -1),
      generationConfig: { maxOutputTokens: 800 },
      systemInstruction: { parts: [{ text: systemContext }] },
    })
    const result = await chat.sendMessage(userMessage)
    return result.response.text().trim()
  } catch (err) {
    return `Erro ao gerar resposta: ${err.message}`
  }
}

// ─── Redimensiona imagem para no máximo maxW pixels de largura ───────────────
// Imagens grandes (1920px+) causam timeout/falha silenciosa na API Gemini Vision
function resizeBase64(dataUrl, maxW = 960, quality = 0.88) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width)
      const w = Math.floor(img.width  * scale)
      const h = Math.floor(img.height * scale)
      const c = document.createElement('canvas')
      c.width = w; c.height = h
      c.getContext('2d').drawImage(img, 0, 0, w, h)
      resolve(c.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => resolve(dataUrl) // fallback: usa original
    img.src = dataUrl
  })
}

export async function analyzeDocument(fileBase64, inventory, customers) {
  // Redimensiona para max 960px — evita timeout no Gemini Vision
  const resized   = await resizeBase64(fileBase64, 960, 0.88)
  const b64       = resized.includes(',') ? resized.split(',')[1] : resized
  let   mimeType  = 'image/jpeg'
  if (resized.includes(';base64,')) {
    mimeType = resized.split(';base64,')[0].split(':')[1]
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
  const hasUsefulData = (r) => r && (
    r.customerName || r.orderId || r.rastreio ||
    r.address || r.cep || r.location || r.bairro
  )

  // Gemini Vision como primário
  try {
    const text = await callGeminiVision(prompt, b64, mimeType)
    console.log('[Gemini Vision] raw:', text?.slice(0, 300))
    const result = extractJson(text)
    console.log('[Gemini Vision] extracted:', JSON.stringify(result))
    if (hasUsefulData(result)) return result
    // Tem resultado mas sem campos úteis — retorna mesmo assim se tem customerName
    if (result?.customerName) return result
  } catch (e) {
    console.warn('[Gemini Vision] falhou:', e.message)
  }

  // Fallback: Groq Vision
  if (groqKey) {
    try {
      const response = await callGroq(prompt, true, b64, mimeType)
      console.log('[Groq Vision] raw:', response?.slice(0, 300))
      const result = extractJson(response)
      console.log('[Groq Vision] extracted:', JSON.stringify(result))
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
