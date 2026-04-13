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

export function LabelAssistant({ inventory, pessoas, addToast, onDataExtracted }) {
  const [status,        setStatus]        = useState('')
  const [dragging,      setDragging]      = useState(false)
  const [textInput,     setTextInput]     = useState('')
  const [formatted,     setFormatted]     = useState('')
  const [extractedData, setExtractedData] = useState(null)
  const [tab,           setTab]           = useState('image') // 'image' | 'text' | 'qr'

  // ── Estado do scanner QR ──────────────────────────────────────────────────
  const [scanning,   setScanning]   = useState(false)
  const [scanMsg,    setScanMsg]    = useState('Aponte a câmera para o QR Code da etiqueta')
  const [qrDetected, setQrDetected] = useState(false)

  const inputRef   = useRef(null)
  const videoRef   = useRef(null)
  const canvasRef  = useRef(null)
  const streamRef  = useRef(null)
  const rafRef     = useRef(null)

  // Para câmera quando muda de aba
  useEffect(() => {
    if (tab !== 'qr') stopCamera()
  }, [tab])

  useEffect(() => () => stopCamera(), [])

  // ── Processamento de imagem (aba Imagem) ─────────────────────────────────
  const processFile = useCallback(async (file) => {
    if (!file) return
    setStatus('🔍 Lendo imagem com OCR...')
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

  // ── Scanner QR: inicia câmera ─────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setScanning(true)
    setQrDetected(false)
    setScanMsg('Carregando scanner...')
    await loadJsQR()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setScanMsg('✅ Aponte para o QR Code da etiqueta')
        rafRef.current = requestAnimationFrame(scanFrame)
      }
    } catch {
      setScanMsg('❌ Câmera não disponível. Use "Carregar Imagem" abaixo.')
      setScanning(false)
    }
  }, [])

  // ── Scanner QR: para câmera ───────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    setScanning(false)
  }, [])

  // ── Scanner QR: loop de frames ────────────────────────────────────────────
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

  // ── Scanner QR: upload de imagem ──────────────────────────────────────────
  const handleQRImageUpload = useCallback(async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    await loadJsQR()
    setScanMsg('🔍 Analisando imagem...')
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
          setScanMsg('❌ QR Code não encontrado na imagem.')
          addToast('QR Code não encontrado na imagem.', 'warning')
        }
      }
      img.src = ev.target.result
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }, [])

  // ── Scanner QR: processa texto decodificado ───────────────────────────────
  const handleQRDecoded = useCallback(async (rawData) => {
    stopCamera()
    setQrDetected(true)
    setScanMsg(`✅ QR lido! Extraindo dados com IA...`)
    setStatus('🤖 Analisando QR Code com IA...')

    try {
      // Tenta parse como JSON do nosso próprio sistema (QRCodeManager)
      let data = null
      try {
        const parsed = JSON.parse(rawData)
        if (parsed.id && parsed.name) {
          // QR do nosso sistema — produto identificado diretamente
          const product = inventory.find(p => p.id === parsed.id || p.name === parsed.name)
          if (product) {
            data = { productName: product.name }
            setScanMsg(`✅ Produto identificado: ${product.name}`)
          }
        }
      } catch {
        // Não é JSON — é texto da etiqueta (Shopee, Correios, etc.)
      }

      // Se não resolveu como JSON, manda pro Gemini interpretar
      if (!data) {
        setScanMsg('🤖 Interpretando QR com IA...')
        data = await analyzeText(rawData, inventory, pessoas)
      }

      if (data) {
        onDataExtracted(data)
        setExtractedData(data)
        addToast('✅ QR Code lido e dados extraídos!', 'success')
        setStatus('✅ Dados extraídos do QR Code!')
        setScanMsg('✅ Pronto! Formulário preenchido abaixo.')
      } else {
        // Mesmo sem campos identificados, mostra o conteúdo bruto
        setTextInput(rawData)
        setTab('text')
        addToast('QR lido — revise os dados na aba Texto.', 'info')
        setScanMsg('⚠️ Dados não identificados. Verifique a aba Texto.')
      }
    } catch (err) {
      addToast(`Erro ao processar QR: ${err.message}`, 'error')
      setStatus(`❌ ${err.message}`)
      // Fallback: joga o conteúdo na aba de texto
      setTextInput(rawData)
      setTab('text')
    }
  }, [inventory, pessoas, stopCamera, onDataExtracted, addToast])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ marginBottom: '1.5rem' }}>

      {/* Abas */}
      <div className="flex gap-1 mb-2">
        <button
          className={`btn btn-sm ${tab === 'image' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('image')}
        >
          🖼️ Imagem / Foto
        </button>
        <button
          className={`btn btn-sm ${tab === 'qr' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('qr')}
        >
          📷 QR Code
        </button>
        <button
          className={`btn btn-sm ${tab === 'text' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('text')}
        >
          📝 Colar Texto
        </button>
      </div>

      {/* ── Aba Imagem ── */}
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

      {/* ── Aba QR Code ── */}
      {tab === 'qr' && (
        <div>
          {/* Área de vídeo */}
          <div style={{
            position: 'relative', borderRadius: 'var(--radius)', overflow: 'hidden',
            background: '#0f172a', aspectRatio: '4/3', maxHeight: 340,
          }}>
            <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover', display: scanning ? 'block' : 'none' }}
              muted playsInline />

            {/* Tela inicial (câmera parada) */}
            {!scanning && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: '0.75rem', color: '#94a3b8',
              }}>
                <span style={{ fontSize: '3rem' }}>📷</span>
                <span style={{ fontSize: '0.85rem' }}>
                  {qrDetected ? '✅ QR lido com sucesso!' : 'Câmera parada'}
                </span>
              </div>
            )}

            {/* Mira de scanner */}
            {scanning && (
              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                width: 200, height: 200,
                border: '3px solid #22c55e',
                borderRadius: 16,
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
                pointerEvents: 'none',
              }}>
                {/* Cantos decorativos */}
                {['topleft','topright','bottomleft','bottomright'].map(corner => (
                  <div key={corner} style={{
                    position: 'absolute',
                    width: 24, height: 24,
                    borderColor: '#22c55e',
                    borderStyle: 'solid',
                    borderWidth: corner.includes('top') ? '3px 0 0 0' : '0 0 3px 0',
                    ...(corner.includes('left') ? { left: -3, borderLeftWidth: 3 } : { right: -3, borderRightWidth: 3 }),
                    ...(corner.includes('top') ? { top: -3 } : { bottom: -3 }),
                    borderRadius: corner === 'topleft' ? '4px 0 0 0' : corner === 'topright' ? '0 4px 0 0' : corner === 'bottomleft' ? '0 0 0 4px' : '0 0 4px 0',
                  }} />
                ))}
              </div>
            )}
          </div>

          <canvas ref={canvasRef} style={{ display: 'none' }} />

          {/* Mensagem de status do scanner */}
          <p style={{
            marginTop: '0.5rem', fontSize: '0.8rem', textAlign: 'center',
            color: qrDetected ? '#16a34a' : 'var(--text-muted)',
          }}>
            {scanMsg}
          </p>

          {/* Botões */}
          <div className="flex gap-1" style={{ marginTop: '0.5rem' }}>
            {!scanning ? (
              <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={startCamera}>
                📷 Abrir Câmera
              </button>
            ) : (
              <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={stopCamera}>
                ⏹ Parar Câmera
              </button>
            )}

            <label className="btn btn-secondary btn-sm" style={{ flex: 1, cursor: 'pointer', textAlign: 'center' }}>
              📁 Carregar Imagem do QR
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleQRImageUpload} />
            </label>
          </div>

          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem', lineHeight: 1.5 }}>
            Lê QR Codes de etiquetas Shopee, Correios, Jadlog e outros.
            O texto decodificado é interpretado pela IA para preencher o formulário.
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
