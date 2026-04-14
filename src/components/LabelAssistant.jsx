import React, { useState, useRef, useCallback, useEffect } from 'react'
import Tesseract from 'tesseract.js'
import { analyzeDocument, analyzeText, formatLabelText } from '../lib/gemini'

// ─── Beep ─────────────────────────────────────────────────────────────────────
function playBeep(freq1 = 1046, freq2 = 1318) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator(), gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq1, ctx.currentTime)
    if (freq2) osc.frequency.setValueAtTime(freq2, ctx.currentTime + 0.07)
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22)
    osc.start(); osc.stop(ctx.currentTime + 0.22)
  } catch {}
}

// ─── carrega jsQR via CDN ─────────────────────────────────────────────────────
function loadJsQR() {
  return new Promise(r => {
    if (window.jsQR) { r(window.jsQR); return }
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'
    s.onload = () => r(window.jsQR); s.onerror = () => r(null)
    document.head.appendChild(s)
  })
}

// ─── Aguarda câmera estabilizar (FIX: reseta após troca de srcObject) ─────────
function waitReady(video, maxMs = 4000) {
  return new Promise(resolve => {
    const deadline = Date.now() + maxMs
    // Primeiro aguarda o readyState subir COM o novo stream
    let settled = false
    function check() {
      if (!settled) {
        if (video.readyState >= 3 && video.videoWidth > 0 && !video.paused) {
          settled = true
          // Aguarda mais 6 frames para câmera focar/estabilizar
          let f = 0
          function frames() {
            if (++f >= 6 || Date.now() > deadline) resolve(true)
            else requestAnimationFrame(frames)
          }
          requestAnimationFrame(frames)
        } else if (Date.now() > deadline) {
          resolve(false)
        } else {
          requestAnimationFrame(check)
        }
      }
    }
    check()
  })
}

