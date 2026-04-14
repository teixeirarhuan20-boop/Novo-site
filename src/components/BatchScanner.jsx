import React, { useState, useRef, useCallback, useEffect } from 'react'
import Tesseract from 'tesseract.js'
import { analyzeDocument, analyzeText } from '../lib/gemini'
import { supabase } from '../lib/supabase'
import { generateId, formatDate, formatCurrency } from '../utils/formatting'
import { geocode, packLocation } from '../utils/location'

// ─── Carrega jsQR via CDN ─────────────────────────────────────────────────────
function loadJsQR() {
  return new Promise(resolve => {
    if (window.jsQR) { resolve(window.jsQR); return }
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'
    s.onload  = () => resolve(window.jsQR)
    s.onerror = () => resolve(null)
    document.head.appendChild(s)
  })
}

// ─── Modal de câmera unificado ────────────────────────────────────────────────
// mode: 'photo' → captura frame e envia pra IA
//        'qr'   → scan loop até encontrar QR code
function CameraModal({ title, subtitle, mode, onPhoto, onQR, onClose }) {
  const [msg,    setMsg]    = useState('Iniciando câmera...')
  const [active, setActive] = useState(false)
  const [flash,  setFlash]  = useState(false)

  const videoRef  = useRef(null)
  const streamRef = useRef(null)
  const rafRef    = useRef(null)

  useEffect(() => { startCam(); return stopCam }, [])

  async function startCam() {
    if (mode === 'qr') await loadJsQR()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      })
      streamRef.current = stream
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      setActive(true)
      setMsg(mode === 'photo'
        ? 'Enquadre o DESTINATÁRIO e clique em Capturar'
        : 'Aponte para o QR Code da etiqueta')
      if (mode === 'qr') rafRef.current = requestAnimationFrame(tick)
    } catch {
      setMsg('❌ Câmera não disponível — use "Carregar imagem" abaixo.')
    }
  }

  function stopCam() {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
  }

  // Loop de scan QR
  function tick() {
    const v = videoRef.current, c = document.createElement('canvas')
    if (!v || v.readyState !== v.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(tick); return
    }
    c.width = v.videoWidth; c.height = v.videoHeight
    c.getContext('2d').drawImage(v, 0, 0)
    const imgData = c.getContext('2d').getImageData(0, 0, c.width, c.height)
    const code = window.jsQR?.(imgData.data, imgData.width, imgData.height, { inversionAttempts: 'dontInvert' })
    if (code?.data) {
      stopCam()
      onQR?.(code.data)
    } else {
      rafRef.current = requestAnimationFrame(tick)
    }
  }

  // Captura foto — desenha frame ANTES de parar (iOS apaga stream imediatamente)
  function capture() {
    const v = videoRef.current
    if (!v || !v.videoWidth) { setMsg('⚠️ Câmera ainda iniciando, tente novamente.'); return }

    const c = document.createElement('canvas')
    c.width  = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d').drawImage(v, 0, 0)  // captura frame

    setFlash(true)
    setTimeout(() => setFlash(false), 200)
    stopCam()  // para câmera DEPOIS de capturar

    onPhoto?.(c.toDataURL('image/jpeg', 0.92))
  }

  // Upload de imagem da galeria
  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      stopCam()
      if (mode === 'photo') {
        onPhoto?.(ev.target.result)
      } else {
        const img = new Image()
        img.onload = () => {
          const c = document.createElement('canvas')
          c.width = img.width; c.height = img.height
          c.getContext('2d').drawImage(img, 0, 0)
          const imgData = c.getContext('2d').getImageData(0, 0, c.width, c.height)
          const code = window.jsQR?.(imgData.data, imgData.width, imgData.height)
          if (code?.data) onQR?.(code.data)
          else setMsg('❌ QR Code não encontrado na imagem.')
        }
        img.src = ev.target.result
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const borderColor = mode === 'photo' ? '#3b82f6' : '#22c55e'
  const frameStyle  = mode === 'photo'
    ? { width: '90%', height: '65%', borderRadius: 8 }
    : { width: 200,   height: 200,   borderRadius: 14 }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)',
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

        {/* Viewfinder */}
        <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', background: '#0f172a', aspectRatio: '4/3' }}>
          <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />

          {flash && <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.5)', pointerEvents: 'none' }} />}

          {active && (
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%,-50%)',
              border: `2px solid ${borderColor}`,
              boxShadow: `0 0 0 9999px rgba(0,0,0,0.45)`,
              pointerEvents: 'none',
              ...frameStyle,
            }}>
              {mode === 'qr' && [
                { top: -3, left: -3,   borderTop: `3px solid ${borderColor}`, borderLeft:  `3px solid ${borderColor}`, borderRadius: '6px 0 0 0' },
                { top: -3, right: -3,  borderTop: `3px solid ${borderColor}`, borderRight: `3px solid ${borderColor}`, borderRadius: '0 6px 0 0' },
                { bottom: -3, left: -3,  borderBottom: `3px solid ${borderColor}`, borderLeft:  `3px solid ${borderColor}`, borderRadius: '0 0 0 6px' },
                { bottom: -3, right: -3, borderBottom: `3px solid ${borderColor}`, borderRight: `3px solid ${borderColor}`, borderRadius: '0 0 6px 0' },
              ].map((s, i) => (
                <div key={i} style={{ position: 'absolute', width: 22, height: 22, ...s }} />
              ))}

              {mode === 'photo' && (
                <div style={{
                  position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
                  background: 'rgba(59,130,246,0.85)', color: '#fff',
                  fontSize: '0.7rem', fontWeight: 600, padding: '2px 10px', borderRadius: 99,
                  whiteSpace: 'nowrap',
                }}>
                  DESTINATÁRIO
                </div>
              )}
            </div>
          )}
        </div>

        <p style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.5rem 0' }}>{msg}</p>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {mode === 'photo' && (
            <button className="btn btn-primary" style={{ flex: 2 }} onClick={capture} disabled={!active}>
              📸 Capturar
            </button>
          )}
          <label className="btn btn-secondary" style={{ flex: mode === 'photo' ? 1 : 2, textAlign: 'center', cursor: 'pointer' }}>
            📁 {mode === 'photo' ? 'Galeria' : 'Carregar imagem do QR'}
            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
          </label>
        </div>
      </div>
    </div>
  )
}

