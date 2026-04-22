import React, { useState, useRef } from 'react'
import { analyzeDocument } from '../lib/gemini'

// ─── Crop automático: detecta região clara (etiqueta branca) ─────────────────
function cropToWhiteLabel(dataUrl) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.width; c.height = img.height
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const imgData = ctx.getImageData(0, 0, c.width, c.height)
      const { data, width, height } = imgData
      let minX = width, maxX = 0, minY = height, maxY = 0
      const BRIGHT = 175
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
          if (lum > BRIGHT) {
            if (x < minX) minX = x; if (x > maxX) maxX = x
            if (y < minY) minY = y; if (y > maxY) maxY = y
          }
        }
      }
      const w = maxX - minX, h = maxY - minY
      if (w < 80 || h < 80) { resolve(dataUrl); return }
      const PAD = 16
      const sx = Math.max(0, minX - PAD), sy = Math.max(0, minY - PAD)
      const sw = Math.min(width - sx, w + PAD * 2)
      const sh = Math.min(height - sy, h + PAD * 2)
      const out = document.createElement('canvas')
      out.width = sw; out.height = sh
      out.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
      resolve(out.toDataURL('image/jpeg', 0.93))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

// ─── Modal de câmera — idêntico ao Scanner em Lote ───────────────────────────
function CameraModal({ onCapture, onClose }) {
  const [msg,    setMsg]    = useState('Iniciando câmera...')
  const [active, setActive] = useState(false)
  const videoRef  = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)

  useEffect(() => {
    startCam()
    return () => stopCam()
  }, [])

  async function startCam() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      streamRef.current = stream
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      setActive(true)
      setMsg('Posicione a etiqueta e capture')
    } catch {
      setMsg('❌ Câmera não disponível.')
    }
  }

  function stopCam() {
    streamRef.current?.getTracks().forEach(t => t.stop())
  }

  const capture = () => {
    const v = videoRef.current
    const canvas = document.createElement('canvas')
    canvas.width  = v.videoWidth
    canvas.height = v.videoHeight
    canvas.getContext('2d').drawImage(v, 0, 0)
    stopCam()
    // Envia imagem original colorida — Gemini Vision lê muito melhor assim
    onCapture(canvas.toDataURL('image/jpeg', 0.92))
  }

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => { stopCam(); onCapture(ev.target.result) }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 3000, padding: '1rem',
    }}>
      <div className="card" style={{ maxWidth: 460, width: '100%', margin: 0 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>📷 Ler Etiqueta</h3>
            <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              Enquadre o texto do destinatário da etiqueta
            </p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => { stopCam(); onClose() }}>✕</button>
        </div>

        {/* Vídeo */}
        <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', background: '#0f172a', height: '320px' }}>
          <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
          {active && (
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%,-50%)',
              width: '85%', height: '60%',
              border: '2px solid #3b82f6', borderRadius: 8,
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
              pointerEvents: 'none',
            }} />
          )}
        </div>
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        <p style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.5rem 0' }}>{msg}</p>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-primary" style={{ flex: 2 }} onClick={capture}>
            📸 Capturar Etiqueta
          </button>
          <label className="btn btn-secondary" style={{ flex: 1, textAlign: 'center', cursor: 'pointer' }}>
            📁 Galeria
            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
          </label>
        </div>
      </div>
    </div>
  )
}

