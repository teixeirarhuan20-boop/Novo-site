/**
 * qrParser.js
 * Extrai campos úteis de QR codes de etiquetas logísticas brasileiras.
 * Suporta: Correios, Shopee, Mercado Livre, Jadlog, Amazon.
 */

/**
 * Extrai trackingCode, orderId e cep de uma string de QR code.
 * Retorna objeto com os campos encontrados (campos ausentes ficam como null).
 */
export function parseQRData(qrString) {
  if (!qrString || typeof qrString !== 'string') return {}
  const s = qrString.trim()
  const result = {}

  // ── Código de rastreio padrão (Correios, ML, Amazon) ─────────────────────
  // Padrão: 2 letras + 9 dígitos + 2 letras  (ex: BR268180022BR)
  const stdTracking = s.match(/\b([A-Z]{2}\d{9}[A-Z]{2})\b/i)
  if (stdTracking) result.trackingCode = stdTracking[1].toUpperCase()

  // ── Código longo numérico (Jadlog, Shopee interno) ────────────────────────
  // Padrão: prefixo conhecido + 10-15 dígitos (ex: BR2681800224200)
  if (!result.trackingCode) {
    const longCode = s.match(/\b(BR|JT|LB|SB|DL|PM|RR|CP|NX)\d{10,15}\b/i)
    if (longCode) result.trackingCode = longCode[0].toUpperCase()
  }

  // ── CEP ──────────────────────────────────────────────────────────────────
  const cepMatch = s.match(/\b(\d{5})-?(\d{3})\b/)
  if (cepMatch) result.cep = `${cepMatch[1]}-${cepMatch[2]}`

  // ── Order ID ─────────────────────────────────────────────────────────────
  // Captura sequências alfanuméricas longas que não sejam o tracking
  const orderCandidates = (s.match(/\b[0-9A-Z]{10,22}\b/g) || [])
  const orderId = orderCandidates.find(m =>
    m !== result.trackingCode &&
    !/^(BR|JT|LB|SB|DL|PM|RR|CP|NX)/i.test(m)
  )
  if (orderId) result.orderId = orderId

  // ── Extração de URL (Correios rastreamento, Shopee, ML) ───────────────────
  if (s.startsWith('http')) {
    try {
      const url = new URL(s)
      const params = Object.fromEntries(url.searchParams)
      if (params.objetos)  result.trackingCode = params.objetos.trim().toUpperCase()
      if (params.tracking) result.trackingCode = params.tracking.trim().toUpperCase()
      if (params.order)    result.orderId      = params.order.trim()
    } catch { /* URL malformada — segue */ }
  }

  return result
}

/**
 * Gera chave de deduplicação para evitar leitura dupla da mesma etiqueta.
 * Prioridade: trackingCode > orderId > primeiros 50 chars do QR bruto.
 */
export function qrDedupKey(qrString) {
  if (!qrString) return null
  const parsed = parseQRData(qrString)
  return parsed.trackingCode || parsed.orderId || qrString.trim().slice(0, 50)
}
