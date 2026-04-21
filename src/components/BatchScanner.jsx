import React, { useState, useRef, useCallback, useEffect } from 'react'
import { analyzeText, analyzeDocument } from '../lib/gemini'
import { supabase } from '../lib/supabase'
import { generateId, formatDate, formatCurrency } from '../utils/formatting'
import { geocode, packLocation } from '../utils/location'
import Tesseract from 'tesseract.js'
import jsQR from 'jsqr'

// ─── Modal de QR Code em tempo real ──────────────────────────────────────────
function QrScannerModal({ title, subtitle, onScan, onClose }) {
  const [msg, setMsg] = useState('Iniciando câmera...')
  const [active, setActive] = useState(false)
  const videoRef  = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef    = useRef(null)
  const foundRef  = useRef(false)

  useEffect(() => {
    startCam()
    return () => stopCam()
  }, [])

  async function startCam() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 } }
      })
      streamRef.current = stream
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      setActive(true)
      setMsg('Aponte para o QR Code do produto')
      scanLoop()
    } catch {
      setMsg('❌ Câmera não disponível.')
    }
  }

  function stopCam() {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
  }

  function scanLoop() {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    const tick = () => {
      if (foundRef.current) return
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width  = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' })
        if (code?.data) {
          foundRef.current = true
          setMsg(`✅ QR detectado!`)
          stopCam()
          onScan(code.data)
          return
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 3000, padding: '1rem',
    }}>
      <div className="card" style={{ maxWidth: 460, width: '100%', margin: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>{title}</h3>
            {subtitle && <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-muted)' }}>{subtitle}</p>}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => { stopCam(); onClose() }}>✕</button>
        </div>

        <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', background: '#0f172a', height: '320px' }}>
          <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
          {active && (
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%,-50%)',
              width: '65%', height: '65%',
              border: '2px solid #10b981', borderRadius: 12,
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
              pointerEvents: 'none',
            }}>
              {/* Cantos decorativos */}
              {[['0','0'],['0','auto'],['auto','0'],['auto','auto']].map(([t,b], i) => (
                <div key={i} style={{
                  position:'absolute',
                  top: t !== 'auto' ? -2 : 'auto', bottom: b !== 'auto' ? -2 : 'auto',
                  left: i < 2 ? -2 : 'auto', right: i >= 2 ? -2 : 'auto',
                  width: 20, height: 20,
                  borderTop:    (i === 0 || i === 2) ? '3px solid #10b981' : 'none',
                  borderBottom: (i === 1 || i === 3) ? '3px solid #10b981' : 'none',
                  borderLeft:   (i === 0 || i === 1) ? '3px solid #10b981' : 'none',
                  borderRight:  (i === 2 || i === 3) ? '3px solid #10b981' : 'none',
                }} />
              ))}
            </div>
          )}
        </div>
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        <p style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.75rem 0 0.25rem' }}>{msg}</p>
        <p style={{ textAlign: 'center', fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>
          Leitura automática · sem precisar capturar
        </p>
      </div>
    </div>
  )
}

// ─── Modal de câmera reutilizável ─────────────────────────────────────────────
function CameraModal({ title, subtitle, onCapture, onClose }) {
  const [msg, setMsg] = useState('Iniciando câmera...')
  const [active, setActive] = useState(false)
  const videoRef  = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef    = useRef(null)

  useEffect(() => {
    startCam()
    return () => stopCam()
  }, [])

  async function startCam() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 } }
      })
      streamRef.current = stream
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      setActive(true)
      setMsg('Posicione a etiqueta no quadro e capture')
    } catch {
      setMsg('❌ Câmera não disponível.')
    }
  }

  function stopCam() {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
  }

  const capture = () => {
    const v = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(v, 0, 0);

    // Pré-processamento: Contraste e Grayscale para maximizar a precisão do OCR
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pix = imgData.data;
    const contrast = 60; 
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

    for (let i = 0; i < pix.length; i += 4) {
      let gray = 0.2126 * pix[i] + 0.7152 * pix[i + 1] + 0.0722 * pix[i + 2];
      gray = factor * (gray - 128) + 128;
      pix[i] = pix[i + 1] = pix[i + 2] = Math.max(0, Math.min(255, gray));
    }
    ctx.putImageData(imgData, 0, 0);
    
    stopCam();
    onCapture(canvas.toDataURL('image/jpeg', 0.85));
  };

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const img = new Image()
      img.onload = () => onCapture(ev.target.result);
      img.src = ev.target.result
    }
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
            <h3 style={{ margin: 0, fontSize: '1rem' }}>{title}</h3>
            {subtitle && <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-muted)' }}>{subtitle}</p>}
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
            }}>
            </div>
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