// ─── Componente principal ──────────────────────────────────────────────────────
export function LabelAssistant({ inventory, pessoas, onDataExtracted, addToast }) {
  const [showCamera,     setShowCamera]     = useState(false)
  const [isProcessing,   setIsProcessing]   = useState(false)
  const [previewUrl,     setPreviewUrl]     = useState(null)
  const [extractedData,  setExtractedData]  = useState(null)
  const [pastedText,     setPastedText]     = useState('')
  const [showTextInput,  setShowTextInput]  = useState(false)
  const [cooldown,       setCooldown]       = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(() => setCooldown(p => p - 1), 1000)
    return () => clearInterval(t)
  }, [cooldown])

  // ─── Processa imagem — Vision direto, sem OCR ────────────────────────────
  const processImage = async (base64OrDataUrl) => {
    setIsProcessing(true)
    setExtractedData(null)

    const dataUrl = base64OrDataUrl.startsWith('data:') ? base64OrDataUrl : `data:image/jpeg;base64,${base64OrDataUrl}`
    setPreviewUrl(dataUrl)

    try {
      // Crop automático: remove fundo marrom/papelão, mantém etiqueta branca
      const cropped = await cropToWhiteLabel(dataUrl)

      // Vision AI direto — muito mais preciso que OCR para etiquetas Shopee
      const result = await analyzeDocument(cropped, inventory || [], pessoas || [])

      if (result && (result.customerName || result.orderId || result.rastreio || result.location || result.cep)) {
        setExtractedData(result)
        addToast?.('✅ Etiqueta lida!', 'success')
      } else {
        addToast?.('Não foi possível extrair dados. Tente uma foto mais nítida.', 'warning')
      }
    } catch (err) {
      if (err.message?.includes('429') || err.message?.includes('Limite')) {
        setCooldown(60)
        addToast?.('⏳ Limite de IA atingido. Aguarde 1 min.', 'warning')
      } else {
        addToast?.('Erro ao processar: ' + err.message, 'error')
      }
    } finally {
      setIsProcessing(false)
    }
  }

  const handleFileInput = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => processImage(ev.target.result)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleTextAnalyze = async () => {
    if (!pastedText.trim()) return
    setIsProcessing(true)
    try {
      // Texto colado → renderiza como imagem simples e manda pro Vision
      // (mantemos analyzeText como import dinâmico apenas se disponível)
      const { analyzeText } = await import('../lib/gemini')
      const result = await analyzeText(pastedText, inventory || [], pessoas || [])
      if (result) {
        setExtractedData(result)
        addToast?.('✅ Dados extraídos do texto!', 'success')
      } else {
        addToast?.('Nenhum dado encontrado no texto.', 'warning')
      }
    } catch (err) {
      addToast?.('Erro: ' + err.message, 'error')
    } finally {
      setIsProcessing(false)
    }
  }

  const applyData = () => {
    if (!extractedData) return
    onDataExtracted(extractedData)
    setExtractedData(null)
    setPastedText('')
    setPreviewUrl(null)
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>

      {/* ── Botões de captura ── */}
      <div style={{ display: 'flex', gap: '0.55rem' }}>
        {/* Câmera */}
        <button
          type="button"
          onClick={() => setShowCamera(true)}
          style={{
            flex: 1, padding: '0.85rem 0.5rem',
            background: 'linear-gradient(135deg,#1d4ed8,#2563eb)',
            color: '#fff', border: 'none', borderRadius: 10,
            fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem',
          }}
        >
          <span style={{ fontSize: '1.4rem' }}>📷</span>
          Câmera
        </button>

        {/* Galeria */}
        <label style={{
          flex: 1, padding: '0.85rem 0.5rem',
          background: 'linear-gradient(135deg,#0f766e,#0d9488)',
          color: '#fff', borderRadius: 10,
          fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem',
        }}>
          <span style={{ fontSize: '1.4rem' }}>🖼️</span>
          Galeria
          <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={handleFileInput} />
        </label>

        {/* Texto */}
        <button
          type="button"
          onClick={() => setShowTextInput(v => !v)}
          style={{
            flex: 1, padding: '0.85rem 0.5rem',
            background: showTextInput ? 'linear-gradient(135deg,#7c3aed,#6d28d9)' : '#1e293b',
            color: showTextInput ? '#fff' : '#94a3b8',
            border: showTextInput ? 'none' : '1px solid #334155',
            borderRadius: 10, fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem',
          }}
        >
          <span style={{ fontSize: '1.4rem' }}>📋</span>
          Texto
        </button>
      </div>

      {/* ── Campo de texto colado ── */}
      {showTextInput && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <textarea
            value={pastedText}
            onChange={e => setPastedText(e.target.value)}
            placeholder="Cole aqui o texto da etiqueta (Shopee, Mercado Livre, Correios...)"
            rows={5}
            style={{
              resize: 'vertical', padding: '0.75rem',
              borderRadius: 10, border: '1px solid #334155',
              background: '#0f172a', color: '#e2e8f0',
              fontSize: '0.82rem', lineHeight: 1.5, fontFamily: 'inherit',
            }}
          />
          <button
            type="button"
            onClick={handleTextAnalyze}
            disabled={isProcessing || !pastedText.trim()}
            style={{
              padding: '0.65rem', borderRadius: 10,
              background: pastedText.trim() ? '#7c3aed' : '#1e293b',
              color: '#fff', border: 'none', fontWeight: 700,
              fontSize: '0.85rem', cursor: 'pointer',
              opacity: isProcessing ? 0.7 : 1,
            }}
          >
            {isProcessing ? '⏳ Processando...' : '🤖 Extrair Dados do Texto'}
          </button>
        </div>
      )}

      {/* ── Preview + loading ── */}
      {isProcessing && (
        <div style={{
          background: '#0f172a', borderRadius: 12, padding: '1rem',
          border: '1px solid #1e293b', textAlign: 'center',
        }}>
          {previewUrl && (
            <img src={previewUrl} alt="preview" style={{
              maxHeight: 80, borderRadius: 6,
              border: '1px solid #334155', display: 'block', margin: '0 auto 0.6rem',
            }} />
          )}
          <div style={{ height: 4, background: 'linear-gradient(90deg,#3b82f6,#8b5cf6)', borderRadius: 10, marginBottom: '0.4rem', animation: 'pulse 1s infinite' }} />
          <span style={{ fontSize: '0.76rem', color: '#94a3b8' }}>🤖 Analisando com Gemini Vision...</span>
        </div>
      )}

      {/* ── Miniatura + resultado ── */}
      {!isProcessing && previewUrl && !extractedData && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.6rem 0.8rem', background: '#0f172a', borderRadius: 10, border: '1px solid #334155' }}>
          <img src={previewUrl} alt="preview" style={{ width: 48, height: 48, borderRadius: 6, objectFit: 'cover', border: '1px solid #334155', flexShrink: 0 }} />
          <span style={{ color: '#64748b', fontSize: '0.8rem' }}>Nenhum dado reconhecível. Tente outra imagem.</span>
        </div>
      )}

      {/* ── Dados Extraídos ── */}
      {extractedData && (
        <div style={{
          background: 'rgba(16,163,127,0.06)',
          border: '1px solid rgba(16,163,127,0.35)',
          borderRadius: 12, padding: '1rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            {previewUrl && (
              <img src={previewUrl} alt="prev" style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover', border: '1px solid #334155', flexShrink: 0 }} />
            )}
            <div>
              <div style={{ fontWeight: 700, color: '#10a37f', fontSize: '0.88rem' }}>✅ Dados encontrados</div>
              <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>Revise e clique em "Usar dados"</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem 1rem', fontSize: '0.8rem', marginBottom: '0.85rem' }}>
            {[
              ['👤 Cliente',   extractedData.customerName],
              ['📍 Cidade',    extractedData.location],
              ['📮 CEP',       extractedData.cep],
              ['🔖 Pedido',    extractedData.orderId],
              ['🧾 NF',        extractedData.nf],
              ['📦 Rastreio',  extractedData.rastreio],
              ['🚚 Modalidade',extractedData.modalidade],
              ['🏷️ Produto',   extractedData.productName],
            ].filter(([, v]) => v).map(([label, value]) => (
              <div key={label} style={{ minWidth: 0 }}>
                <span style={{ color: '#64748b' }}>{label}:</span>
                <div style={{ color: '#1e293b', fontWeight: 600, wordBreak: 'break-word' }}>{value}</div>
              </div>
            ))}
            {extractedData.address && (
              <div style={{ gridColumn: '1 / -1' }}>
                <span style={{ color: '#64748b' }}>🏠 Endereço:</span>
                <div style={{ color: '#1e293b', fontWeight: 600 }}>{extractedData.address}</div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={applyData}
              style={{
                flex: 1, padding: '0.7rem', borderRadius: 10,
                background: '#10a37f', color: '#fff',
                border: 'none', fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer',
              }}
            >
              ⚡ Usar dados no formulário
            </button>
            <button
              type="button"
              onClick={() => { setExtractedData(null); setPreviewUrl(null) }}
              style={{
                padding: '0.7rem 1rem', b