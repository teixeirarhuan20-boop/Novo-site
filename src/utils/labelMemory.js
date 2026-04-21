/**
 * labelMemory.js
 * Estrutura de memória para aprendizado incremental de leituras de etiqueta.
 *
 * NÃO é machine learning. É um registro estruturado de correções manuais
 * que permite:
 *   1. Identificar quais campos o parser erra com mais frequência
 *   2. Armazenar padrões recorrentes para uso futuro do parser
 *   3. Fornecer base de dados para evolução futura sem re-treinamento
 *
 * Armazenamento: localStorage (persiste entre sessões, limpo no clearMemory).
 */

const STORAGE_KEY  = 'mnp_label_memory_v1'
const MAX_ENTRIES  = 300    // máximo de correções armazenadas

// ─── Estrutura interna ────────────────────────────────────────────────────────
//  {
//    corrections: [ { id, ts, original, corrected, delta, decision } ],
//    fieldStats:  { recipientName: { total, corrections }, ... },
//    patterns:    { /* para uso futuro do parser */ },
//  }

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fresh()
    return JSON.parse(raw)
  } catch {
    return fresh()
  }
}

function fresh() {
  return { corrections: [], fieldStats: {}, patterns: {} }
}

function persist(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch { /* localStorage bloqueado (Safari private, etc.) */ }
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Salva uma correção manual do usuário.
 *
 * @param {object} original  — dados lidos automaticamente
 * @param {object} corrected — dados após correção do usuário
 * @param {string} decision  — 'quick' | 'manual' (contexto em que a correção ocorreu)
 */
export function saveCorrection(original, corrected, decision = 'quick') {
  const mem = load()

  const delta = diffObjects(original, corrected)
  const changedFields = Object.keys(delta)

  // Só salva se houve alguma mudança real
  if (changedFields.length === 0) return

  mem.corrections.unshift({
    id:       Date.now(),
    ts:       new Date().toISOString(),
    decision,
    original: sanitize(original),
    corrected: sanitize(corrected),
    delta,
  })

  // Limita tamanho do histórico
  if (mem.corrections.length > MAX_ENTRIES) {
    mem.corrections = mem.corrections.slice(0, MAX_ENTRIES)
  }

  // Atualiza estatísticas por campo
  const TRACKED_FIELDS = ['recipientName', 'city', 'cep', 'orderId', 'trackingCode', 'neighborhood', 'state']
  for (const field of TRACKED_FIELDS) {
    if (!mem.fieldStats[field]) mem.fieldStats[field] = { total: 0, corrections: 0 }
    if (corrected[field] !== undefined && corrected[field] !== null) {
      mem.fieldStats[field].total++
      if (delta[field]) mem.fieldStats[field].corrections++
    }
  }

  persist(mem)
}

/**
 * Retorna sugestões baseadas em correções passadas para um dado texto bruto.
 * Útil para pré-preencher campos no QuickReview com base em histórico.
 *
 * @param {string} rawText — texto bruto do OCR atual
 * @returns {object} hints — mapa field → valor sugerido
 */
export function getPatternHints(rawText) {
  if (!rawText) return {}
  const mem  = load()
  const hints = {}

  for (const entry of mem.corrections) {
    // Verifica se o texto atual contém partes-chave de uma leitura anterior
    const origTracking = entry.original?.trackingCode || ''
    const origOrder    = entry.original?.orderId      || ''

    if (origTracking && rawText.includes(origTracking) && entry.corrected?.trackingCode) {
      hints.trackingCode = entry.corrected.trackingCode
    }
    if (origOrder && rawText.includes(origOrder) && entry.corrected?.orderId) {
      hints.orderId = entry.corrected.orderId
    }
    // Se já temos sugestões suficientes, para
    if (Object.keys(hints).length >= 3) break
  }

  return hints
}

/**
 * Retorna estatísticas de acurácia por campo.
 * Útil para mostrar ao usuário quais campos precisam de atenção.
 *
 * @returns {object} { field: { total, corrections, accuracy } }
 */
export function getAccuracyStats() {
  const mem   = load()
  const stats = {}

  for (const [field, data] of Object.entries(mem.fieldStats)) {
    stats[field] = {
      total:       data.total,
      corrections: data.corrections,
      accuracy:    data.total > 0
        ? Math.round(((data.total - data.corrections) / data.total) * 100)
        : 100,
    }
  }

  return stats
}

/**
 * Retorna quantas correções foram registradas.
 */
export function getCorrectionCount() {
  return load().corrections.length
}

/**
 * Retorna as últimas N correções.
 */
export function getRecentCorrections(n = 10) {
  return load().corrections.slice(0, n)
}

/**
 * Limpa toda a memória armazenada.
 */
export function clearMemory() {
  persist(fresh())
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

/**
 * Compara dois objetos e retorna só os campos que mudaram.
 */
function diffObjects(a = {}, b = {}) {
  const delta = {}
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of allKeys) {
    if (String(a[key] ?? '') !== String(b[key] ?? '')) {
      delta[key] = { from: a[key] ?? null, to: b[key] ?? null }
    }
  }
  return delta
}

/**
 * Remove campos desnecessários antes de persistir (economiza espaço).
 */
function sanitize(obj = {}) {
  const KEEP = ['recipientName', 'customerName', 'city', 'state', 'cep',
                'neighborhood', 'orderId', 'trackingCode', 'street',
                'addressNumber', 'confidence', 'source']
  const out = {}
  for (const k of KEEP) {
    if (obj[k] !== undefined) out[k] = obj[k]
  }
  return out
}