export function LabelAssistant({ inventory, pessoas, addToast, onDataExtracted }) {
  const [tab,             setTab]             = useState('image')
  const [status,          setStatus]          = useState('')
  const [dragging,        setDragging]        = useState(false)
  const [textInput,       setTextInput]       = useState('')
  const [formatted,       setFormatted]       = useState('')
  const [extractedData,   setExtractedData]   = useState(null)

  // ── câmera ────────────────────────────────────────────────────────────────
  const [cameraMode,      setCameraMode]      = useState('dados')   // 'dados' | 'qr'
  const [scanning,        setScanning]        = useState(false)
  const [camReady,        setCamReady]        = useState(false)
  const [camMsg,          setCamMsg]          = useState('')
  const [capturing,       setCapturing]       = useState(false)
  const [capturedPreview, setCapturedPreview] = useState(null)
  const [captureError,    setCaptureError]    = useState(false)
  const [autoQR,          setAutoQR]          = useState(false)     // animação de transição

  // ── refs ──────────────────────────────────────────────────────────────────
  const videoRef        = useRef(null)
  const streamRef       = useRef(null)
  const rafRef          = useRef(null)
  const captureLockRef  = useRef(false)   // FIX: evita dupla captura
  const isMountedRef    = useRef(true)    // FIX: evita setState após unmount
  const qrHandlerRef    = useRef(null)    // FIX: stale closure em scanFrame
  const inputRef        = useRef(null)
  const cameraModeRef   = useRef(cameraMode)

  useEffect(() => { cameraModeRef.current = cameraMode }, [cameraMode])
  useEffect(() => () => { isMountedRef.current = false; releaseCamera() }, [])
  useEffect(() => { if (tab !== 'camera') releaseCamera() }, [tab])

  // ─── Libera câmera completamente (FIX: limpa srcObject) ──────────────────
  const releaseCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    // FIX: limpar srcObject é essencial para iOS reutilizar getUserMedia
    if (videoRef.current) {
      videoRef.current.srcObject = null
      videoRef.current.load()
    }
    if (isMountedRef.current) {
      setScanning(false)
      setCamReady(false)
    }
  }, [])

  // ─── Inicia câmera ────────────────────────────────────────────────────────
  const startCamera = useCallback(async (mode) => {
    const m = mode ?? cameraModeRef.current
    releaseCamera()

    if (!isMountedRef.current) return
    setScanning(true); setCamReady(false); setCapturedPreview(null)
    setCaptureError(false); setAutoQR(false); captureLockRef.current = false
    setCamMsg('Iniciando câmera...')

    if (m === 'qr') await loadJsQR()

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      })
      if (!isMountedRef.current) { stream.getTracks().forEach(t => t.stop()); return }

      streamRef.current = stream
      const video = videoRef.current
      video.srcObject = stream
      await video.play()

      const ready = await waitReady(video)
      if (!isMountedRef.current) return
      setCamReady(ready)

      if (m === 'dados') {
        setCamMsg(ready
          ? '✅ Pronta — enquadre o DESTINATÁRIO e toque em Capturar'
          : '⚠️ Câmera iniciando, aguarde...')
      } else {
        setCamMsg('Aponte para o QR Code')
        rafRef.current = requestAnimationFrame(() => scanLoop())
      }
    } catch (err) {
      if (!isMountedRef.current) return
      setCamMsg(`❌ Câmera: ${err.message}. Use "Carregar Foto".`)
      setScanning(false)
    }
  }, [releaseCamera])

  // ─── Loop de scan QR (FIX: usa ref para evitar stale closure) ────────────
  const scanLoop = useCallback(() => {
    const video = videoRef.current
    if (!video || !streamRef.current) return
    if (video.readyState < 3) { rafRef.current = requestAnimationFrame(scanLoop); return }

    const c = document.createElement('canvas')
    c.width = video.videoWidth; c.height = video.videoHeight
    const ctx = c.getContext('2d'); ctx.drawImage(video, 0, 0)
    const code = window.jsQR?.(
      ctx.getImageData(0, 0, c.width, c.height).data,
      c.width, c.height, { inversionAttempts: 'dontInvert' }
    )
    if (code?.data) {
      qrHandlerRef.current?.(code.data)
    } else {
      rafRef.current = requestAnimationFrame(scanLoop)
    }
  }, [])

  // ─── Captura foto ─────────────────────────────────────────────────────────
  const capturePhoto = useCallback(async () => {
    if (captureLockRef.current) return       // FIX: lock anti-duplo
    const video = videoRef.current
    if (!video || !video.videoWidth) {
      setCamMsg('⚠️ Câmera ainda iniciando...'); return
    }
    captureLockRef.current = true
    setCapturing(true); setCaptureError(false)
    setCamMsg('📸 Capturando...')

    // Captura frame ANTES de parar (iOS apaga imediatamente ao stop)
    const c = document.createElement('canvas')  // FIX: canvas dedicado, não DOM ref
    c.width = video.videoWidth; c.height = video.videoHeight
    c.getContext('2d').drawImage(video, 0, 0)
    releaseCamera()

    if (!isMountedRef.current) return
    setCapturedPreview(c.toDataURL('image/jpeg', 0.35))

    const b64full = c.toDataURL('image/jpeg', 0.95)

    try {
      // ── 1ª: Gemini Vision ────────────────────────────────────────────────
      setStatus('🤖 Gemini Vision lendo...')
      setCamMsg('🤖 Analisando com IA...')
      let data = await analyzeDocument(b64full, inventory, pessoas)

      // ── 2ª: Tesseract OCR → Gemini texto ────────────────────────────────
      if (!data) {
        if (!isMountedRef.current) return
        setStatus('📝 OCR local...'); setCamMsg('📝 OCR em andamento...')
        try {
          const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92))
          const { data: { text } } = await Tesseract.recognize(blob, 'por+eng', {
            logger: m => {
              if (!isMountedRef.current) return
              if (m.status === 'recognizing text')
                setStatus(`📝 OCR: ${Math.round(m.progress * 100)}%`)
            }
          })
          if (text?.trim().length > 15) {
            setStatus('🤖 Refinando...')
            data = await analyzeText(text.trim(), inventory, pessoas)
          }
        } catch (e) { console.warn('[OCR]', e.message) }
      }

      if (!isMountedRef.current) return

      if (data) {
        playBeep()
        onDataExtracted(data); setExtractedData(data)
        addToast('✅ Destinatário extraído!', 'success')
        setStatus('✅ Dados extraídos!')
        setCamMsg('✅ Lido! Abrindo scanner do produto...')

        // ── Auto-abre QR do produto após 1.2s ────────────────────────────
        setAutoQR(true)
        setTimeout(() => {
          if (!isMountedRef.current) return
          setAutoQR(false)
          setCameraMode('qr')
          startCamera('qr')
        }, 1200)
      } else {
        setCaptureError(true)
        addToast('IA não identificou. Tente enquadrar melhor.', 'warning')
        setStatus('⚠️ Não identificou.'); setCamMsg('⚠️ Tente novamente.')
      }
    } catch (err) {
      if (!isMountedRef.current) return
      setCaptureError(true)
      addToast(`Erro: ${err.message}`, 'error')
      setStatus(`❌ ${err.message}`); setCamMsg('❌ Erro.')
    }

    if (isMountedRef.current) { setCapturing(false); captureLockRef.current = false }
  }, [inventory, pessoas, releaseCamera, startCamera, onDataExtracted, addToast])

  // ─── Decodifica QR (FIX: sempre atualizado via ref) ──────────────────────
  const handleQRDecoded = useCallback(async (rawData) => {
    playBeep()
    releaseCamera()
    setCamMsg('✅ QR lido! Extraindo...'); setStatus('🤖 Analisando QR...')

    try {
      let data = null
      // Tenta como JSON do produto
      try {
        const p = JSON.parse(rawData)
        if (p.id && p.name) {
          const prod = inventory.find(i => i.id === p.id || i.name === p.name)
          if (prod) { data = { productName: prod.name }; setCamMsg(`✅ Produto: ${prod.name}`) }
        }
      } catch {}

      if (!data) {
        setCamMsg('🤖 Interpretando QR...')
        data = await analyzeText(rawData, inventory, pessoas)
      }

      if (!isMountedRef.current) return

      if (data) {
        playBeep(1318, 1568)  // tom mais agudo para produto
        onDataExtracted(data); setExtractedData(data)
        const isProduct = !!data.productName
        addToast(isProduct ? `✅ Produto: ${data.productName}` : '✅ QR lido!', 'success')
        setStatus('✅ Extraído!'); setCamMsg('✅ Pronto!')
      } else {
        setTextInput(rawData); setTab('text')
        addToast('QR lido — verifique na aba Texto.', 'info')
      }
    } catch (err) {
      if (!isMountedRef.current) return
      addToast(`Erro QR: ${err.message}`, 'error')
      setTextInput(rawData); setTab('text')
    }
  }, [inventory, pessoas, releaseCamera, onDataExtracted, addToast])

  // FIX: mantém ref atualizada para scanLoop usar versão mais recente
  useEffect(() => { qrHandlerRef.current = handleQRDecoded }, [handleQRDecoded])

  // ── processamento de imagem (arquivo) ─────────────────────────────────────
  const processFile = useCallback(async (file) => {
    if (!file) return
    setStatus('🔍 Analisando...'); setFormatted('')
    try {
      let data = null
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = rej
        r.readAsDataURL(file)
      })
      setStatus('🤖 IA analisando...')
      try { data = await analyzeDocument(b64, inventory, pessoas) } catch {}
      if (!data) {
        setStatus('📝 OCR...')
        const { data: { text } } = await Tesseract.recognize(file, 'por+eng')
        setStatus('🤖 Refinando...')
        data = await analyzeText(text, inventory, pessoas)
      }
      if (data) {
        playBeep(); onDataExtracted(data); setExtractedData(data)
        addToast('✅ Etiqueta lida!', 'success'); setStatus('✅ Extraído!')
      } else {
        addToast('Não identificou dados.', 'warning'); setStatus('⚠️ Incompleto')
      }
    } catch (err) { addToast(`Erro: ${err.message}`, 'error') }
  }, [inventory, pessoas, addToast, onDataExtracted])

  const processText = useCallback(async () => {
    if (!textInput.trim()) return
    setStatus('🤖 Analisando...')
    try {
      const data = await analyzeText(textInput, inventory, pessoas)
      if (data) {
        playBeep(); onDataExtracted(data); setExtractedData(data)
        addToast('✅ Extraído!', 'success'); setStatus('✅ Pronto!')
      } else {
        addToast('Não identificou.', 'warning'); setStatus('⚠️ Sem dados')
      }
    } catch (err) { addToast(`Erro: ${err.message}`, 'error') }
  }, [textInput, inventory, pessoas, addToast, onDataExtracted])

  const formatText = useCallback(async () => {
    if (!textInput.trim()) return
    try { setFormatted(await formatLabelText(textInput)); setStatus('✅ Formatado!') }
    catch (err) { setStatus(`❌ ${err.message}`) }
  }, [textInput])

  const handleDrop = useCallback(e => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]; if (file) processFile(file)
  }, [processFile])

  const handleQRFile = useCallback(async e => {
    const file = e.target.files?.[0]; if (!file) return
    await loadJsQR(); setCamMsg('🔍 Analisando...')
    const r = new FileReader()
    r.onload = ev => {
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
        else { setCamMsg('❌ QR não encontrado.'); addToast('QR não encontrado.', 'warning') }
      }
      img.src = ev.target.result
    }
    r.readAsDataURL(file); e.target.value = ''
  }, [handleQRDecoded, addToast])

  // ─── Render ───────────────────────────────────────────────────────────────
  const borderColor = camReady ? '#3b82f6' : '#f59e0b'

  return (
    <div style={{ marginBottom: '1.5rem' }}>

      {/* Abas */}
      <div className="flex gap-1 mb-2">
        {[['image','🖼️ Imagem / Foto'],['camera','📷 Câmera'],['text','📝 Colar Texto']].map(([id, label]) => (
          <button key={id}
            className={`btn btn-sm ${tab === id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {/* ── Imagem / arquivo ── */}
      {tab === 'image' && (
        <div className={`drop-zone ${dragging ? 'dragging' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}>
          <span className="drop-zone-icon">📦</span>
          <span className="drop-zone-title">Clique ou arraste a foto da etiqueta</span>
          <span className="drop-zone-sub">PNG, JPG, WEBP — IA extrai os dados automaticamente</span>
          <input ref={inputRef} type="file" accept="image/*" style={{ display:'none' }}
            onChange={e => processFile(e.target.files[0])} />
        </div>
      )}

      {/* ── Câmera ── */}
      {tab === 'camera' && (
        <div>
          {/* Seletor de modo */}
          <div style={{
            display:'flex', gap:'0.4rem', marginBottom:'0.75rem',
            background:'var(--surface-2)', borderRadius:'var(--radius)', padding:'0.25rem',
          }}>
            {[['dados','📸 Dados'],['qr','📷 QR Code']].map(([m,label]) => (
              <button key={m}
                onClick={() => {
                  if (cameraMode !== m) {
                    setCameraMode(m); setCapturedPreview(null); setCaptureError(false)
                    if (scanning) startCamera(m)
                  }
                }}
                style={{
                  flex:1, padding:'0.5rem 0.75rem', borderRadius:'var(--radius-sm)',
                  border:'none', cursor:'pointer', fontWeight:700, fontSize:'0.85rem',
                  background: cameraMode===m ? 'var(--primary-grad)' : 'transparent',
                  color: cameraMode===m ? '#fff' : 'var(--text-muted)',
                  boxShadow: cameraMode===m ? 'var(--shadow-blue)' : 'none',
                  transition:'all 0.18s',
                }}>
                {label}
              </button>
            ))}
          </div>

          {/* Viewfinder */}
          <div style={{
            position:'relative', borderRadius:'var(--radius)', overflow:'hidden',
            background:'#0f172a', aspectRatio:'4/3', maxHeight:320,
          }}>
            <video ref={videoRef}
              style={{ width:'100%', height:'100%', objectFit:'cover', display: scanning ? 'block' : 'none' }}
              muted playsInline />

            {/* Preview da captura */}
            {!scanning && capturedPreview && (
              <img src={capturedPreview} alt="captura"
                style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
            )}

            {/* Estado idle */}
            {!scanning && !capturedPreview && (
              <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column',
                alignItems:'center', justifyContent:'center', gap:'0.75rem', color:'#94a3b8' }}>
                <span style={{ fontSize:'3rem' }}>{cameraMode==='dados' ? '📸' : '📷'}</span>
                <span style={{ fontSize:'0.8rem', textAlign:'center', padding:'0 1rem' }}>
                  {cameraMode==='dados' ? 'Fotografa o DESTINATÁRIO' : 'Lê QR Code da etiqueta / produto'}
                </span>
              </div>
            )}

            {/* Mira QR — quadrado verde */}
            {scanning && cameraMode === 'qr' && (
              <div style={{
                position:'absolute', top:'50%', left:'50%',
                transform:'translate(-50%,-50%)',
                width:200, height:200, border:'2px solid #22c55e', borderRadius:12,
                boxShadow:'0 0 0 9999px rgba(0,0,0,0.45)', pointerEvents:'none',
              }}>
                {[{t:-2,l:-2,bt:'3px solid #22c55e',bl:'3px solid #22c55e'},
                  {t:-2,r:-2,bt:'3px solid #22c55e',br:'3px solid #22c55e'},
                  {b:-2,l:-2,bb:'3px solid #22c55e',bl:'3px solid #22c55e'},
                  {b:-2,r:-2,bb:'3px solid #22c55e',br:'3px solid #22c55e'},
                ].map((s,i) => (
                  <div key={i} style={{
                    position:'absolute', width:22, height:22,
                    top:s.t, bottom:s.b, left:s.l, right:s.r,
                    borderTop:s.bt, borderBottom:s.bb, borderLeft:s.bl, borderRight:s.br,
                    borderRadius: i===0?'4px 0 0 0':i===1?'0 4px 0 0':i===2?'0 0 0 4px':'0 0 4px 0',
                  }} />
                ))}
              </div>
            )}

            {/* Mira Dados — retângulo azul/amarelo */}
            {scanning && cameraMode === 'dados' && (
              <div style={{
                position:'absolute', top:'50%', left:'50%',
                transform:'translate(-50%,-50%)',
                width:'82%', height:'60%',
                border: `2px solid ${borderColor}`,
                borderRadius:10,
                boxShadow:'0 0 0 9999px rgba(0,0,0,0.38)',
                pointerEvents:'none',
                transition:'border-color 0.3s',
              }}>
                {['tl','tr','bl','br'].map(c => (
                  <div key={c} style={{
                    position:'absolute', width:22, height:22,
                    borderColor, borderStyle:'solid',
                    borderWidth: c[0]==='t' ? '3px 0 0 0' : '0 0 3px 0',
                    ...(c[1]==='l' ? {left:-2, borderLeftWidth:3} : {right:-2, borderRightWidth:3}),
                    ...(c[0]==='t' ? {top:-2} : {bottom:-2}),
                    borderRadius: c==='tl'?'4px 0 0 0':c==='tr'?'0 4px 0 0':c==='bl'?'0 0 0 4px':'0 0 4px 0',
                  }} />
                ))}
                <div style={{
                  position:'absolute', bottom:-26, left:'50%', transform:'translateX(-50%)',
                  fontSize:'0.68rem', whiteSpace:'nowrap',
                  color: camReady ? '#93c5fd' : '#fcd34d',
                }}>
                  {camReady ? 'DESTINATÁRIO aqui' : '⏳ Aguardando câmera...'}
                </div>
              </div>
            )}

            {/* Overlay de processamento */}
            {(capturing || autoQR) && (
              <div style={{
                position:'absolute', inset:0, background:'rgba(15,23,42,0.75)',
                display:'flex', flexDirection:'column',
                alignItems:'center', justifyContent:'center', gap:'0.75rem',
              }}>
                <div className="spinner" />
                <span style={{ color:'#93c5fd', fontSize:'0.82rem' }}>
                  {autoQR ? '🏷️ Abrindo scanner do produto...' : 'Analisando...'}
                </span>
              </div>
            )}
          </div>

          {/* Mensagem de status */}
          <p style={{
            marginTop:'0.5rem', fontSize:'0.78rem', textAlign:'center', minHeight:'1.4em',
            color: captureError ? '#dc2626' : capturing ? '#3b82f6' : autoQR ? '#16a34a' : 'var(--text-muted)',
          }}>{camMsg}</p>

          {/* Botões */}
          <div className="flex gap-1" style={{ marginTop:'0.5rem' }}>
            {!scanning ? (
              <>
                <button className="btn btn-primary btn-sm" style={{ flex:1 }}
                  onClick={() => startCamera()}>
                  {cameraMode==='dados' ? '📸 Abrir Câmera' : '📷 Abrir Câmera'}
                </button>
                {captureError && (
                  <button className="btn btn-secondary btn-sm" style={{ flex:1 }}
                    onClick={() => { setCapturedPreview(null); setCaptureError(false); startCamera() }}>
                    🔄 Tentar Novamente
                  </button>
                )}
              </>
            ) : (
              <>
                {cameraMode === 'dados' && (
                  <button className="btn btn-primary btn-sm" style={{ flex:2 }}
                    onClick={capturePhoto}
                    disabled={capturing || !camReady || autoQR}>
                    {capturing ? '⏳ Processando...' : !camReady ? '⏳ Aguardando...' : '📸 Capturar'}
                  </button>
                )}
                <button className="btn btn-secondary btn-sm"
                  style={{ flex: cameraMode==='dados' ? 0 : 1, minWidth:72 }}
                  onClick={releaseCamera}>⏹ Parar</button>
              </>
            )}

            {cameraMode === 'qr' && (
              <label className="btn btn-secondary btn-sm" style={{ flex:1, cursor:'pointer', textAlign:'center' }}>
                📁 Imagem do QR
                <input type="file" accept="image/*" style={{ display:'none' }} onChange={handleQRFile} />
              </label>
            )}
            {cameraMode === 'dados' && !scanning && (
              <label className="btn btn-secondary btn-sm" style={{ flex: captureError ? 0 : 1, minWidth:90, cursor:'pointer', textAlign:'center' }}>
                📁 Carregar Foto
                <input type="file" accept="image/*" style={{ display:'none' }}
                  onChange={e => { const f = e.target.files[0]; if (f) processFile(f); e.target.value='' }} />
              </label>
            )}
          </div>

          <p style={{ fontSize:'0.7rem', color:'var(--text-muted)', marginTop:'0.5rem', lineHeight:1.55, textAlign:'center' }}>
            {cameraMode==='dados'
              ? '💡 Moldura azul = pronta. Enquadre só o DESTINATÁRIO com boa iluminação.'
              : '💡 Segure a 15–20 cm. Após ler a etiqueta, leia o QR do produto.'}
          </p>
        </div>
      )}

      {/* ── Texto ── */}
      {tab === 'text' && (
        <div>
          <textarea value={textInput} onChange={e => setTextInput(e.target.value)}
            placeholder="Cole aqui o texto da etiqueta ou pedido..."
            rows={5} style={{ marginBottom:'0.5rem', resize:'vertical' }} />
          <div className="flex gap-1">
            <button className="btn btn-primary btn-sm" onClick={processText} disabled={!textInput.trim()}>🤖 Extrair Dados</button>
            <button className="btn btn-secondary btn-sm" onClick={formatText} disabled={!textInput.trim()}>📋 Formatar</button>
          </div>
          {formatted && (
            <pre style={{
              marginTop:'0.75rem', padding:'0.75rem',
              background:'var(--surface-2)', borderRadius:'var(--radius-sm)',
              fontSize:'0.8rem', whiteSpace:'pre-wrap', border:'1px solid var(--border)',
            }}>{formatted}</pre>
          )}
        </div>
      )}

      {/* Status */}
      {status && (
        <p style={{ marginTop:'0.5rem', fontSize:'0.8rem', color:'var(--text-muted)' }}>{status}</p>
      )}

      {/* Dados extraídos */}
      {extractedData && (
        <div style={{
          marginTop:'0.75rem', padding:'0.75rem',
          background:'var(--surface-2)', borderRadius:'var(--radius-sm)',
          border:'1px solid var(--border)', fontSize:'0.8rem',
        }}>
          <div style={{ fontWeight:700, marginBottom:'0.4rem', color:'var(--text-muted)', textTransform:'uppercase', fontSize:'0.7rem' }}>
            📋 Dados Extraídos
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.25rem 1rem' }}>
            {extractedData.customerName && <span>👤 <b>{extractedData.customerName}</b></span>}
            {extractedData.location     && <span>📍 {extractedData.location}</span>}
            {extractedData.cep          && <span>📮 {extractedData.cep}</span>}
            {extractedData.bairro       && <span>🏘️ {extractedData.bairro}</span>}
            {extractedData.address      && <span style={{ gridColumn:'span 2' }}>🏠 {extractedData.address}</span>}
            {extractedData.orderId      && <span>🔖 {extractedData.orderId}</span>}
            {extractedData.rastreio     && <span>📦 {extractedData.rastreio}</span>}
            {extractedData.modalidade   && <span>🚚 {extractedData.modalidade}</span>}
            {extractedData.productName  && <span>🛒 {extractedData.productName}</span>}
          </div>
          <button className="btn btn-secondary btn-sm"
            style={{ marginTop:'0.5rem', fontSize:'0.7rem' }}
            onClick={() => setExtractedData(null)}>✕ Fechar</button>
        </div>
      )}
    </div>
  )
}
