/**
 * labelParser.js
 * Parser especializado em etiquetas de envio brasileiras.
 * Suporta: Correios, Shopee, Mercado Livre, Jadlog, Amazon BR, Total Express.
 *
 * Não requer API — funciona 100% local com o texto bruto do OCR.
 */

// ─── Palavras genéricas a ignorar como nome ──────────────────────────────────
const GENERIC_WORDS = new Set([
  'DESTINATARIO', 'DESTINATÁRIO', 'REMETENTE', 'RESIDENCIAL', 'COMERCIAL',
  'PEDIDO', 'CEP', 'BAIRRO', 'RUA', 'AV', 'AVENIDA', 'LOGRADOURO',
  'ENDEREÇO', 'ENDERECO', 'CIDADE', 'ESTADO', 'NÚMERO', 'NUMERO',
  'COMPLEMENTO', 'RASTREIO', 'RASTREAMENTO', 'CÓDIGO', 'CODIGO',
  'VOLUME', 'PESO', 'FRETE', 'NOTA', 'FISCAL', 'DESTINATARIO:',
  'CORREIOS', 'SHOPEE', 'MERCADO', 'LIVRE', 'JADLOG', 'AMAZON',
  'LOGISTICA', 'LOGÍSTICA', 'TOTAL', 'EXPRESS', 'TRANSPORTADORA',
  'REMETENTE:', 'DESTINATÁRIO:', 'PARA:', 'DE:',
])

// ─── Padrões de código de rastreio ───────────────────────────────────────────
const TRACKING_PATTERNS = [
  /\b([A-Z]{2}\d{9}[A-Z]{2})\b/,           // Correios padrão: AA123456789BR
  /\b([A-Z]{2}\d{8}[A-Z]{2})\b/,           // Correios curto
  /\b(BR\d{13,15})\b/,                      // Shopee/ML BR longo
  /\b(JT\d{10,15})\b/,                      // Jadlog
  /\b(NX\d{10,15})\b/,                      // Nexlog
  /\b(DL\d{10,15})\b/,                      // DHL BR
  /\b(TX\d{10,15})\b/,                      // Total Express
  /\b(PM\d{8,9}BR)\b/i,                     // PAC/SEDEX alternativo
  /\b(LB\d{10,15})\b/,                      // Loggi
  /\b(SB\d{10,15})\b/,                      // Sequoia/Braspress
]

// ─── UFs brasileiras ─────────────────────────────────────────────────────────
const UF_SET = new Set([
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA',
  'MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN',
  'RS','RO','RR','SC','SP','SE','TO',
])
const UF_PATTERN = /\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/

// ─── Prefixos de logradouro ───────────────────────────────────────────────────
const STREET_PREFIXES = [
  'RUA', 'R.', 'R ', 'AV.', 'AV ', 'AVENIDA', 'TRAVESSA', 'TRAV.',
  'TV.', 'ALAMEDA', 'AL.', 'ESTRADA', 'ROD.', 'RODOVIA',
  'PRAÇA', 'PRACA', 'PC.', 'LARGO', 'VIA ', 'VIELA', 'SERVIDÃO',
]

// ─── Prefixos de bairro ───────────────────────────────────────────────────────
const NEIGHBORHOOD_PREFIXES = ['BAIRRO ', 'BRO.', 'B. ', 'BAIRRO:']

/**
 * Normaliza o texto bruto do OCR antes de parsear.
 * Remove artefatos comuns, normaliza espaços e quebras de linha.
 */
export function normalizeOCRText(rawText) {
  if (!rawText) return ''
  return rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Artefatos comuns do Tesseract
    .replace(/[|¡¦]/g, 'I')
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    // Normaliza múltiplos espaços dentro da linha (mantém quebras)
    .replace(/[ \t]{2,}/g, ' ')
    // Remove linhas com só símbolos (barcode noise)
    .split('\n')
    .filter(l => {
      const stripped = l.replace(/[^a-zA-ZÀ-ú0-9]/g, '')
      return stripped.length >= 2
    })
    .join('\n')
    .trim()
}

