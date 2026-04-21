/**
 * labelDetect.js
 * Utilitários para detecção de etiqueta em frame de câmera,
 * feedback sonoro e pré-processamento de imagem para OCR.
 */

/**
 * Verifica se o frame (canvas) provavelmente contém uma etiqueta de envio.
 * Analisa a luminosidade do centro do frame: etiquetas têm fundo claro
 * (branco) com texto escuro — padrão Shopee, Correios, ML, Jadlog.
 *
 * Retorna true se o frame passa no critério.
 */
export function hasLabelHeuristic(canvas) {
  try {
    const ctx = canvas.getContext('2d')
    const w = canvas.width
    const h = canvas.height
    if (w < 100 || h < 100) return false

    // Amostra a região central (70% × 70%) para evitar bordas/interface
    const sx = Math.floor(w * 0.15)
    const sy = Math.floor(h * 0.15)
    const sw = Math.floor(w * 0.70)
    const sh = Math.floor(h * 0.70)

    const data = ctx.getImageData(sx, sy, sw, sh).data

    let dark = 0, light = 0, n = 0
    // Analisa 1 a cada 4 pixels (performance)
    for (let i = 0; i < data.length; i += 16) {
      const lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
      if (lum < 90) dark++
      else if (lum > 170) light++
      n++
    }

    const darkRatio  = dark  / n
    const lightRatio = light / n

    // Etiqueta válida: 4–40% escuro (texto denso), 40%+ claro (fundo branco/bege)
    return darkRatio > 0.04 && darkRatio < 0.40 && lightRatio > 0.40
  } catch {
    return false
  }
}

/**
 * Emite um beep curto via Web Audio API.
 * Não requer arquivo de áudio externo.
 * @param {'success'|'pending'|'error'} type
 */
export function playBeep(type = 'success') {
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    const ac   = new AC()
    const osc  = ac.createOscillator()
    const gain = ac.createGain()
    osc.connect(gain)
    gain.connect(ac.destination)
    osc.type = 'sine'
    osc.frequency.value = type === 'success' ? 880 : type === 'pending' ? 660 : 330
    gain.gain.setValueAtTime(0.25, ac.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.22)
    osc.start(ac.currentTime)
    osc.stop(ac.currentTime + 0.22)
  } catch { /* silencioso em ambientes que bloqueiam Web Audio */ }
}

/**
 * Pré-processa um canvas para OCR:
 * - Redimensiona para no máximo maxW pixels de largura
 * - Converte para grayscale
 * - Aplica ajuste de contraste
 * Retorna dataUrl JPEG otimizado.
 */
export function preprocessCanvas(srcCanvas, maxW = 960) {
  const scale = Math.min(1, maxW / srcCanvas.width)
  const w = Math.floor(srcCanvas.width  * scale)
  const h = Math.floor(srcCanvas.height * scale)
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')
  ctx.drawImage(srcCanvas, 0, 0, w, h)

  const imgData = ctx.getImageData(0, 0, w, h)
  const pix = imgData.data
  const contrast = 50
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast))

  for (let i = 0; i < pix.length; i += 4) {
    const gray = 0.2126 * pix[i] + 0.7152 * pix[i + 1] + 0.0722 * pix[i + 2]
    const adj  = Math.max(0, Math.min(255, factor * (gray - 128) + 128))
    pix[i] = pix[i + 1] = pix[i + 2] = adj
  }
  ctx.putImageData(imgData, 0, 0)
  return out.toDataURL('image/jpeg', 0.88)
}

/**
 * Pontua os dados extraídos de 0 a 100.
 * >= 65 → alta confiança (auto-add sem revisão)
 * >= 35 → média (adiciona com aviso)
 *  < 35 → baixa (fallback para fila normal)
 */
export function scoreLabel(data) {
  if (!data) return 0
  let s = 0
  if (data.customerName && data.customerName.length > 3)     s += 30
  if ((data.rastreio || data.trackingCode)?.length > 8)      s += 25
  if (data.cep && /\d{5}-?\d{3}/.test(data.cep))            s += 20
  if ((data.orderId || '').length > 4)                       s += 15
  if ((data.location || data.city || '').length > 2)         s += 10
  if (data.bairro || data.neighborhood)                      s += 5
  if (data.address || data.street)                           s += 5
  return Math.min(s, 100)
}

/**
 * Mescla dados do QR (alta precisão) com dados do OCR.
 * QR  → prioridade em: trackingCode, orderId, cep
 * OCR → prioridade em: customerName, location, bairro, address
 *
 * Retorna objeto no formato compatível com OrderCard (campos legacy)
 * + campos novos da estrutura esperada.
 */
export function mergeData(qrParsed = {}, ocrData = {}) {
  const tracking = qrParsed.trackingCode || ocrData?.rastreio || null
  const cep      = qrParsed.cep          || ocrData?.cep      || null
  const orderId  = qrParsed.orderId      || ocrData?.orderId  || null

  return {
    // ── Campos legacy (compatíveis com OrderCard) ──────────────────────────
    customerName: ocrData?.customerName || null,
    location:     ocrData?.location     || null,
    cep,
    address:      ocrData?.address      || null,
    bairro:       ocrData?.bairro       || null,
    orderId,
    rastreio:     tracking,
    modalidade:   ocrData?.modalidade   || null,
    nf:           ocrData?.nf           || null,

    // ── Campos novos (estrutura enriquecida) ───────────────────────────────
    recipientName: ocrData?.customerName || null,
    street:        ocrData?.address      || null,
    city:          ocrData?.location     || null,
    state:         null,                           // não extraído ainda
    neighborhood:  ocrData?.bairro       || null,
    trackingCode:  tracking,
  }
}
