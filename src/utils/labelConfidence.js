/**
 * labelConfidence.js
 * Calcula confiança por campo e confiança geral de uma leitura de etiqueta.
 *
 * Limiares:
 *   >= THRESHOLD_HIGH   → salva automaticamente (sem revisão)
 *   >= THRESHOLD_MEDIUM → revisão rápida (QuickReviewModal)
 *    < THRESHOLD_MEDIUM → revisão manual (fila normal / Gemini fallback)
 */

export const THRESHOLD_HIGH   = 68  // auto-save
export const THRESHOLD_MEDIUM = 38  // revisão rápida

/**
 * Calcula confiança de cada campo individualmente (0-100).
 *
 * @param {object} labelData — dados extraídos/mesclados
 * @param {object} source    — { qr, barcode, ocr, cepFallback, gemini }
 * @returns {object} mapa field → score
 */
export function calculateFieldConfidence(labelData, source = {}) {
  const s = {}

  // ── trackingCode ──────────────────────────────────────────────────────────
  if (labelData.trackingCode) {
    const tc = labelData.trackingCode
    if (source.qr || source.barcode) {
      s.trackingCode = 97              // QR/barcode = certeza quase total
    } else if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(tc)) {
      s.trackingCode = 88              // formato Correios perfeito via OCR
    } else if (/^[A-Z]{2}\d{8,}/.test(tc)) {
      s.trackingCode = 72              // formato parcial correto
    } else if (/^\d{10,}$/.test(tc)) {
      s.trackingCode = 60              // numérico longo
    } else {
      s.trackingCode = 45
    }
  } else {
    s.trackingCode = 0
  }

  // ── cep ───────────────────────────────────────────────────────────────────
  if (labelData.cep) {
    if (/^\d{5}-\d{3}$/.test(labelData.cep)) {
      s.cep = source.cepFallback ? 65 : 90
    } else {
      s.cep = 45
    }
  } else {
    s.cep = 0
  }

  // ── recipientName ─────────────────────────────────────────────────────────
  if (labelData.recipientName) {
    const name = labelData.recipientName.trim()
    const words = name.split(/\s+/).filter(w => w.length > 1)
    if (words.length >= 3 && name.length >= 10) {
      s.recipientName = 80             // nome completo
    } else if (words.length >= 2 && name.length >= 7) {
      s.recipientName = 65             // nome + sobrenome
    } else if (words.length >= 1 && name.length >= 4) {
      s.recipientName = 38             // só um nome
    } else {
      s.recipientName = 15
    }
    // Bônus: Gemini confirmou
    if (source.gemini) s.recipientName = Math.min(s.recipientName + 10, 95)
  } else {
    s.recipientName = 0
  }

  // ── city ──────────────────────────────────────────────────────────────────
  if (labelData.city) {
    const hasState = !!(labelData.state)
    const hasCEP   = !!(labelData.cep)
    if (hasState && hasCEP) s.city = 90
    else if (hasState)      s.city = 75
    else if (hasCEP)        s.city = 68
    else                    s.city = 45
  } else {
    s.city = 0
  }

  // ── orderId ───────────────────────────────────────────────────────────────
  if (labelData.orderId) {
    const oid = labelData.orderId
    if (source.qr) {
      s.orderId = 93
    } else if (/^\d{10,}$/.test(oid)) {
      s.orderId = 70
    } else if (/^[A-Z0-9]{10,}$/.test(oid)) {
      s.orderId = 60
    } else {
      s.orderId = 45
    }
  } else {
    s.orderId = 0
  }

  // ── neighborhood ──────────────────────────────────────────────────────────
  if (labelData.neighborhood) {
    s.neighborhood = labelData.neighborhood.length > 3 ? 65 : 35
  } else {
    s.neighborhood = 0
  }

  return s
}

/**
 * Calcula a confiança geral (0-100) ponderada pelos campos mais importantes.
 *
 * Ponderação reflete importância operacional:
 *   trackingCode → 30%
 *   recipientName→ 25%
 *   cep          → 22%
 *   orderId      → 13%
 *   city         → 10%
 */
export function calculateOverallConfidence(labelData, source = {}) {
  const fields = calculateFieldConfidence(labelData, source)

  const weights = {
    trackingCode:  0.30,
    recipientName: 0.25,
    cep:           0.22,
    orderId:       0.13,
    city:          0.10,
  }

  let weighted    = 0
  let totalWeight = 0

  for (const [field, weight] of Object.entries(weights)) {
    if (fields[field] !== undefined) {
      weighted    += fields[field] * weight
      totalWeight += weight
    }
  }

  // Se nenhum campo prioritário foi encontrado, usa campos secundários como fallback
  if (totalWeight === 0) return 0

  const base = Math.round(weighted / totalWeight)

  // Bônus: ter pelo menos 3 campos distintos com valor
  const filled = Object.values(fields).filter(v => v > 0).length
  const bonus  = filled >= 4 ? 5 : filled >= 3 ? 2 : 0

  return Math.min(base + bonus, 100)
}

/**
 * Monta o objeto de confiança completo para o labelData.
 *
 * @returns {object} { overall, recipientName, city, cep, orderId, trackingCode,
 *                     neighborhood, high, medium, low }
 */
export function buildConfidence(labelData, source = {}) {
  const fieldScores = calculateFieldConfidence(labelData, source)
  const overall     = calculateOverallConfidence(labelData, source)

  return {
    overall,
    ...fieldScores,
    high:   overall >= THRESHOLD_HIGH,
    medium: overall >= THRESHOLD_MEDIUM && overall < THRESHOLD_HIGH,
    low:    overall <  THRESHOLD_MEDIUM,
  }
}

/**
 * Retorna a decisão de fluxo baseada na confiança.
 *
 * @returns {'auto' | 'quick' | 'manual'}
 *   'auto'   → salva direto no lote
 *   'quick'  → QuickReviewModal (campos pré-preenchidos, usuário confirma rápido)
 *   'manual' → fila normal (OCR completo / Gemini fallback)
 */
export function getDecision(confidence) {
  if (!confidence) return 'manual'
  const overall = confidence.overall ?? confidence.score ?? 0
  if (overall >= THRESHOLD_HIGH)   return 'auto'
  if (overall >= THRESHOLD_MEDIUM) return 'quick'
  return 'manual'
}

/**
 * Conveniência: verifica se precisa de alguma revisão humana.
 */
export function needsReview(confidence) {
  return getDecision(confidence) !== 'auto'
}
