import React, { useState, useRef, useCallback, useEffect } from 'react'
import Tesseract from 'tesseract.js'
import { analyzeDocument, analyzeText, formatLabelText } from '../lib/gemini'

// ─── Beep de sucesso ──────────────────────────────────────────────────────────
function playBeep() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)()
    const osc  = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(1046, ctx.currentTime)
    osc.frequency.setValueAtTime(1318, ctx.currentTime + 0.07)
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22)
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.22)
  } catch {}
}

// ─── Carrega jsQR via CDN ─────────────────────────────────────────────────────
function loadJsQR() {
  return new Promise(resolve => {
    if (window.jsQR) { resolve(window.jsQR); return }
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'
    s.onload = () => resolve(window.jsQR); s.onerror = () => resolve(null)
    document.head.appendChild(s)
  })
}

// ─── Aguarda o vídeo ter frames válidos (evita captura preta) ─────────────────
function waitForVideoReady(video, maxMs = 3000) {
  return new Promise(resolve => {
    const deadline = Date.now() + maxMs
    function check() {
      if (video.readyState >= 4 && video.videoWidth > 0 && video.videoHeight > 0) {
        resolve(true)
      } else if (Date.now() > deadline) {
        resolve(false)
      } else {
        requestAnimationFrame(check)
      }
    }
    check()
  })
}

