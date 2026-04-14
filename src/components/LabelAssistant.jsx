import React, { useState, useRef, useCallback, useEffect } from 'react'
import Tesseract from 'tesseract.js'
import { analyzeDocument, analyzeText, formatLabelText } from '../lib/gemini'

// ─── Carrega jsQR via CDN (sem depender de npm) ──────────────────────────────
function loadJsQR() {
  return new Promise((resolve) => {
    if (window.jsQR) { resolve(window.jsQR); return }
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'
    script.onload  = () => resolve(window.jsQR)
    script.onerror = () => resolve(null)
    document.head.appendChild(script)
  })
}

// ─── Pré-processamento de contraste para melhor leitura ──────────────────────
function applyContrast(canvas, factor = 1.6) {
  const ctx = canvas.getContext('2d')
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data
  const intercept = 128 * (1 - factor)
  for (let i = 0; i < data.length; i += 4) {
    data[i]     = Math.max(0, Math.min(255, data[i]     * factor + intercept))
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] * factor + intercept))
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] * factor + intercept))
  }
  ctx.putImageData(imageData, 0, 0)
}

export function LabelAssistant({ inventory, pessoas, addToast, onDataExtracted }) {
  const [status,        setStatus]        = useState('')
  const [dragging,      setDragging]      = useState(false)
  const [textInput,     setTextInput]     = useState('')
  const [formatted,     setFormatted]     = useState('')
  const [extractedData, setExtractedData] = useState(null)
  const [tab,           setTab]           = useState('image') // 'image' | 'text' | 'camera'

  // ── Estado da câmera ──────────────────────────────────────────────────────
  const [cameraMode,  setCameraMode]  = useState('dados')   // 'dados' | 'qr'
  const [scanning,    setScanning]    = useState(false)
  const [camMsg,      setCamMsg]      = useState('')
  const [qrDetected,  setQrDetected]  = useState(false)
  const [capturing,   setCapturing]   = useState(false)     // processando foto

  const inputRef   = useRef(null)
  const videoRef   = useRef(null)
  const canvasRef  = useRef(null)
  const streamRef  = useRef(null)
  const rafRef     = useRef(null)

  // Para câmera quando muda de aba principal
  useEffect(() => {
    if (tab !== 'camera') stopCamera()
  }, [tab])

  // Para câmera ao desmontar
  useEffect(() => () => stopCamera(), [])

  // Reinicia mensagem ao mudar modo
  useEffect(() => {
    if (!scanning) return
    if (cameraMode === 'dados') {
      cancelAnimationFrame(rafRef.current)
      setCamMsg('Aponte a câmera para a etiqueta e toque em "📸 Capturar"')
    } else {
      setCamMsg('Aponte a câmera para o QR Code da etiqueta')
      rafRef.current = requestAnimationFrame(scanFrame)
    }
  }, [cameraMode])

  // ── Processamento de imagem (aba Imagem) ─────────────────────────────────
  const processFile = useCallback(async (file) => {
    if (!file) return
    setStatus('🔍 Lendo imagem com IA...')
    setFormatted('')

    try {
      let data = null

      if (file.type.startsWith('image/')) {
        const b64 = await new Promise((res, rej) => {
          const reader = new FileReader()
          reader.onload  = e => res(e.target.result)
          reader.onerror = rej
          reader.readAsDataURL(file)
        })

        setStatus('🤖 Analisando com IA...')
        try {
          data = await analyzeDocument(b64, inventory, pessoas)
        } catch {
          setStatus('📝 Usando OCR local...')
        }

        if (!data) {
          const result = await Tesseract.recognize(file, 'por+eng')
          const text   = result.data.text
          setStatus('🤖 Refinando com IA...')
          data = await analyzeText(text, inventory, pessoas)
        }
      }

      if (data) {
        onDataExtracted(data)
        setExtractedData(data)
        addToast('Etiqueta lida com sucesso!', 'success')
        setStatus('✅ Dados extraídos!')
      } else {
        addToast('Não foi possível extrair dados.', 'warning')
        setStatus('⚠️ Extração incompleta')
      }
    } catch (err) {
      addToast(`Erro: ${err.message}`, 'error')
      setStatus(`❌ ${err.message}`)
    }
  }, [inventory, pessoas, addToast, onDataExtracted])

  // ── Processamento de texto colado (aba Texto) ────────────────────────────
  const processText = useCallback(async () => {
    if (!textInput.trim()) return
    setStatus('🤖 Analisando texto...')
    try {
      const data = await analyzeText(textInput, inventory, pessoas)
      if (data) {
        onDataExtracted(data)
        setExtractedData(data)
        addToast('Dados extraídos do texto!', 'success')
        setStatus('✅ Pronto!')
      } else {
        addToast('Não consegui identificar dados.', 'warning')
        setStatus('⚠️ Nenhum dado identificado')
      }
    } catch (err) {
      addToast(`Erro: ${err.message}`, 'error')
      setStatus(`❌ ${err.message}`)
    }
  }, [textInput, inventory, pessoas, addToast, onDataExtracted])

  const formatText = useCallback(async () => {
    if (!textInput.trim()) return
    setStatus('📋 Formatando...')
    try {
      const result = await formatLabelText(textInput)
      setFormatted(result)
      setStatus('✅ Formatado!')
    } catch (err) {
      setStatus(`❌ ${err.message}`)
    }
  }, [textInput])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [processFile])

  // ── Câmera: inicia ────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setScanning(true)
    setQrDetected(false)
    setCapturing(false)
    setCamMsg('Carregando câmera...')

    if (cameraMode === 'qr') await loadJsQR()

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()

        if (cameraMode === 'dados') {
          setCamMsg('Aponte a câmera para a etiqueta e toque em "📸 Capturar"')
        } else {
          setCamMsg('Aponte para o QR Code da etiqueta')
          rafRef.current = requestAnimationFrame(scanFrame)
        }
      }
    } catch {
      setCamMsg('❌ Câmera não disponível. Use "Carregar Arquivo" abaixo.')
      setScanning(false)
    }
  }, [cameraMode])

  // ── Câmera: para ─────────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    setScanning(false)
  }, [])

  // ── Câmera: captura foto (modo Dados) ─────────────────────────────────────
  const capturePhoto = useCallback(async () => {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    setCapturing(true)
    setCamMsg('📸 Foto capturada! Extraindo dados com IA...')
    stopCamera()

    canvas.width  = video.videoWidth  || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0)
    applyContrast(canvas, 1.5)

    const b64 = canvas.toDataURL('image/jpeg', 0.92)

    try {
      setStatus('🤖 Gemini Vision lendo a etiqueta...')
      const data = await analyzeDocument(b64, inventory, pessoas)

      if (data) {
        onDataExtracted(data)
        setExtractedData(data)
        addToast('✅ Dados extraídos da etiqueta!', 'success')
        setStatus('✅ Dados extraídos!')
        setCamMsg('✅ Pronto! Formulário preenchido.')
      } else {
        addToast('IA não identificou os dados. Tente a aba "Imagem / Foto".', 'warning')
        setStatus('⚠️ Não identificou campos. Tente Imagem / Foto.')
        setCamMsg('⚠️ Tente centralizar melhor a etiqueta.')
      }
    } catch (err) {
      addToast(`Erro: ${err.message}`, 'error')
      setStatus(`❌ ${err.message}`)
      setCamMsg('❌ Erro ao processar. Tente novamente.')
    }
    setCapturing(false)
  }, [inventory, pessoas, stopCamera, onDataExtracted, addToast])

  // ── Câmera: scan loop QR ──────────────────────────────────────────────────
  const scanFrame = useCallback(() => {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(scanFrame)
      return
    }
    canvas.width  = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const code = window.jsQR?.(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert',
    })
    if (code?.data) {
      handleQRDecoded(code.data)
    } else {
      rafRef.current = requestAnimationFrame(scanFrame)
    }
  }, [])

  // ── Câmera: upload de arquivo QR ─────────────────────────────────────────
  const handleQRImageUpload = useCallback(async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    await loadJsQR()
    setCamMsg('🔍 Analisando imagem...')
    const reader = new FileReader()
    reader.onload = (ev) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width  = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = window.jsQR?.(imageData.data, imageData.width, imageData.height)
        if (code?.data) {
          handleQRDecoded(code.data)
        } else {
          setCamMsg('❌ QR Code não encontrado na imagem.')
          addToast('QR Code não encontrado na imagem.', 'warning')
        }
      }
      img.src = ev.target.result
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }, [])

  // ── Câmera: processa QR decodificado ─────────────────────────────────────
  const handleQRDecoded = useCallback(async (rawData) => {
    stopCamera()
    setQrDetected(true)
    setCamMsg('✅ QR lido! Extraindo dados com IA...')
    setStatus('🤖 Analisando QR Code com IA...')

    try {
      let data = null
      try {
        const parsed = JSON.parse(rawData)
        if (parsed.id && parsed.name) {
          const product = inventory.find(p => p.id === parsed.id || p.name === parsed.name)
          if (product) {
            data = { productName: product.name }
            setCamMsg(`✅ Produto identificado: ${product.name}`)
          }
        }
      } catch { /* não é JSON */ }

      if (!data) {
        setCamMsg('🤖 Interpretando QR com IA...')
        data = await analyzeText(rawData, inventory, pessoas)
      }

      if (data) {
        onDataExtracted(data)
        setExtractedData(data)
        addToast('✅ QR Code lido e dados extraídos!', 'success')
        setStatus('✅ Dados extraídos do QR Code!')
        setCamMsg('✅ Pronto! Formulário preenchido.')
      } else {
        setTextInput(rawData)
        setTab('text')
        addToast('QR lido — revise os dados na aba Texto.', 'info')
        setCamMsg('⚠️ Dados não identificados. Verifique a aba Texto.')
      }
    } catch (err) {
      addToast(`Erro ao processar QR: ${err.message}`, 'error')
      setStatus(`❌ ${err.message}`)
      setTextInput(rawData)
      setTab('text')
    }
  }, [inventory, pessoas, stopCamera, onDataExtracted, addToast])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ marginBottom: '1.5rem' }}>

      {/* Abas principais */}
      <div className="flex gap-1 mb-2">
        <button
          className={`btn btn-sm ${tab === 'image' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('image')}
        >
          🖼️ Imagem / Foto
        </button>
        <button
          className={`btn btn-sm ${tab === 'camera' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('camera')}
        >
          📷 Câmera
        </button>
        <button
          className={`btn btn-sm ${tab === 'text' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('text')}
        >
          📝 Colar Texto
        </button>
      </div>

      {/* ── Aba Imagem (upload) ── */}
      {tab === 'image' && (
        <div
          className={`drop-zone ${dragging ? 'dragging' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <span className="drop-zone-icon">📦</span>
          <span className="drop-zone-title">Clique ou arraste a foto da etiqueta</span>
          <span className="drop-zone-sub">PNG, JPG, WEBP — IA vai extrair os dados automaticamente</span>
          <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => processFile(e.target.files[0])} />
        </div>
      )}

      {/* ── Aba Câmera ── */}
      {tab === 'camera' && (
        <div>

          {/* Seletor de modo: Dados / QR Code */}
          <div style={{
            display: 'flex', gap: '0.5rem', marginBottom: '0.75rem',
            background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: '0.25rem',
          }}>
            <button
              onClick={() => { if (cameraMode !== 'dados') { setCameraMode('dados'); setQrDetected(false) } }}
              style={{
                flex: 1, padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm)',
                border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                transition: 'all 0.18s',
                background: cameraMode === 'dados' ? 'var(--primary)' : 'transparent',
                color: cameraMode === 'dados' ? '#fff' : 'var(--text-muted)',
              }}
            >
              📸 Dados
            </button>
            <button
              onClick={() => { if (cameraMode !== 'qr') { setCameraMode('qr'); setQrDetected(false) } }}
              style={{
                flex: 1, padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm)',
                border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                transition: 'all 0.18s',
                background: cameraMode === 'qr' ? 'var(--primary)' : 'transparent',
                color: cameraMode === 'qr' ? '#fff' : 'var(--text-muted)',
              }}
            >
              📷 QR Code
            </button>
          </div>

          {/* Área de vídeo */}
          <div style={{
            position: 'relative', borderRadius: 'var(--radius)', overflow: 'hidden',
            background: '#0f172a', aspectRatio: '4/3', maxHeight: 320,
          }}>
            <video
              ref={videoRef}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: scanning ? 'block' : 'none' }}
              muted playsInline
            />

            {/* Tela inicial */}
            {!scanning && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: '0.75rem', color: '#94a3b8',
              }}>
                <span style={{ fontSize: '3rem' }}>{cameraMode === 'dados' ? '📸' : '📷'}</span>
                <span style={{ fontSize: '0.85rem', textAlign: 'center', padding: '0 1rem' }}>
                  {qrDetected
                    ? (cameraMode === 'qr' ? '✅ QR lido com sucesso!' : '✅ Foto capturada!')
                    : (cameraMode === 'dados'
                        ? 'Modo Dados — foto da etiqueta'
                        : 'Modo QR Code — scan automático'
                      )
                  }
                </span>
              </div>
            )}

            {/* Mira — QR mode: quadrado verde com cantos */}
            {scanning && cameraMode === 'qr' && (
              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                width: 200, height: 200,
                border: '2px solid #22c55e',
                borderRadius: 12,
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
                pointerEvents: 'none',
              }}>
                {['topleft','topright','bottomleft','bottomright'].map(c => (
                  <div key={c} style={{
                    position: 'absolute', width: 22, height: 22,
                    borderColor: '#22c55e', borderStyle: 'solid',
                    borderWidth: c.includes('top') ? '3px 0 0 0' : '0 0 3px 0',
                    ...(c.includes('left') ? { left: -2, borderLeftWidth: 3 } : { right: -2, borderRightWidth: 3 }),
                    ...(c.includes('top') ? { top: -2 } : { bottom: -2 }),
                    borderRadius: c === 'topleft' ? '4px 0 0 0' : c === 'topright' ? '0 4px 0 0' : c === 'bottomleft' ? '0 0 0 4px' : '0 0 4px 0',
                  }} />
                ))}
              </div>
            )}

            {/* Mira — Dados mode: retângulo azul */}
            {scanning && cameraMode === 'dados' && (
              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '80%', height: '55%',
                border: '2px solid #3b82f6',
                borderRadius: 10,
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
                pointerEvents: 'none',
              }}>
                {['topleft','topright','bottomleft','bottomright'].map(c => (
                  <div key={c} style={{
                    position: 'absolute', width: 24, height: 24,
                    borderColor: '#3b82f6', borderStyle: 'solid',
                    borderWidth: c.includes('top') ? '3px 0 0 0' : '0 0 3px 0',
                    ...(c.includes('left') ? { left: -2, borderLeftWidth: 3 } : { right: -2, borderRightWidth: 3 }),
                    ...(c.includes('top') ? { top: -2 } : { bottom: -2 }),
                    borderRadius: c === 'topleft' ? '4px 0 0 0' : c === 'topright' ? '0 4px 0 0' : c === 'bottomleft' ? '0 0 0 4px' : '0 0 4px 0',
                  }} />
                ))}
                <div style={{
                  position: 'absolute', bottom: -26, left: '50%', transform: 'translateX(-50%)',
                  fontSize: '0.72rem', color: '#93c5fd', whiteSpace: 'nowrap',
                }}>
                  Centralize a etiqueta aqui
                </div>
              </div>
            )}
          </div>

          <canvas ref={canvasRef} style={{ display: 'none' }} />

          {/* Mensagem de status */}
          <p style={{
            marginTop: '0.5rem', fontSize: '0.78rem', textAlign: 'center', minHeight: '1.2em',
            color: (qrDetected || capturing) ? '#16a34a' : 'var(--text-muted)',
          }}>
            {camMsg}
          </p>

          {/* Botões de ação */}
          <div className="flex gap-1" style={{ marginTop: '0.5rem' }}>
            {!scanning ? (
              <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={startCamera}>
                {cameraMode === 'dados' ? '📸 Abrir Câmera' : '📷 Abrir Câmera'}
              </button>
            ) : (
              <>
                {cameraMode === 'dados' && (
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ flex: 1 }}
                    onClick={capturePhoto}
                    disabled={capturing}
                  >
                    {capturing ? '⏳ Processando...' : '📸 Capturar'}
                  </button>
                )}
                <button className="btn btn-secondary btn-sm" style={{ flex: cameraMode === 'dados' ? 0 : 1 }} onClick={stopCamera}>
                  ⏹ Parar
                </button>
              </>
            )}

            {/* Upload de arquivo (fallback) */}
            {cameraMode === 'qr' && (
              <label className="btn btn-secondary btn-sm" style={{ flex: 1, cursor: 'pointer', textAlign: 'center' }}>
                📁 Carregar Imagem do QR
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleQRImageUpload} />
              </label>
            )}
            {cameraMode === 'dados' && !scanning && (
              <label className="btn btn-secondary btn-sm" style={{ flex: 1, cursor: 'pointer', textAlign: 'center' }}>
                📁 Carregar Foto
                <input type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files[0]; if (f) processFile(f); e.target.value = '' }} />
              </label>
            )}
          </div>

          {/* Dica */}
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.5rem', lineHeight: 1.5, textAlign: 'center' }}>
            {cameraMode === 'dados'
              ? '📸 Dados: fotografa a etiqueta e a IA extrai nome, CEP, cidade, endereço e bairro.'
              : '📷 QR Code: scan automático de QR Codes de etiquetas Shopee, Correios, Jadlog e outros.'
            }
          </p>
        </div>
      )}

      {/* ── Aba Texto ── */}
      {tab === 'text' && (
        <div>
          <textarea
            value={textInput}
            onChange={e => setTextInput(e.target.value)}
            placeholder="Cole aqui o texto da etiqueta ou pedido..."
            rows={5}
            style={{ marginBottom: '0.5rem', resize: 'vertical' }}
          />
          <div className="flex gap-1">
            <button className="btn btn-primary btn-sm" onClick={processText} disabled={!textInput.trim()}>
              🤖 Extrair Dados
            </button>
            <button className="btn btn-secondary btn-sm" onClick={formatText} disabled={!textInput.trim()}>
              📋 Só Formatar
            </button>
          </div>
          {formatted && (
            <pre style={{
              marginTop: '0.75rem', padding: '0.75rem',
              background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)',
              fontSize: '0.8rem', whiteSpace: 'pre-wrap', border: '1px solid var(--border)',
            }}>
              {formatted}
            </pre>
          )}
        </div>
      )}

      {/* Status geral */}
      {status && (
        <p style={{
          marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)',
          display: 'flex', alignItems: 'center', gap: '0.4rem',
        }}>
          {status}
        </p>
      )}

      {/* Preview dos dados extraídos */}
      {extractedData && (
        <div style={{
          marginTop: '0.75rem', padding: '0.75rem',
          background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border)', fontSize: '0.8rem',
        }}>
          <div style={{ fontWeight: 600, marginBottom: '0.4rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '0.72rem' }}>
            📋 Dados Extraídos
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem 1rem' }}>
            {extractedData.customerName && <span>👤 <b>Cliente:</b> {extractedData.customerName}</span>}
            {extractedData.location     && <span>📍 <b>Cidade:</b> {extractedData.location}</span>}
            {extractedData.cep          && <span>📮 <b>CEP:</b> {extractedData.cep}</span>}
            {extractedData.bairro       && <span>🏘️ <b>Bairro:</b> {extractedData.bairro}</span>}
            {extractedData.address      && <span style={{ gridColumn: 'span 2' }}>🏠 <b>Endereço:</b> {extractedData.address}</span>}
            {extractedData.orderId      && <span>🔖 <b>Pedido:</b> {extractedData.orderId}</span>}
            {extractedData.nf           && <span>🧾 <b>NF:</b> {extractedData.nf}</span>}
            {extractedData.rastreio     && <span>📦 <b>Rastreio:</b> {extractedData.rastreio}</span>}
            {extractedData.modalidade   && <span>🚚 <b>Modalidade:</b> {extractedData.modalidade}</span>}
            {extractedData.productName  && <span>🛒 <b>Produto:</b> {extractedData.productName}</span>}
          </div>
          <button
            className="btn btn-secondary btn-sm"
            style={{ marginTop: '0.5rem', fontSize: '0.72rem' }}
            onClick={() => setExtractedData(null)}
          >
            ✕ Fechar
          </button>
        </div>
      )}
    </div>
  )
}