/**
 * Parser principal.
 * Recebe texto bruto normalizado do OCR e retorna campos extraídos.
 *
 * @param {string} rawText — texto normalizado do OCR (use normalizeOCRText primeiro)
 * @returns {object} campos extraídos (valores ausentes ficam null)
 */
export function parseBrazilianLabel(rawText) {
  if (!rawText) return {}

  // Separa seção do destinatário (descarta remetente e seções após)
  const destText = extractDestSection(rawText)
  const lines = destText.split('\n').map(l => l.trim()).filter(Boolean)

  const result = {
    trackingCode:      null,
    orderId:           null,
    recipientName:     null,
    street:            null,
    addressNumber:     null,
    addressComplement: null,
    neighborhood:      null,
    city:              null,
    state:             null,
    cep:               null,
  }

  // ── CEP ───────────────────────────────────────────────────────────────────
  result.cep = extractCEP(rawText)

  // ── Código de rastreio ────────────────────────────────────────────────────
  result.trackingCode = extractTrackingCode(rawText)

  // ── Order ID ──────────────────────────────────────────────────────────────
  result.orderId = extractOrderId(rawText, result.trackingCode)

  // ── Estado (UF) ───────────────────────────────────────────────────────────
  const ufMatch = rawText.match(UF_PATTERN)
  if (ufMatch) result.state = ufMatch[1]

  // ── Cidade ────────────────────────────────────────────────────────────────
  const cityResult = extractCity(lines, rawText)
  if (cityResult.city)  result.city  = cityResult.city
  if (cityResult.state) result.state = cityResult.state

  // ── Destinatário ──────────────────────────────────────────────────────────
  result.recipientName = extractRecipientName(lines)

  // ── Endereço (rua, número, complemento, bairro) ───────────────────────────
  const addrResult = extractAddress(lines)
  if (addrResult.street)      result.street            = addrResult.street
  if (addrResult.number)      result.addressNumber     = addrResult.number
  if (addrResult.complement)  result.addressComplement = addrResult.complement
  if (addrResult.neighborhood) result.neighborhood     = addrResult.neighborhood
  if (addrResult.city && !result.city)   result.city   = addrResult.city
  if (addrResult.state && !result.state) result.state  = addrResult.state

  return result
}

// ═══════════════════════════════════════════════════════════════════════════════
// Funções auxiliares internas
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Isola a seção do destinatário descartando o remetente e rodapé.
 */
function extractDestSection(text) {
  const upper = text.toUpperCase()

  // Corta na seção REMETENTE (mantém só destinatário)
  const remIdx = upper.search(/\bREMETENTE\b/)
  const destText = remIdx > 0 ? text.slice(0, remIdx) : text

  // Remove linhas que são claramente do rodapé (barcode numérico puro)
  return destText
    .split('\n')
    .filter(l => !/^\s*[\d\s]{15,}\s*$/.test(l)) // linhas com só números longos = barcode
    .join('\n')
}

/**
 * Extrai CEP no formato XXXXX-XXX ou XXXXXXXX.
 */
function extractCEP(text) {
  // Formato com traço: 12345-678
  const withDash = text.match(/\b(\d{5})-(\d{3})\b/)
  if (withDash) return `${withDash[1]}-${withDash[2]}`

  // Formato sem traço junto de keyword
  const noDash = text.match(/(?:CEP|cep)[:\s]+(\d{8})\b/)
  if (noDash) return `${noDash[1].slice(0, 5)}-${noDash[1].slice(5)}`

  // Sequência de 8 dígitos isolada que parece CEP
  const raw8 = text.match(/\b(\d{5})(\d{3})\b/)
  if (raw8) return `${raw8[1]}-${raw8[2]}`

  return null
}

/**
 * Extrai código de rastreio.
 */
function extractTrackingCode(text) {
  const upper = text.toUpperCase()
  for (const pat of TRACKING_PATTERNS) {
    const m = upper.match(pat)
    if (m) return m[1]
  }
  return null
}