export function LabelAssistant({ inventory, pessoas, addToast, onDataExtracted }) {
  const [status,         setStatus]         = useState('')
  const [dragging,       setDragging]       = useState(false)
  const [textInput,      setTextInput]      = useState('')
  const [formatted,      setFormatted]      = useState('')
  const [extractedData,  setExtractedData]  = useState(null)
  const [tab,            setTab]            = useState('image')

  // câmera
  const [cameraMode,     setCameraMode]     = useState('dados')
  const [scanning,       setScanning]       = useState(false)
  const [camReady,       setCamReady]       = useState(false)   // câmera focou/estabilizou
  const [camMsg,         setCamMsg]         = useState('')
  const [qrDetected,     setQrDetected]     = useState(false)
  const [capturing,      setCapturing]      = useState(false)
  const [capturedPreview, setCapturedPreview] = useState(null)  // thumbnail do frame capturado
  const [captureError,   setCaptureError]   = useState(false)   // mostra botão "tentar novamente"

  const inputRef  = useRef(null)
  const videoRef  = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef    = useRef(null)

  useEffect(() => { if (tab !== 'camera') stopCamera() }, [tab])
  useEffect(() => () => stopCamera(), [])

  useEffect(() => {
    if (!scanning) return
    if (cameraMode === 'dados') {
      cancelAnimationFrame(rafRef.current)
      setCamMsg('Câmera pronta — aponte para a etiqueta e toque em Capturar')
    } else {
      setCamMsg('Aponte para o QR Code da etiqueta')
      rafRef.current = requestAnimationFrame(scanFrame)
    }
  }, [cameraMode])

  // ── Processamento de imagem (aba Imagem/arquivo) ──────────────────────────
  const processFile = useCallback(async (file) => {
    if (!file) return
    setStatus('🔍 Lendo imagem com IA...')
    setFormatted('')
    try {
      let data = null
      if (file.type.startsWith('image/')) {
        const b64 = await new Promise((res, rej) => {
          const reader = new FileReader()
          reader.onload = e => res(e.target.result); reader.onerror = rej
          reader.readAsDataURL(file)
        })
        setStatus('🤖 Analisando com IA...')
        try { data = await analyzeDocument(b64, inventory, pessoas) } catch {}
        if (!data) {
          const result = await Tesseract.recognize(file, 'por+eng')
          setStatus('🤖 Refinando com IA...')
          data = await analyzeText(result.data.text, inventory, pessoas)
        }
      }
      if (data) {
        playBeep()
        onDataExtracted(data); setExtractedData(data)
        addToast('✅ Etiqueta lida com sucesso!', 'success')
        setStatus('✅ Dados extraídos!')
      } else {
        addToast('Não foi possível extrair dados.', 'warning')
        setStatus('⚠️ Extração incompleta')
      }
    } catch (err) {
      addToast(`Erro: ${err.message}`, 'error'); setStatus(`❌ ${err.message}`)
    }
  }, [inventory, pessoas, addToast, onDataExtracted])

  // ── Processamento de texto ────────────────────────────────────────────────
  const processText = useCallback(async () => {
    if (!textInput.trim()) return
    setStatus('🤖 Analisando texto...')
    try {
      const data = await analyzeText(textInput, inventory, pessoas)
      if (data) {
        playBeep()
        onDataExtracted(data); setExtractedData(data)
        addToast('Dados extraídos do texto!', 'success'); setStatus('✅ Pronto!')
      } else {
        addToast('Não consegui identificar dados.', 'warning')
        setStatus('⚠️ Nenhum dado identificado')
      }
    } catch (err) {
      addToast(`Erro: ${err.message}`, 'error'); setStatus(`❌ ${err.message}`)
    }
  }, [textInput, inventory, pessoas, addToast, onDataExtracted])

  const formatText = useCallback(async () => {
    if (!textInput.trim()) return
    setStatus('📋 Formatando...')
    try { setFormatted(await formatLabelText(textInput)); setStatus('✅ Formatado!') }
    catch (err) { setStatus(`❌ ${err.message}`) }
  }, [textInput])

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]; if (file) processFile(file)
  }, [processFile])

  // ── Câmera: inicia ────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setScanning(true); setCamReady(false); setQrDetected(false)
    setCapturing(false); setCapturedPreview(null); setCaptureError(false)
    setCamMsg('Iniciando câmera...')
    if (cameraMode === 'qr') await loadJsQR()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      })
      streamRef.current = stream
      videoRef.current.srcObject = stream
      await videoRef.current.play()

      // Aguarda câmera estabilizar antes de habilitar captura
      const ready = await waitForVideoReady(videoRef.current)
      setCamReady(ready)

      if (cameraMode === 'dados') {
        setCamMsg(ready
          ? '✅ Câmera pronta — enquadre o DESTINATÁRIO e toque em Capturar'
          : '⚠️ Câmera iniciando, aguarde...')
      } else {
        setCamMsg('Aponte para o QR Code da etiqueta')
        rafRef.current = requestAnimationFrame(scanFrame)
      }
    } catch {
      setCamMsg('❌ Câmera não disponível. Use "Carregar Arquivo" abaixo.')
      setScanning(false)
    }
  }, [cameraMode])

  // ── Câmera: para ─────────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setScanning(false); setCamReady(false)
  }, [])

  // ── Câmera: captura foto (modo Dados) ─────────────────────────────────────
  const capturePhoto = useCallback(async () => {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    // Verifica se o vídeo tem frames válidos
    if (!video.videoWidth || !video.videoHeight) {
      setCamMsg('⚠️ Câmera ainda iniciando, aguarde um instante...')
      return
    }

    setCapturing(true); setCaptureError(false)
    setCamMsg('📸 Capturando frame...')

    // ── Captura o frame (ANTES de parar a câmera!) ────────────────────────
    const w = video.videoWidth
    const h = video.videoHeight
    canvas.width = w; canvas.height = h
    canvas.getContext('2d').drawImage(video, 0, 0, w, h)
    stopCamera()

    // Thumbnail para o usuário ver o que foi capturado
    const preview = canvas.toDataURL('image/jpeg', 0.4)
    setCapturedPreview(preview)

    const b64 = canvas.toDataURL('image/jpeg', 0.95)

    try {
      // ── 1ª tentativa: Gemini Vision ──────────────────────────────────────
      setStatus('🤖 Gemini Vision lendo a etiqueta...')
      setCamMsg('🤖 Analisando imagem com IA...')
      let data = await analyzeDocument(b64, inventory, pessoas)

      // ── 2ª tentativa: Tesseract OCR → Gemini Texto ───────────────────────
      if (!data) {
        setStatus('📝 OCR local em andamento...')
        setCamMsg('📝 Tentando OCR local...')
        try {
          const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.95))
          const result = await Tesseract.recognize(blob, 'por+eng', {
            logger: m => {
              if (m.status === 'recognizing text')
                setStatus(`📝 OCR: ${Math.round(m.progress * 100)}%`)
            }
          })
          const ocrText = result.data.text?.trim()
          console.log('[OCR texto]', ocrText?.slice(0, 200))
          if (ocrText?.length > 15) {
            setStatus('🤖 Refinando com IA...')
            setCamMsg('🤖 Refinando texto com IA...')
            data = await analyzeText(ocrText, inventory, pessoas)
          }
        } catch (ocrErr) {
          console.warn('[OCR erro]', ocrErr.message)
        }
      }

      if (data) {
        playBeep()   // 🔊 bip de sucesso na leitura de dados
        onDataExtracted(data); setExtractedData(data)
        addToast('✅ Destinatário extraído!', 'success')
        setStatus('✅ Dados extraídos!')
        setCamMsg('✅ Pronto! Formulário preenchido.')
      } else {
        setCaptureError(true)
        addToast('IA não identificou. Tente enquadrar melhor ou use "Carregar Foto".', 'warning')
        setStatus('⚠️ Não identificou os dados.')
        setCamMsg('⚠️ Tente novamente com a etiqueta mais centralizada.')
      }
    } catch (err) {
      setCaptureError(true)
      addToast(`Erro: ${err.message}`, 'error')
      setStatus(`❌ ${err.message}`)
      setCamMsg('❌ Erro ao processar.')
    }
    setCapturing(false)
  }, [inventory, pessoas, stopCamera, onDataExtracted, addToast])

  // ── QR: scan loop ─────────────────────────────────────────────────────────
  const scanFrame = useCallback(() => {
    const video = videoRef.current, canvas = canvasRef.current
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(scanFrame); return
    }
    canvas.width = video.videoWidth; canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0)
    const code = window.jsQR?.(
      ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      canvas.width, canvas.height, { inversionAttempts: 'dontInvert' }
    )
    if (code?.data) handleQRDecoded(code.data)
    else rafRef.current = requestAnimationFrame(scanFrame)
  }, [])

  // ── QR: upload de arquivo ─────────────────────────────────────────────────
  const handleQRImageUpload = useCallback(async (e) => {
    const file = e.target.files?.[0]; if (!file) return
    await loadJsQR(); setCamMsg('🔍 Analisando imagem...')
    const reader = new FileReader()
    reader.onload = ev => {
      const img = new Image()
      img.onload = () => {
        const c = document.createElement('canvas')
        c.width = img.width; c.height = img.height
        c.getContext('2d').drawImage(img, 0, 0)
        const code = window.jsQR?.(
          c.getContext('2d').getImageData(0, 0, c.width, c.height).data,
          c.width, c.height
        )
        if (code?.data) handleQRDecoded(code.data)
        else { setCamMsg('❌ QR Code não encontrado.'); addToast('QR Code não encontrado.', 'warning') }
      }
      img.src = ev.target.result
    }
    reader.readAsDataURL(file); e.target.value = ''
  }, [])

  // ── QR: decodifica ────────────────────────────────────────────────────────
  const handleQRDecoded = useCallback(async (rawData) => {
    playBeep(); stopCamera(); setQrDetected(true)
    setCamMsg('✅ QR lido! Extraindo dados com IA...'); setStatus('🤖 Analisando QR...')
    try {
      let data = null
      try {
        const p = JSON.parse(rawData)
        if (p.id && p.name) {
          const prod = inventory.find(i => i.id === p.id || i.name === p.name)
          if (prod) { data = { productName: prod.name }; setCamMsg(`✅ Produto: ${prod.name}`) }
        }
      } catch {}
      if (!data) { setCamMsg('🤖 Interpretando QR...'); data = await analyzeText(rawData, inventory, pessoas) }
      if (data) {
        onDataExtracted(data); setExtractedData(data)
        addToast('✅ QR Code lido e dados extraídos!', 'success')
        setStatus('✅ Dados extraídos!'); setCamMsg('✅ Pronto! Formulário preenchido.')
      } else {
        setTextInput(rawData); setTab('text')
        addToast('QR lido — revise os dados na aba Texto.', 'info')
      }
    } catch (err) {
      addToast(`Erro: ${err.message}`, 'error')
      setTextInput(rawData); setTab('text')
    }
  }, [inventory, pessoas, stopCamera, onDataExtracted, addToast])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ marginBottom: '1.5rem' }}>

      {/* Abas principais */}
      <div className="flex gap-1 mb-2">
        {[
          { id: 'image',  label: '🖼️ Imagem / Foto' },
          { id: 'camera', label: '📷 Câmera' },
          { id: 'text',   label: '📝 Colar Texto' },
        ].map(t => (
          <button key={t.id}
            className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTab(t.id)}
          >{t.label}</button>
        ))}
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
          <span className="drop-zone-sub">PNG, JPG, WEBP — IA extrai os dados automaticamente</span>
          <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => processFile(e.target.files[0])} />
        </div>
      )}

      {/* ── Aba Câmera ── */}
      {tab === 'camera' && (
        <div>
          {/* Seletor Dados / QR Code */}
          <div style={{
            display: 'flex', gap: '0.4rem', marginBottom: '0.75rem',
            background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: '0.25rem',
          }}>
            {['dados', 'qr'].map(mode => (
              <button key={mode}
                onClick={() => { if (cameraMode !== mode) { setCameraMode(mode); setQrDetected(false); setCapturedPreview(null); setCaptureError(false) }}}
                style={{
                  flex: 1, padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm)',
                  border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem',
                  transition: 'all 0.18s',
                  background: cameraMode === mode ? 'var(--primary-grad)' : 'transparent',
                  color: cameraMode === mode ? '#fff' : 'var(--text-muted)',
                  boxShadow: cameraMode === mode ? 'var(--shadow-blue)' : 'none',
                }}
              >
                {mode === 'dados' ? '📸 Dados' : '📷 QR Code'}
              </button>
            ))}
          </div>

          {/* Viewfinder */}
          <div style={{
            position: 'relative', borderRadius: 'var(--radius)', overflow: 'hidden',
            background: '#0f172a', aspectRatio: '4/3', maxHeight: 320,
          }}>
            <video ref={videoRef}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: scanning ? 'block' : 'none' }}
              muted playsInline />

            {/* Preview da última captura (quando câmera parou) */}
            {!scanning && capturedPreview && (
              <img src={capturedPreview} alt="captura"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            )}

            {/* Tela inicial */}
            {!scanning && !capturedPreview && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: '0.75rem', color: '#94a3b8',
              }}>
                <span style={{ fontSize: '3rem' }}>{cameraMode === 'dados' ? '📸' : '📷'}</span>
                <span style={{ fontSize: '0.82rem', textAlign: 'center', padding: '0 1rem' }}>
                  {qrDetected ? '✅ QR lido!' : cameraMode === 'dados' ? 'Modo Dados' : 'Modo QR Code'}
                </span>
              </div>
            )}

            {/* Mira QR — quadrado verde */}
            {scanning && cameraMode === 'qr' && (
              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%,-50%)',
                width: 200, height: 200, border: '2px solid #22c55e', borderRadius: 12,
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)', pointerEvents: 'none',
              }}>
                {[{t:-2,l:-2,bt:'3px solid #22c55e',bl:'3px solid #22c55e',br:'4px 0 0 0'},
                  {t:-2,r:-2,bt:'3px solid #22c55e',br2:'3px solid #22c55e',brr:'0 4px 0 0'},
                  {b:-2,l:-2,bb:'3px solid #22c55e',bl:'3px solid #22c55e',br:'0 0 0 4px'},
                  {b:-2,r:-2,bb:'3px solid #22c55e',br2:'3px solid #22c55e',brr:'0 0 4px 0'},
                ].map((c,i) => (
                  <div key={i} style={{
                    position:'absolute', width:22, height:22,
                    top: c.t, bottom: c.b, left: c.l, right: c.r,
                    borderTop: c.bt, borderBottom: c.bb,
                    borderLeft: c.bl, borderRight: c.br2,
                    borderRadius: c.br || c.brr,
                  }} />
                ))}
              </div>
            )}

            {/* Mira Dados — retângulo azul */}
            {scanning && cameraMode === 'dados' && (
              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%,-50%)',
                width: '82%', height: '58%',
                border: `2px solid ${camReady ? '#3b82f6' : '#f59e0b'}`,
                borderRadius: 10,
                boxShadow: `0 0 0 9999px rgba(0,0,0,0.38)`,
                pointerEvents: 'none',
                transition: 'border-color 0.3s',
              }}>
                {/* Cantos */}
                {['tl','tr','bl','br'].map(c => (
                  <div key={c} style={{
                    position: 'absolute', width: 22, height: 22,
                    borderColor: camReady ? '#3b82f6' : '#f59e0b',
                    borderStyle: 'solid',
                    borderWidth: c[0]==='t' ? '3px 0 0 0' : '0 0 3px 0',
                    ...(c[1]==='l' ? {left:-2, borderLeftWidth:3} : {right:-2, borderRightWidth:3}),
                    ...(c[0]==='t' ? {top:-2} : {bottom:-2}),
                    borderRadius: c==='tl'?'4px 0 0 0':c==='tr'?'0 4px 0 0':c==='bl'?'0 0 0 4px':'0 0 4px 0',
                  }} />
                ))}
                <div style={{
                  position: 'absolute', bottom: -26, left: '50%', transform: 'translateX(-50%)',
                  fontSize: '0.7rem', whiteSpace: 'nowrap',
                  color: camReady ? '#93c5fd' : '#fcd34d',
                }}>
                  {camReady ? 'DESTINATÁRIO aqui' : 'Aguardando câmera...'}
                </div>
              </div>
            )}

            {/* Overlay de processamento */}
            {capturing && (
              <div style={{
                position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.7)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem',
              }}>
                <div className="spinner" />
                <span style={{ color: '#93c5fd', fontSize: '0.82rem' }}>Analisando...</span>
              </div>
            )}
          </div>

          <canvas ref={canvasRef} style={{ display: 'none' }} />

          {/* Mensagem */}
          <p style={{
            marginTop: '0.5rem', fontSize: '0.78rem', textAlign: 'center', minHeight: '1.2em',
            color: qrDetected ? '#16a34a' : capturing ? '#3b82f6' : captureError ? '#dc2626' : 'var(--text-muted)',
          }}>
            {camMsg}
          </p>

          {/* Botões */}
          <div className="flex gap-1" style={{ marginTop: '0.5rem' }}>
            {!scanning ? (
              <>
                <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={startCamera}>
                  {cameraMode === 'dados' ? '📸 Abrir Câmera' : '📷 Abrir Câmera'}
                </button>
                {/* Retry rápido quando deu erro */}
                {captureError && (
                  <button className="btn btn-secondary btn-sm" style={{ flex: 1 }}
                    onClick={() => { setCapturedPreview(null); setCaptureError(false); startCamera() }}>
                    🔄 Tentar Novamente
                  </button>
                )}
              </>
            ) : (
              <>
                {cameraMode === 'dados' && (
                  <button
                    className="btn btn-primary btn-sm" style={{ flex: 2 }}
                    onClick={capturePhoto}
                    disabled={capturing || !camReady}
                  >
                    {capturing ? '⏳ Processando...' : !camReady ? '⏳ Aguardando...' : '📸 Capturar'}
                  </button>
                )}
                <button className="btn btn-secondary btn-sm"
                  style={{ flex: cameraMode === 'dados' ? 0 : 1, minWidth: 72 }}
                  onClick={stopCamera}
                >
                  ⏹ Parar
                </button>
              </>
            )}

            {/* Upload fallback */}
            {cameraMode === 'qr' && (
              <label className="btn btn-secondary btn-sm" style={{ flex: 1, cursor: 'pointer', textAlign: 'center' }}>
                📁 Imagem do QR
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleQRImageUpload} />
              </label>
            )}
            {cameraMode === 'dados' && !scanning && (
              <label className="btn btn-secondary btn-sm" style={{ flex: captureError ? 0 : 1, minWidth: 90, cursor: 'pointer', textAlign: 'center' }}>
                📁 Carregar Foto
                <input type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files[0]; if (f) processFile(f); e.target.value = '' }} />
              </label>
            )}
          </div>

          {/* Dica */}
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.5rem', lineHeight: 1.55, textAlign: 'center' }}>
            {cameraMode === 'dados'
              ? '💡 Dica: enquadre só a parte do DESTINATÁRIO, com boa iluminação. A moldura fica azul quando a câmera estiver pronta.'
              : '💡 Dica: segure firme a 15–20 cm do QR Code até o beep.'
            }
          </p>
        </div>
      )}

      {/* ── Aba Texto ── */}
      {tab === 'text' && (
        <div>
          <textarea value={textInput} onChange={e => setTextInput(e.target.value)}
            placeholder="Cole aqui o texto da etiqueta ou pedido..."
            rows={5} style={{ marginBottom: '0.5rem', resize: 'vertical' }} />
          <div className="flex gap-1">
            <button className="btn btn-primary btn-sm" onClick={processText} disabled={!textInput.trim()}>🤖 Extrair Dados</button>
            <button className="btn btn-secondary btn-sm" onClick={formatText} disabled={!textInput.trim()}>📋 Só Formatar</button>
          </div>
          {formatted && (
            <pre style={{
              marginTop: '0.75rem', padding: '0.75rem',
              background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)',
              fontSize: '0.8rem', whiteSpace: 'pre-wrap', border: '1px solid var(--border)',
            }}>{formatted}</pre>
          )}
        </div>
      )}

      {/* Status geral */}
      {status && (
        <p style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
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
          <div style={{ fontWeight: 700, marginBottom: '0.4rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '0.7rem' }}>
            📋 Dados Extraídos
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem 1rem' }}>
            {extractedData.customerName && <span>👤 <b>{extractedData.customerName}</b></span>}
            {extractedData.location     && <span>📍 {extractedData.location}</span>}
            {extractedData.cep          && <span>📮 {extractedData.cep}</span>}
            {extractedData.bairro       && <span>🏘️ {extractedData.bairro}</span>}
            {extractedData.address      && <span style={{ gridColumn: 'span 2' }}>🏠 {extractedData.address}</span>}
            {extractedData.orderId      && <span>🔖 {extractedData.orderId}</span>}
            {extractedData.rastreio     && <span>📦 {extractedData.rastreio}</span>}
            {extractedData.modalidade   && <span>🚚 {extractedData.modalidade}</span>}
            {extractedData.productName  && <span>🛒 {extractedData.productName}</span>}
          </div>
          <button className="btn btn-secondary btn-sm"
            style={{ marginTop: '0.5rem', fontSize: '0.7rem' }}
            onClick={() => setExtractedData(null)}>
            ✕ Fechar
          </button>
        </div>
      )}
    </div>
  )
}