// ─── QR Scanner para produto ──────────────────────────────────────────────────
function ProductCameraModal({ onQR, onClose }) {
  return (
    <CameraModal
      mode="qr"
      title="🏷️ Identificar Produto"
      subtitle="Aponte para o QR Code do produto em estoque"
      onQR={onQR}
      onClose={onClose}
    />
  )
}

// ─── Card de cada pedido na fila ──────────────────────────────────────────────
function OrderCard({ order, inventory, onScanProduct, onSetQty, onSelectProduct, onFinalize, onRemove }) {
  const { labelData, productData, status, quantity = 1, loadingMsg } = order

  const statusStyle = {
    loading:       { color: '#818cf8', label: loadingMsg || '⏳ Analisando etiqueta...' },
    needs_product: { color: '#f59e0b', label: '🏷️ Aguardando produto' },
    ready:         { color: '#16a34a', label: '✅ Pronto para finalizar' },
    processing:    { color: '#818cf8', label: '⏳ Finalizando...' },
    done:          { color: '#64748b', label: '✔ Finalizado' },
  }[status] || { color: '#94a3b8', label: status }

  return (
    <div className="card" style={{
      borderLeft: `4px solid ${statusStyle.color}`,
      padding: '0.9rem 1rem',
      opacity: status === 'done' ? 0.6 : 1,
      transition: 'opacity 0.3s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: statusStyle.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {statusStyle.label}
        </span>
        {status !== 'done' && status !== 'processing' && (
          <button onClick={onRemove} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem', padding: 0, lineHeight: 1 }}>✕</button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.2rem 1rem', fontSize: '0.81rem', marginBottom: '0.6rem' }}>
        {labelData?.customerName && <span>👤 <b>{labelData.customerName}</b></span>}
        {labelData?.location     && <span>📍 {labelData.location}</span>}
        {labelData?.cep          && <span>📮 {labelData.cep}</span>}
        {labelData?.bairro       && <span>🏘️ {labelData.bairro}</span>}
        {labelData?.address      && <span style={{ gridColumn: 'span 2', fontSize: '0.76rem' }}>🏠 {labelData.address}</span>}
        {labelData?.rastreio     && <span style={{ gridColumn: 'span 2', fontFamily: 'monospace', fontSize: '0.76rem' }}>📦 {labelData.rastreio}</span>}
        {labelData?.orderId      && <span>🔖 {labelData.orderId}</span>}
        {labelData?.modalidade   && <span>🚚 {labelData.modalidade}</span>}
        {status === 'loading' && (
          <span style={{ gridColumn: 'span 2', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            🤖 {loadingMsg || 'Processando...'}
          </span>
        )}
        {!labelData && status !== 'loading' && (
          <span style={{ gridColumn: 'span 2', color: 'var(--text-muted)', fontSize: '0.74rem' }}>
            ⚠️ Dados não extraídos — selecione o produto e finalize manualmente.
          </span>
        )}
      </div>

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
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Produto:</span>
            <select
              defaultValue=""
              onChange={e => onSelectProduct(e.target.value)}
              style={{ fontSize: '0.78rem', padding: '3px 6px', flex: 1, minWidth: 150 }}
            >
              <option value="" disabled>Selecionar manualmente...</option>
              {inventory.filter(i => i.quantity > 0).map(i => (
                <option key={i.id} value={i.id}>{i.name} ({i.quantity} un.)</option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {status !== 'done' && status !== 'loading' && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.65rem', flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary btn-sm"
            style={{ flex: 1, fontSize: '0.78rem' }}
            onClick={onScanProduct}
            disabled={status === 'processing'}
          >
            {productData ? '🔄 Trocar Produto' : '🏷️ Ler QR do Produto'}
          </button>
          {status === 'ready' && (
            <button
              className="btn btn-sm"
              style={{ flex: 1, fontSize: '0.78rem', background: 'var(--success)', color: '#fff', border: 'none' }}
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
  const [orders,  setOrders]  = useState([])
  const [camera,  setCamera]  = useState(null)

  const openPhotoLabel = () => setCamera({ type: 'photo-label' })
  const openQRLabel    = () => setCamera({ type: 'qr-label' })
  const openProduct    = (orderId) => setCamera({ type: 'product', orderId })

  // Helper para atualizar loadingMsg do card
  const setLoadingMsg = (tempId, msg) =>
    setOrders(prev => prev.map(o => o.id === tempId ? { ...o, loadingMsg: msg } : o))

  // ── Processa foto da etiqueta: Gemini Vision → Tesseract fallback ───────────
  const handleLabelPhoto = useCallback(async (base64) => {
    setCamera(null)
    const tempId = generateId()
    setOrders(prev => [...prev, { id: tempId, status: 'loading', loadingMsg: '🤖 Gemini Vision...', labelData: null, productData: null, quantity: 1 }])

    try {
      // ── 1ª tentativa: Gemini Vision ────────────────────────────────────────
      setLoadingMsg(tempId, '🤖 Gemini Vision lendo...')
      let data = await analyzeDocument(base64, inventory, pessoas)

      // ── 2ª tentativa: Tesseract OCR → Gemini Texto ─────────────────────────
      if (!data) {
        setLoadingMsg(tempId, '📝 OCR local...')
        try {
          // Converte base64 para blob
          const res  = await fetch(base64)
          const blob = await res.blob()

          const result = await Tesseract.recognize(blob, 'por+eng', {
            logger: m => {
              if (m.status === 'recognizing text') {
                setLoadingMsg(tempId, `📝 OCR: ${Math.round(m.progress * 100)}%`)
              }
            }
          })

          const ocrText = result.data.text?.trim()
          console.log('[Tesseract OCR]', ocrText?.slice(0, 200))

          if (ocrText && ocrText.length > 15) {
            setLoadingMsg(tempId, '🤖 Refinando com IA...')
            data = await analyzeText(ocrText, inventory, pessoas)
          }
        } catch (ocrErr) {
          console.warn('[Tesseract fallback]', ocrErr.message)
        }
      }

      setOrders(prev => prev.map(o => o.id === tempId
        ? { ...o, labelData: data || null, status: 'needs_product', loadingMsg: null }
        : o
      ))

      if (data?.customerName || data?.cep || data?.location) {
        const nome = data.customerName || data.location || 'ok'
        addToast(`✅ Etiqueta lida: ${nome}`, 'success')
      } else {
        addToast('⚠️ Dados não extraídos. Selecione o produto manualmente.', 'warning')
      }
    } catch (err) {
      setOrders(prev => prev.map(o => o.id === tempId
        ? { ...o, labelData: null, status: 'needs_product', loadingMsg: null }
        : o
      ))
      addToast(`Erro ao analisar foto: ${err.message}`, 'error')
    }
  }, [inventory, pessoas, addToast])

  // ── Processa QR da etiqueta ────────────────────────────────────────────────
  const handleLabelQR = useCallback(async (rawData) => {
    setCamera(null)
    const tempId = generateId()
    setOrders(prev => [...prev, { id: tempId, status: 'loading', loadingMsg: '🤖 Analisando QR...', rawQR: rawData, labelData: null, productData: null, quantity: 1 }])

    try {
      try {
        const parsed = JSON.parse(rawData)
        if (parsed.id && parsed.name) {
          addToast('Este QR é de produto — use "Ler QR do Produto" no pedido.', 'warning')
          setOrders(prev => prev.filter(o => o.id !== tempId))
          return
        }
      } catch {}

      const data = await analyzeText(rawData, inventory, pessoas)
      setOrders(prev => prev.map(o => o.id === tempId
        ? { ...o, labelData: data, status: 'needs_product', loadingMsg: null }
        : o
      ))
      addToast(`✅ QR lido: ${data?.customerName || data?.location || 'ok'}`, 'success')
    } catch (err) {
      setOrders(prev => prev.map(o => o.id === tempId
        ? { ...o, labelData: null, status: 'needs_product', loadingMsg: null }
        : o
      ))
      addToast(`Erro ao analisar QR: ${err.message}`, 'error')
    }
  }, [inventory, pessoas, addToast])

  // ── Processa QR do produto ─────────────────────────────────────────────────
  const handleProductQR = useCallback((rawData, orderId) => {
    setCamera(null)
    let product = null
    try {
      const parsed = JSON.parse(rawData)
      product = inventory.find(p => p.id === parsed.id || p.name === parsed.name)
    } catch {}
    if (!product) {
      const lower = rawData.toLowerCase().trim()
      product = inventory.find(p => {
        const n = p.name.toLowerCase()
        return lower.includes(n) || n.includes(lower.slice(0, 12))
      })
    }
    if (product) {
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, productData: product, status: 'ready' } : o))
      addToast(`🏷️ Produto: ${product.name}`, 'success')
    } else {
      addToast('Produto não identificado. Selecione manualmente.', 'warning')
    }
  }, [inventory, addToast])

  const selectProduct = useCallback((orderId, productId) => {
    const product = inventory.find(p => p.id === productId)
    if (!product) return
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, productData: product, status: 'ready' } : o))
  }, [inventory])

  // ── Finaliza pedido ────────────────────────────────────────────────────────
  const finalizeOrder = useCallback(async (orderId) => {
    const order = orders.find(o => o.id === orderId)
    if (!order?.productData) return
    const { labelData, productData, quantity = 1 } = order
    if (Number(productData.quantity) < quantity) { addToast('Estoque insuficiente!', 'error'); return }

    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'processing' } : o))
    try {
      const customerName = labelData?.customerName?.trim() || 'Desconhecido'
      let pessoa = pessoas.find(p => p.name.toLowerCase() === customerName.toLowerCase())
      if (!pessoa && customerName !== 'Desconhecido') {
        pessoa = { id: generateId(), name: customerName, document: '', role: 'cliente', contact: '' }
        if (setPessoas) setPessoas(prev => [...prev, pessoa])
        await supabase.from('pessoas').insert([pessoa])
      }

      const geoQuery = labelData?.cep || labelData?.location || ''
      const geo  = geoQuery ? await geocode(geoQuery) : null
      const city = geo?.city || (labelData?.location || 'Desconhecido').split(',')[0].split('-')[0].trim()

      const packed = packLocation(productData.name, {
        city, lat: geo?.lat, lng: geo?.lng,
        orderId:    labelData?.orderId    || '',
        cep:        labelData?.cep        || '',
        address:    labelData?.address    || '',
        bairro:     labelData?.bairro     || '',
        rastreio:   labelData?.rastreio   || '',
        modalidade: labelData?.modalidade || '',
      })

      const newQty = Number(productData.quantity) - quantity
      const tx = {
        id: generateId(), type: 'saída',
        itemId: productData.id, itemName: packed, city,
        quantity, unitPrice: productData.price,
        totalValue: productData.price * quantity,
        personName: pessoa?.name || customerName, date: formatDate(),
      }

      const [{ error: e1 }, { error: e2 }] = await Promise.all([
        supabase.from('inventory').update({ quantity: newQty }).eq('id', productData.id),
        supabase.from('transactions').insert([tx]),
      ])
      if (e1 || e2) throw new Error('Erro ao salvar.')

      setInventory(prev => prev.map(i => i.id === productData.id ? { ...i, quantity: newQty } : i))
      setTransactions(prev => [...prev, tx])
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'done' } : o))
      addToast(`🔥 ${quantity}x "${productData.name}" finalizado!`, 'success')
    } catch (err) {
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'ready' } : o))
      addToast(`Erro: ${err.message}`, 'error')
    }
  }, [orders, inventory, pessoas, setPessoas, setInventory, setTransactions, addToast])

  const finalizeAll = useCallback(async () => {
    for (const o of orders.filter(o => o.status === 'ready')) await finalizeOrder(o.id)
  }, [orders, finalizeOrder])

  const readyCount = orders.filter(o => o.status === 'ready').length
  const doneCount  = orders.filter(o => o.status === 'done').length

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        <button className="btn btn-primary" onClick={openPhotoLabel}>
          📸 Fotografar Etiqueta
        </button>
        <button className="btn btn-secondary" onClick={openQRLabel}>
          📷 QR da Etiqueta
        </button>
        {readyCount > 1 && (
          <button className="btn btn-sm" style={{ background: 'var(--success)', color: '#fff', border: 'none' }} onClick={finalizeAll}>
            ✅ Finalizar Todos ({readyCount})
          </button>
        )}
        {orders.length > 0 && (
          <button className="btn btn-secondary btn-sm" onClick={() => setOrders([])}>🗑️ Limpar</button>
        )}
        {orders.length > 0 && (
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
            {orders.length} etiqueta(s) · {readyCount} pronta(s) · {doneCount} finalizada(s)
          </span>
        )}
      </div>

      {/* Empty state */}
      {orders.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem 2rem', color: 'var(--text-muted)', border: '2px dashed var(--border)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>📸</div>
          <p style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.5rem' }}>Nenhuma etiqueta na fila</p>
          <p style={{ fontSize: '0.82rem', lineHeight: 1.7, marginBottom: '1rem' }}>
            <b>📸 Fotografar Etiqueta</b> — aponte a câmera e a IA lê nome, CEP, cidade, endereço e bairro.<br/>
            <b>📷 QR da Etiqueta</b> — escaneia o QR Code impresso na etiqueta.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', fontSize: '0.78rem' }}>
            <span>📦 Shopee</span><span>·</span><span>📮 Correios</span><span>·</span><span>🚚 Jadlog</span>
          </div>
        </div>
      )}

      {/* Lista de pedidos */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {orders.map(order => (
          <OrderCard
            key={order.id}
            order={order}
            inventory={inventory}
            onScanProduct={() => openProduct(order.id)}
            onSetQty={qty => setOrders(prev => prev.map(o => o.id === order.id ? { ...o, quantity: qty } : o))}
            onSelectProduct={productId => selectProduct(order.id, productId)}
            onFinalize={() => finalizeOrder(order.id)}
            onRemove={() => setOrders(prev => prev.filter(o => o.id !== order.id))}
          />
        ))}
      </div>

      {/* Modais */}
      {camera?.type === 'photo-label' && (
        <CameraModal
          mode="photo"
          title="📸 Fotografar Etiqueta"
          subtitle="Enquadre a área do DESTINATÁRIO — IA extrai nome, CEP, cidade, endereço"
          onPhoto={handleLabelPhoto}
          onClose={() => setCamera(null)}
        />
      )}
      {camera?.type === 'qr-label' && (
        <CameraModal
          mode="qr"
          title="📷 QR Code da Etiqueta"
          subtitle="Aponte para o QR Code impresso na etiqueta"
          onQR={handleLabelQR}
          onClose={() => setCamera(null)}
        />
      )}
      {camera?.type === 'product' && (
        <ProductCameraModal
          onQR={(raw) => handleProductQR(raw, camera.orderId)}
          onClose={() => setCamera(null)}
        />
      )}
    </div>
  )
}