/**
 * Extrai Order ID (prioriza linhas com keyword).
 */
function extractOrderId(text, trackingCode) {
  const lines = text.split('\n')

  // Após keyword explícita
  const orderLinePatterns = [
    /(?:pedido|order|código|codigo|n[°º]?\s*pedido)[:\s#]+([A-Z0-9]{6,22})/i,
    /(?:nf|nota\s*fiscal)[:\s]+([A-Z0-9]{6,20})/i,
    /#([A-Z0-9]{8,22})/i,
  ]
  for (const line of lines) {
    for (const pat of orderLinePatterns) {
      const m = line.match(pat)
      if (m && m[1] !== trackingCode) return m[1].toUpperCase()
    }
  }

  // Número longo (ML usa 23 dígitos, Shopee usa 16-20)
  const longNum = text.match(/\b(\d{10,22})\b/g)
  if (longNum) {
    const candidate = longNum.find(n => n !== trackingCode?.replace(/\D/g, ''))
    if (candidate) return candidate
  }

  return null
}

/**
 * Extrai cidade + UF das linhas.
 * Padrões: "Campinas - SP", "Campinas/SP", "CAMPINAS SP", "Campinas, SP".
 */
function extractCity(lines, fullText) {
  // Padrão Cidade - UF (mais comum em etiquetas)
  const cityUFPattern = /([A-ZÀ-Úa-zà-ú][A-Za-zÀ-ú\s]{1,28}?)\s*[-\/,]\s*(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/

  for (const line of lines) {
    const m = line.match(cityUFPattern)
    if (m) {
      return { city: m[1].trim(), state: m[2] }
    }
  }

  // Padrão com CEP na mesma linha: "Campinas SP 13010-100"
  const cityWithCEP = fullText.match(/([A-Za-zÀ-ú][A-Za-zÀ-ú\s]{2,25})\s+(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\s+\d{5}/i)
  if (cityWithCEP) {
    return { city: cityWithCEP[1].trim(), state: cityWithCEP[2] }
  }

  // Linha após CEP (muitas etiquetas colocam cidade logo depois do CEP)
  for (let i = 0; i < lines.length; i++) {
    if (/\d{5}-\d{3}/.test(lines[i]) && lines[i + 1]) {
      const next = lines[i + 1].trim()
      if (next.length > 2 && next.length < 35 && !isAddress(next) && !isLikelyTrackingLine(next)) {
        // Verifica se parece cidade
        const ufInNext = next.match(UF_PATTERN)
        if (ufInNext) {
          const city = next.replace(UF_PATTERN, '').replace(/[-\/,\s]+$/, '').trim()
          return { city, state: ufInNext[1] }
        }
        return { city: next, state: null }
      }
    }
  }

  return { city: null, state: null }
}

/**
 * Extrai o nome do destinatário.
 * Estratégia: primeiro tenta após keyword, depois heurística.
 */
function extractRecipientName(lines) {
  const destKeywords = [
    'DESTINATÁRIO', 'DESTINATARIO', 'DEST:', 'DEST.', 'PARA:', 'PARA ',
    'AO SR', 'À SRA', 'AO:', 'NOME:', 'CLIENTE:',
  ]

  // Keyword na linha → próxima linha é o nome
  for (let i = 0; i < lines.length - 1; i++) {
    const up = lines[i].toUpperCase().trim()
    if (destKeywords.some(kw => up === kw || up === kw.replace(':', ''))) {
      const candidate = lines[i + 1]
      if (candidate && isLikelyName(candidate)) return normalizeName(candidate)
    }
  }

  // Keyword na mesma linha: "DESTINATÁRIO: João Silva"
  for (const line of lines) {
    const up = line.toUpperCase()
    for (const kw of destKeywords) {
      const idx = up.indexOf(kw)
      if (idx !== -1) {
        const after = line.slice(idx + kw.length).replace(/^[:.\s]+/, '').trim()
        if (after.length >= 4 && isLikelyName(after)) return normalizeName(after)
      }
    }
  }

  // Heurística: primeira linha que parece nome próprio e não é endereço/CEP/tracking
  for (const line of lines) {
    if (
      line.length >= 5 && line.length <= 60 &&
      isLikelyName(line) &&
      !isAddress(line) &&
      !isLikelyTrackingLine(line) &&
      !hasCEP(line)
    ) {
      return normalizeName(line)
    }
  }

  return null
}

/**
 * Extrai informações de endereço (rua, número, complemento, bairro).
 */
function extractAddress(lines) {
  const result = {}

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineUp = line.toUpperCase()

    // ── Rua/Logradouro ───────────────────────────────────────────────────
    if (!result.street) {
      const prefixFound = STREET_PREFIXES.find(p => lineUp.startsWith(p) || lineUp.includes(' ' + p))
      if (prefixFound) {
        // Tenta extrair número e complemento: "Rua das Flores, 123 - Apto 21"
        const addrMatch = line.match(
          /^(.+?)[,\s]+n?[°º]?\s*(\d+[A-Za-z]?)\s*(?:[-–,/]\s*(.+))?$/
        )
        if (addrMatch) {
          result.street    = addrMatch[1].trim()
          result.number    = addrMatch[2].trim()
          if (addrMatch[3]) result.complement = addrMatch[3].trim()
        } else {
          result.street = line.trim()
        }
      }
    }

    // ── Bairro ────────────────────────────────────────────────────────────
    if (!result.neighborhood) {
      const neighPrefix = NEIGHBORHOOD_PREFIXES.find(p => lineUp.startsWith(p))
      if (neighPrefix) {
        result.neighborhood = line.slice(neighPrefix.length).replace(/^[:.\s]+/, '').trim()
      }
    }

    // ── Cidade-UF na linha do endereço ────────────────────────────────────
    if (!result.city) {
      const cityM = line.match(
        /([A-ZÀ-Úa-zà-ú][A-Za-zÀ-ú\s]{1,25})\s*[-\/,]\s*(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/i
      )
      if (cityM) {
        result.city  = cityM[1].trim()
        result.state = cityM[2].toUpperCase()
      }
    }
  }

  return result
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isLikelyName(text) {
  if (!text || text.length < 4) return false
  const upper = text.toUpperCase().trim()

  // Rejeita palavras genéricas
  if (GENERIC_WORDS.has(upper)) return false
  if ([...GENERIC_WORDS].some(w => upper.startsWith(w + ' ') || upper.startsWith(w + ':'))) return false

  // Rejeita se tiver CEP, número longo, email, URL
  if (/\d{5}-\d{3}/.test(text)) return false
  if (/\d{6,}/.test(text)) return false
  if (/@|http|www\./i.test(text)) return false

  // Rejeita se for endereço
  if (isAddress(text)) return false

  // Rejeita se for linha de rastreio
  if (isLikelyTrackingLine(text)) return false

  // Rejeita se for só números e símbolos
  if (/^[\d\s\-\/\.]+$/.test(text)) return false

  // Aceita se tiver ao menos 2 palavras com 2+ letras cada
  const words = text.trim().split(/\s+/).filter(w => /[a-zA-ZÀ-ú]{2,}/.test(w))
  return words.length >= 2
}

function isAddress(text) {
  return STREET_PREFIXES.some(p =>
    text.toUpperCase().startsWith(p) || text.toUpperCase().includes(' ' + p + ' ')
  )
}

function isLikelyTrackingLine(text) {
  const up = text.toUpperCase()
  return TRACKING_PATTERNS.some(p => p.test(up)) || /^[A-Z]{2}\d{8,}/.test(up)
}

function hasCEP(text) {
  return /\d{5}-\d{3}/.test(text)
}

/**
 * Normaliza o nome: Title Case, remove caracteres inválidos.
 */
function normalizeName(name) {
  return name
    .trim()
    .replace(/[^a-zA-ZÀ-ú\s\-']/g, '')
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(w => {
      if (w.length <= 2) return w.toUpperCase()           // MG, SP, etc
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    })
    .join(' ')
    .trim()
}