// ─── Busca de produto com digitação ──────────────────────────────────────────
function ProductSearch({ inventory, onSelect, placeholder = '🔍 Buscar produto...' }) {
  const [query, setQuery]   = useState('')
  const [open, setOpen]     = useState(false)
  const wrapRef             = useRef(null)

  const filtered = query.trim().length === 0
    ? inventory.filter(i => i.quantity > 0).slice(0, 8)
    : inventory.filter(i =>
        i.quantity > 0 &&
        i.name.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 10)

  // fecha ao clicar fora
  useEffect(() => {
    const handler = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: 1, minWidth: 180 }}>
      <input
        type="text"
        value={query}
        placeholder={placeholder}
        autoComplete="off"
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        style={{
          width: '100%', boxSizing: 'border-box',
          fontSize: '0.8rem', padding: '5px 9px',
          borderRadius: 7, border: '1px solid #475569',
          background: '#334155', color: '#f1f5f9',
          outline: 'none',
        }}
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
          background: '#334155',
          border: '1px solid #475569',
          borderRadius: 8, marginTop: 2,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          maxHeight: 220, overflowY: 'auto',
        }}>
          {filtered.map(i => (
            <div
              key={i.id}
              onMouseDown={() => { onSelect(i.id); setQuery(i.name); setOpen(false) }}
              style={{
                padding: '7px 12px', fontSize: '0.8rem', cursor: 'pointer',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                borderBottom: '1px solid #475569',
                color: '#f1f5f9',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(99,102,241,0.25)'}
              onMouseLeave={e => e.currentTarget.style.background = ''}
            >
              <span>{i.name}</span>
              <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{i.quantity} un.</span>
            </div>
          ))}
        </div>
      )}
      {open && query.trim().length > 0 && filtered.length === 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
          background: '#334155', border: '1px solid #475569',
          borderRadius: 8, marginTop: 2, padding: '8px 12px',
          fontSize: '0.78rem', color: '#94a3b8',
        }}>
          Nenhum produto encontrado
        </div>
      )}
    </div>
  )
}

// ─── Card de cada pedido na fila ──────────────────────────────────────────────
function OrderCard({ order, inventory, selected, onToggleSelect, onScanProduct, onSetQty, onSelectProduct, onFinalize, onRemove }) {
  const { labelData, productData, status, quantity = 1 } = order

  const statusStyle = {
    loading:       { color: '#818cf8', label: '⏳ Analisando etiqueta...' },
    needs_product: { color: '#f59e0b', label: '🏷️ Aguardando produto' },
    ready:         { color: '#16a34a', label: '✅ Pronto para finalizar' },
    processing:    { color: '#818cf8', label: '⏳ Finalizando...' },
    done:          { color: '#64748b', label: '✔ Finalizado' },
  }[status] || { color: '#94a3b8', label: status }

  return (
    <div className="card" style={{
      borderLeft: `4px solid ${selected ? '#6366f1' : statusStyle.color}`,
      padding: '0.9rem 1rem',
      opacity: status === 'done' ? 0.6 : 1,
      transition: 'all 0.2s',
      outline: selected ? '2px solid #6366f1' : 'none',
      outlineOffset: 2,
    }}>
      {/* Status row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {/* Checkbox de seleção */}
          <input
            type="checkbox"
            checked={!!selected}
            onChange={onToggleSelect}
            style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#6366f1', flexShrink: 0 }}
            title="Selecionar para atribuição em lote"
          />
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: selected ? '#6366f1' : statusStyle.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {statusStyle.label}
          </span>
        </div>
        {status !== 'done' && status !== 'processing' && (
          <button onClick={onRemove} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem', padding: 0, lineHeight: 1 }}>✕</button>
        )}
      </div>

      {/* Dados da etiqueta */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.2rem 1rem', fontSize: '0.81rem', marginBottom: '0.6rem', color: '#1e293b' }}>
        {labelData?.customerName && <span>👤 <b>{labelData.customerName}</b></span>}
        {labelData?.location     && <span>📍 {labelData.location}</span>}
        {labelData?.cep          && <span>📮 {labelData.cep}</span>}
        {labelData?.bairro       && <span>🏘️ {labelData.bairro}</span>}
        {labelData?.rastreio     && <span style={{ gridColumn: 'span 2', fontFamily: 'monospace', fontSize: '0.78rem', color: '#1e293b' }}>📦 {labelData.rastreio}</span>}
        {labelData?.orderId      && <span>🔖 {labelData.orderId}</span>}
        {labelData?.modalidade   && <span>🚚 {labelData.modalidade}</span>}
        {status === 'loading' && <span style={{ gridColumn: 'span 2', color: 'var(--text-muted)' }}>Processando dados...</span>}
        {!labelData && status !== 'loading' && (
          <span style={{ gridColumn: 'span 2', color: 'var(--text-muted)', fontSize: '0.74rem', wordBreak: 'break-all' }}>
            {order.rawQR?.slice(0, 80)}{order.rawQR?.length > 80 ? '...' : ''}
          </span>
        )}
      </div>

      {/* Divisória + Produto */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.65rem' }}>
        {productData ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ fontSize: '0.82rem' }}>
              <span style={{ fontWeight: 600 }}>🏷️ {productData.name}</span>
              <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem' }}>({productData.quantity} em estoque)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Qtd:</label>
              <input
                type="number" min={1} max={productData.quantity} value={quantity}
                onChange={e => onSetQty(Math.max(1, Math.min(productData.quantity, Number(e.target.value))))}
                style={{ width: 56, padding: '3px 6px', fontSize: '0.82rem', textAlign: 'center' }}
                disabled={status === 'done' || status === 'processing'}
              />
              <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--success)', minWidth: 70, textAlign: 'right' }}>
                {formatCurrency(productData.price * quantity)}
              </span>
            </div>
          </div>
        ) : status !== 'loading' ? (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Produto:</span>
            <ProductSearch inventory={inventory} onSelect={onSelectProduct} />
          </div>
        ) : null}
      </div>

      {/* Botões de ação */}
      {status !== 'done' && status !== 'loading' && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.65rem', flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary btn-sm"
            style={{ flex: 1, fontSize: '0.78rem' }}
            onClick={onScanProduct}
            disabled={status === 'processing'}
          >
            {productData ? '🔄 Trocar Produto' : '🏷️ Identificar Produto'}
          </button>
          {status === 'ready' && (
            <button
              className="btn btn-primary btn-sm"
              style={{ flex: 1, fontSize: '0.78rem', background: 'var(--success)', borderColor: 'var(--success)' }}
              onClick={onFinalize}
            >
              🔥 Finalizar Pedido
            </button>
          )}
        </div>
      )}

      {status === 'done' && (
        <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: '#16a34a', fontWeight: 600 }}>
          ✅ Pedido registrado e estoque atualizado!
        </div>
      )}
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────
export function BatchScanner({ inventory, setInventory, transactions, setTransactions, pessoas, setPessoas, addToast }) {
  const [orders, setOrders] = useState([])
  const [camera, setCamera] = useState(null)
  const [qrCamera, setQrCamera] = useState(null)
  const [qrKey, setQrKey] = useState(0)
  const [selected, setSelected] = useState(new Set()) // ids selecionados
  const [bulkProduct, setBulkProduct] = useState('')   // produto para atribuição em lote
  const [bulkKey, setBulkKey] = useState(0)            // força reset do ProductSearch em lote
  const [dropOver, setDropOver] = useState(false)      // arrastar múltiplas etiquetas
  const queueRef           = useRef([])                // fila de dataUrls aguardando
  const isProcessingRef    = useRef(false)             // flag: já há processamento ativo
  const processLabelImgRef = useRef(null)              // ref para sempre ter a versão atual
  const [queueInfo, setQueueInfo] = useState({ active: false, total: 0, done: 0 })

  // ── Abre câmera para ler etiqueta ───────────────────────────────────────────
  const openLabelScan = () => setCamera({ mode: 'label' })

  // ── Processar uma imagem de etiqueta (shared entre câmera e drag) ───────────
  const processLabelImage = useCallback(async (imageData) => {
    const tempId = generateId()
    setOrders(prev => [...prev, { id: tempId, status: 'loading', labelData: null, productData: null, quantity: 1 }])
    try {
      const { data: { text } } = await Tesseract.recognize(imageData, 'por')
      const data = await analyzeText(text, inventory, pessoas)
      if (data && (data.customerName || data.location || data.orderId)) {
        setOrders(prev => prev.map(o => o.id === tempId ? { ...o, labelData: data, status: 'needs_product' } : o))
        return tempId
      }
      const b64 = imageData.includes(',') ? imageData.split(',')[1] : imageData
      const visionData = await analyzeDocument(`data:image/jpeg;base64,${b64}`, inventory, pessoas)
      if (visionData && (visionData.customerName || visionData.location)) {
        setOrders(prev => prev.map(o => o.id === tempId ? { ...o, labelData: visionData, status: 'needs_product' } : o))
        return tempId
      }
      throw new Error('Não foi possível identificar o destinatário.')
    } catch (err) {
      setOrders(prev => prev.filter(o => o.id !== tempId))
      addToast(`Falha: ${err.message}`, 'error')
      return null
    }
  }, [inventory, pessoas, addToast])

  // Mantém a ref sempre apontando para a versão atual de processLabelImage
  processLabelImgRef.current = processLabelImage

  // ── Fila sequencial com while loop — sem stale closure ─────────────────────
  // Definida como ref para poder ser chamada de qualquer lugar sem deps
  const startQueue = useRef(async () => {
    if (isProcessingRef.current) return   // já rodando, a fila vai ser consumida pelo loop
    isProcessingRef.current = true

    while (queueRef.current.length > 0) {
      const dataUrl = queueRef.current.shift()
      setQueueInfo(prev => ({ ...prev, active: true }))

      const id = await processLabelImgRef.current(dataUrl)
      if (id) setSelected(prev => new Set([...prev, id]))

      setQueueInfo(prev => ({ ...prev, done: prev.done + 1 }))

      // pausa entre etiquetas para a IA respirar
      if (queueRef.current.length > 0) {
        await new Promise(r => setTimeout(r, 500))
      }
    }

    isProcessingRef.current = false
    setQueueInfo({ active: false, total: 0, done: 0 })
  }).current

  // ── Drag & drop: adiciona à fila e dispara o processador ───────────────────
  const handleMultiDrop = useCallback(async (e) => {
    e.preventDefault()
    setDropOver(false)
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
    if (!files.length) { addToast('Arraste imagens de etiquetas.', 'warning'); return }

    for (const file of files) {
      const dataUrl = await new Promise((res, rej) => {
        const reader = new FileReader()
        reader.onload = ev => res(ev.target.result)
        reader.onerror = rej
        reader.readAsDataURL(file)
      })
      queueRef.current.push(dataUrl)
    }

    setQueueInfo(prev => ({
      active: true,
      total: prev.total + files.length,
      done: prev.done,
    }))

    addToast(`📥 ${files.length} na fila — processando uma por vez`, 'info')
    startQueue()   // inicia o loop (ignora se já estiver rodando)
  }, [addToast, startQueue])

  // ── Abre scanner QR para o produto de um pedido específico ─────────────────
  const openProductScan = (orderId) => {
    setQrCamera(null) // garante desmonte antes de remontar
    setTimeout(() => {
      setQrKey(k => k + 1) // novo key = componente completamente novo
      setQrCamera({ orderId })
    }, 80) // pequeno delay para câmera anterior liberar
  }

  // ── Callback quando QR do produto é lido ───────────────────────────────────
  const handleQrScan = useCallback((qrData, orderId) => {
    setQrCamera(null)
    const lower = qrData.toLowerCase().trim()

    // Tenta associar o conteúdo do QR a um produto do estoque
    const product = inventory.find(p =>
      lower.includes(p.id?.toLowerCase()) ||
      lower.includes(p.name?.toLowerCase()) ||
      p.name?.toLowerCase().includes(lower.split(/[\n|,]/)[0].trim())
    )

    if (product) {
      setOrders(prev => prev.map(o => o.id === orderId
        ? { ...o, productData: product, status: 'ready' }
        : o
      ))
      addToast(`🏷️ Produto: ${product.name}`, 'success')
    } else {
      // QR não bateu com nenhum produto — salva o texto cru para o usuário ver
      addToast(`QR lido (${qrData.slice(0, 40)}...). Selecione o produto manualmente.`, 'warning')
    }
  }, [inventory, addToast])

  // ── Callback quando foto de etiqueta é capturada ────────────────────────────
  const handleCapture = useCallback(async (imageData) => {
    const mode = camera?.mode;
    const targetOrderId = camera?.orderId;
    setCamera(null)

    if (mode === 'label') {
      const tempId = generateId()
      setOrders(prev => [...prev, { id: tempId, status: 'loading', labelData: null, productData: null, quantity: 1 }])

      try {
        // 1) OCR local (Tesseract) — offline e gratuito
        const { data: { text } } = await Tesseract.recognize(imageData, 'por')
        const data = await analyzeText(text, inventory, pessoas)

        if (data && (data.customerName || data.location || data.orderId)) {
          setOrders(prev => prev.map(o => o.id === tempId
            ? { ...o, labelData: data, status: 'needs_product' }
            : o
          ))
          addToast(`✅ Destinatário: ${data.customerName || 'Identificado'}`, 'success')
          // 🔁 Abre scanner QR para identificar o produto automaticamente
          setQrKey(k => k + 1)
          setQrCamera({ orderId: tempId })
          return
        }

        // 2) Fallback Vision AI — quando Tesseract não extrai dados suficientes
        addToast('Refinando com IA visual...', 'info')
        const b64 = imageData.includes(',') ? imageData.split(',')[1] : imageData
        const visionData = await analyzeDocument(`data:image/jpeg;base64,${b64}`, inventory, pessoas)
        if (visionData && (visionData.customerName || visionData.location)) {
          setOrders(prev => prev.map(o => o.id === tempId
            ? { ...o, labelData: visionData, status: 'needs_product' }
            : o
          ))
          addToast(`✅ Lido pela IA: ${visionData.customerName || 'OK'}`, 'success')
          // 🔁 Abre scanner QR para identificar o produto automaticamente
          setQrKey(k => k + 1)
          setQrCamera({ orderId: tempId })
        } else {
          throw new Error('Não foi possível identificar o destinatário. Tente outra foto.')
        }
      } catch (err) {
        setOrders(prev => prev.filter(o => o.id !== tempId))
        addToast(`Falha na leitura: ${err.message}`, 'error')
      }
    }

  }, [camera, inventory, pessoas, addToast, setOrders])

  // ── Seleciona produto manualmente ───────────────────────────────────────────
  const selectProduct = useCallback((orderId, productId) => {
    const product = inventory.find(p => p.id === productId)
    if (!product) return
    setOrders(prev => prev.map(o => o.id === orderId
      ? { ...o, productData: product, status: 'ready' }
      : o
    ))
  }, [inventory])

  // ── Finaliza um pedido ──────────────────────────────────────────────────────
  const finalizeOrder = useCallback(async (orderId) => {
    const order = orders.find(o => o.id === orderId)
    if (!order?.productData) return

    const { labelData, productData, quantity = 1 } = order

    if (Number(productData.quantity) < quantity) {
      addToast('Estoque insuficiente!', 'error')
      return
    }

    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'processing' } : o))

    try {
      // Cliente
      const customerName = labelData?.customerName?.trim() || 'Desconhecido'
      let pessoa = pessoas.find(p => p.name.toLowerCase() === customerName.toLowerCase())
      if (!pessoa && customerName !== 'Desconhecido') {
        pessoa = { id: generateId(), name: customerName, document: '', role: 'cliente', contact: '' }
        if (setPessoas) setPessoas(prev => [...prev, pessoa])
        await supabase.from('pessoas').insert([pessoa])
      }

      // Geocode
      const geoQuery = labelData?.cep || labelData?.location || ''
      const geo  = geoQuery ? await geocode(geoQuery) : null
      const city = geo?.city || (labelData?.location || 'Desconhecido').split('-')[0].split(',')[0].trim()

      // Empacota nome com localização
      const packed = packLocation(productData.name, {
        city, lat: geo?.lat, lng: geo?.lng,
        orderId:    labelData?.orderId  || '',
        cep:        labelData?.cep      || '',
        address:    labelData?.address  || '',
        bairro:     labelData?.bairro   || '',
        rastreio:   labelData?.rastreio || '',
        modalidade: labelData?.modalidade || '',
      })

      const newQty = Number(productData.quantity) - quantity
      const tx = {
        id: generateId(), type: 'saída',
        itemId: productData.id, itemName: packed, city,
        quantity, unitPrice: productData.price,
        totalValue: productData.price * quantity,
        personName: pessoa?.name || customerName,
        date: formatDate(),
      }

      const [{ error: e1 }, { error: e2 }] = await Promise.all([
        supabase.from('inventory').update({ quantity: newQty }).eq('id', productData.id),
        supabase.from('transactions').insert([tx]),
      ])
      if (e1 || e2) throw new Error('Erro ao salvar no banco.')

      setInventory(prev => prev.map(i => i.id === productData.id ? { ...i, quantity: newQty } : i))
      setTransactions(prev => [...prev, tx])
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'done' } : o))
      addToast(`🔥 Pedido de ${quantity}x "${productData.name}" finalizado!`, 'success')
    } catch (err) {
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'ready' } : o))
      addToast(`Erro: ${err.message}`, 'error')
    }
  }, [orders, inventory, pessoas, setPessoas, setInventory, setTransactions, addToast])

  // ── Atribui produto em lote para os selecionados ───────────────────────────
  const applyBulkProduct = useCallback(() => {
    if (!bulkProduct) { addToast('Selecione um produto primeiro.', 'warning'); return }
    const product = inventory.find(p => p.id === bulkProduct)
    if (!product) return
    setOrders(prev => prev.map(o =>
      selected.has(o.id) && o.status !== 'done' && o.status !== 'processing'
        ? { ...o, productData: product, status: 'ready' }
        : o
    ))
    addToast(`🏷️ "${product.name}" aplicado a ${selected.size} pedido(s)!`, 'success')
    setSelected(new Set())
    setBulkProduct('')
    setBulkKey(k => k + 1)
  }, [bulkProduct, inventory, selected, addToast])

  // ── Toggle seleção de um pedido ─────────────────────────────────────────────
  const toggleSelect = useCallback((orderId) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }, [])

  // ── Finaliza todos os prontos ───────────────────────────────────────────────
  const finalizeAll = useCallback(async () => {
    const ready = orders.filter(o => o.status === 'ready')
    for (const o of ready) await finalizeOrder(o.id)
  }, [orders, finalizeOrder])

  const readyCount = orders.filter(o => o.status === 'ready').length
  const doneCount  = orders.filter(o => o.status === 'done').length
  const activeOrders = orders.filter(o => o.status !== 'done')

  return (
    <div>
      {/* Toolbar — sticky para ficar visível ao rolar a fila */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--bg, #0f172a)',
        paddingBottom: '0.5rem',
        paddingTop: '0.25rem',
        marginBottom: '0.5rem',
      }}>
        <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={openLabelScan} style={{ gap: '0.4rem' }}>
            Adicionar Etiqueta
          </button>

          {/* Zona de arrastar — sempre visível na toolbar */}
          <div
            onDragOver={e => { e.preventDefault(); setDropOver(true) }}
            onDragLeave={() => setDropOver(false)}
            onDrop={handleMultiDrop}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
              padding: '0.55rem 1.4rem',
              borderRadius: 10,
              border: dropOver
                ? '2px dashed #6366f1'
                : queueInfo.active
                ? '2px dashed #f59e0b'
                : '2px dashed var(--border)',
              background: dropOver
                ? 'rgba(99,102,241,0.10)'
                : queueInfo.active
                ? 'rgba(245,158,11,0.08)'
                : 'rgba(255,255,255,0.02)',
              fontSize: '0.82rem', fontWeight: 500,
              color: dropOver ? '#6366f1' : queueInfo.active ? '#f59e0b' : 'var(--text-muted)',
              cursor: 'default', transition: 'all 0.15s',
              userSelect: 'none', minWidth: 220,
            }}
          >
            {queueInfo.active
              ? `⏳ ${queueInfo.done + 1} de ${queueInfo.total}... (solte mais)`
              : dropOver
              ? '📂 Solte para adicionar à fila'
              : '➕ Arraste etiquetas aqui'}
          </div>

        {readyCount > 1 && (
          <button
            className="btn btn-sm"
            style={{ background: 'var(--success)', color: '#fff', border: 'none' }}
            onClick={finalizeAll}
          >
            Finalizar Todos ({readyCount})
          </button>
        )}

        {orders.length > 0 && (
          <button className="btn btn-secondary btn-sm" onClick={() => { setOrders([]); setSelected(new Set()) }}>
            Limpar fila
          </button>
        )}

        {orders.length > 0 && (
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
            {orders.length} etiqueta(s) &middot; {readyCount} pronta(s) &middot; {doneCount} finalizada(s)
          </span>
        )}
        </div> {/* fim flex row */}
      </div> {/* fim sticky toolbar */}

      {selected.size > 0 && (
        <div style={{
          background: 'rgba(99,102,241,0.08)',
          border: '1.5px solid #6366f1',
          borderRadius: 12,
          padding: '0.75rem 1rem',
          marginBottom: '0.75rem',
          display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center',
        }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#6366f1' }}>
            {selected.size} selecionado(s)
          </span>

          <button
            className="btn btn-secondary btn-sm"
            style={{ fontSize: '0.76rem' }}
            onClick={() => {
              if (selected.size === activeOrders.length) setSelected(new Set())
              else setSelected(new Set(activeOrders.map(o => o.id)))
            }}
          >
            {selected.size === activeOrders.length ? 'Desmarcar todos' : 'Selecionar todos'}
          </button>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: 1, minWidth: 240 }}>
            <ProductSearch
              key={bulkKey}
              inventory={inventory}
              onSelect={id => setBulkProduct(id)}
              placeholder="🔍 Escolher produto para todos..."
            />
            <button
              className="btn btn-sm"
              style={{ background: '#6366f1', color: '#fff', border: 'none', whiteSpace: 'nowrap', fontSize: '0.78rem' }}
              onClick={applyBulkProduct}
              disabled={!bulkProduct}
            >
              Aplicar
            </button>
          </div>

          <button
            className="btn btn-secondary btn-sm"
            style={{ fontSize: '0.76rem', marginLeft: 'auto' }}
            onClick={() => setSelected(new Set())}
          >
            Cancelar
          </button>
        </div>
      )}

      {orders.length === 0 && (
        <div
          className="card"
          onDragOver={e => { e.preventDefault(); setDropOver(true) }}
          onDragLeave={() => setDropOver(false)}
          onDrop={handleMultiDrop}
          style={{
            textAlign: 'center', padding: '3rem 2rem', color: 'var(--text-muted)',
            border: dropOver ? '2px dashed #6366f1' : '2px dashed var(--border)',
            background: dropOver ? 'rgba(99,102,241,0.06)' : undefined,
            transition: 'all 0.15s',
          }}
        >
          <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>
            {queueInfo.active ? '⏳' : dropOver ? '📂' : '📷'}
          </div>
          {queueInfo.active ? (
            <div>
              <p style={{ fontWeight: 700, fontSize: '0.95rem', color: '#f59e0b', marginBottom: '0.3rem' }}>
                Processando {queueInfo.done + 1} de {queueInfo.total}...
              </p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Pode soltar mais etiquetas aqui — elas entram na fila automaticamente
              </p>
              {/* barra de progresso */}
              <div style={{ margin: '0.75rem auto', maxWidth: 260, height: 6, borderRadius: 99, background: 'var(--border)' }}>
                <div style={{
                  height: '100%', borderRadius: 99, background: '#f59e0b',
                  width: `${Math.round((queueInfo.done / queueInfo.total) * 100)}%`,
                  transition: 'width 0.4s',
                }} />
              </div>
            </div>
          ) : dropOver ? (
            <p style={{ fontWeight: 700, fontSize: '0.95rem', color: '#6366f1' }}>
              Solte para adicionar à fila
            </p>
          ) : (
            <div>
              <p style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.4rem' }}>Nenhuma etiqueta na fila</p>
              <p style={{ fontSize: '0.82rem', marginBottom: '0.75rem', lineHeight: 1.6 }}>
                Clique em <strong>Adicionar Etiqueta</strong> para usar a câmera,<br/>
                ou arraste fotos aqui — processa uma por vez, sem erros.
              </p>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                padding: '0.5rem 1rem', borderRadius: 8,
                border: '1.5px dashed #6366f1', color: '#6366f1',
                fontSize: '0.8rem', marginBottom: '1rem',
              }}>
                ➕ Arraste etiquetas aqui (uma por vez ou várias de uma vez)
              </div>
            </div>
          )}
        </div>
      )}

      {orders.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {orders.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              inventory={inventory}
              selected={selected.has(order.id)}
              onToggleSelect={() => toggleSelect(order.id)}
              onScanProduct={() => openProductScan(order.id)}
              onSetQty={qty => setOrders(prev => prev.map(o => o.id === order.id ? { ...o, quantity: qty } : o))}
              onSelectProduct={productId => selectProduct(order.id, productId)}
              onFinalize={() => finalizeOrder(order.id)}
              onRemove={() => setOrders(prev => prev.filter(o => o.id !== order.id))}
            />
          ))}
        </div>
      )}

      {camera && (
        <CameraModal
          title="Scanner de Etiqueta"
          subtitle="Enquadre o texto do destinatario da etiqueta"
          onCapture={handleCapture}
          onClose={() => setCamera(null)}
        />
      )}

      {qrCamera && (
        <QrScannerModal
          key={qrKey}
          title="QR Code do Produto"
          subtitle="Aponte para o QR Code da embalagem - leitura automatica"
          onScan={(data) => handleQrScan(data, qrCamera.orderId)}
          onClose={() => setQrCamera(null)}
        />
      )}
    </div>
  )
}
