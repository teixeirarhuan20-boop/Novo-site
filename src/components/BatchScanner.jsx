import React, { useState, useRef, useCallback, useEffect } from 'react'
import { analyzeText } from '../lib/gemini'
import { supabase } from '../lib/supabase'
import { generateId, formatDate, formatCurrency } from '../utils/formatting'
import { geocode, packLocation } from '../utils/location'

// ─── Carrega jsQR via CDN ─────────────────────────────────────────────────────
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

// ─── Modal de câmera reutilizável ─────────────────────────────────────────────
function CameraModal({ title, subtitle, onDecoded, onClose }) {
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
    await loadJsQR()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 } }
      })
      streamRef.current = stream
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      setActive(true)
      setMsg('Aponte para o QR Code')
      rafRef.current = requestAnimationFrame(tick)
    } catch {
      setMsg('❌ Câmera não disponível — use "Carregar imagem" abaixo.')
    }
  }

  function stopCam() {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
  }

  function tick() {
    const v = videoRef.current, c = canvasRef.current
    if (!v || !c || v.readyState !== v.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(tick); return
    }
    c.width = v.videoWidth; c.height = v.videoHeight
    const ctx = c.getContext('2d')
    ctx.drawImage(v, 0, 0)
    const img = ctx.getImageData(0, 0, c.width, c.height)
    const code = window.jsQR?.(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
    if (code?.data) { stopCam(); onDecoded(code.data) }
    else rafRef.current = requestAnimationFrame(tick)
  }

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const img = new Image()
      img.onload = () => {
        const c = document.createElement('canvas')
        c.width = img.width; c.height = img.height
        const ctx = c.getContext('2d')
        ctx.drawImage(img, 0, 0)
        const imageData = ctx.getImageData(0, 0, c.width, c.height)
        const code = window.jsQR?.(imageData.data, imageData.width, imageData.height)
        if (code?.data) { stopCam(); onDecoded(code.data) }
        else setMsg('❌ QR Code não encontrado na imagem.')
      }
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
        <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', background: '#0f172a', aspectRatio: '4/3' }}>
          <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
          {active && (
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%,-50%)',
              width: 190, height: 190,
              border: '3px solid #22c55e', borderRadius: 14,
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
              pointerEvents: 'none',
            }}>
              {/* Corner accents */}
              {[
                { top: -3, left: -3,   borderTop: '3px solid #22c55e', borderLeft: '3px solid #22c55e',   borderRadius: '6px 0 0 0' },
                { top: -3, right: -3,  borderTop: '3px solid #22c55e', borderRight: '3px solid #22c55e',  borderRadius: '0 6px 0 0' },
                { bottom: -3, left: -3,  borderBottom: '3px solid #22c55e', borderLeft: '3px solid #22c55e',  borderRadius: '0 0 0 6px' },
                { bottom: -3, right: -3, borderBottom: '3px solid #22c55e', borderRight: '3px solid #22c55e', borderRadius: '0 0 6px 0' },
              ].map((s, i) => (
                <div key={i} style={{ position: 'absolute', width: 22, height: 22, ...s }} />
              ))}
            </div>
          )}
        </div>
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        <p style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.5rem 0' }}>{msg}</p>

        <label className="btn btn-secondary btn-sm" style={{ width: '100%', textAlign: 'center', cursor: 'pointer' }}>
          📁 Carregar imagem do QR
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
        </label>
      </div>
    </div>
  )
}

// ─── Card de cada pedido na fila ──────────────────────────────────────────────
function OrderCard({ order, inventory, onScanProduct, onSetQty, onSelectProduct, onFinalize, onRemove }) {
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
      borderLeft: `4px solid ${statusStyle.color}`,
      padding: '0.9rem 1rem',
      opacity: status === 'done' ? 0.6 : 1,
      transition: 'opacity 0.3s',
    }}>
      {/* Status row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: statusStyle.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {statusStyle.label}
        </span>
        {status !== 'done' && status !== 'processing' && (
          <button onClick={onRemove} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem', padding: 0, lineHeight: 1 }}>✕</button>
        )}
      </div>

      {/* Dados da etiqueta */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.2rem 1rem', fontSize: '0.81rem', marginBottom: '0.6rem' }}>
        {labelData?.customerName && <span>👤 <b>{labelData.customerName}</b></span>}
        {labelData?.location     && <span>📍 {labelData.location}</span>}
        {labelData?.cep          && <span>📮 {labelData.cep}</span>}
        {labelData?.bairro       && <span>🏘️ {labelData.bairro}</span>}
        {labelData?.rastreio     && <span style={{ gridColumn: 'span 2', fontFamily: 'monospace', fontSize: '0.78rem' }}>📦 {labelData.rastreio}</span>}
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

      {/* Botões de ação */}
      {status !== 'done' && status !== 'loading' && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.65rem', flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary btn-sm"
            style={{ flex: 1, fontSize: '0.78rem' }}
            onClick={onScanProduct}
            disabled={status === 'processing'}
          >
            {productData ? '🔄 Trocar QR Produto' : '🏷️ Ler QR do Produto'}
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
  const [camera, setCamera] = useState(null) // null | { mode: 'label' | 'product', orderId? }

  // ── Abre câmera para ler etiqueta ───────────────────────────────────────────
  const openLabelScan = () => setCamera({ mode: 'label' })

  // ── Abre câmera para ler QR do produto em um pedido específico ──────────────
  const openProductScan = (orderId) => setCamera({ mode: 'product', orderId })

  // ── Callback quando QR é decodificado ──────────────────────────────────────
  const handleDecoded = useCallback(async (rawData) => {
    setCamera(null)

    if (camera?.mode === 'label') {
      // Cria entry provisória
      const tempId = generateId()
      setOrders(prev => [...prev, { id: tempId, status: 'loading', rawQR: rawData, labelData: null, productData: null, quantity: 1 }])

      try {
        // Verifica se não é um QR do nosso sistema de produto
        try {
          const parsed = JSON.parse(rawData)
          if (parsed.id && parsed.name) {
            addToast('Este QR é de produto — use a opção "Ler QR do Produto" no pedido.', 'warning')
            setOrders(prev => prev.filter(o => o.id !== tempId))
            return
          }
        } catch {}

        // Manda pro Gemini para extrair dados da etiqueta
        const data = await analyzeText(rawData, inventory, pessoas)
        setOrders(prev => prev.map(o => o.id === tempId
          ? { ...o, labelData: data, status: 'needs_product' }
          : o
        ))
        const name = data?.customerName || data?.location || 'Etiqueta lida'
        addToast(`✅ Etiqueta: ${name}`, 'success')
      } catch (err) {
        setOrders(prev => prev.map(o => o.id === tempId
          ? { ...o, labelData: null, status: 'needs_product' }
          : o
        ))
        addToast(`Erro ao analisar etiqueta: ${err.message}`, 'error')
      }
    }

    if (camera?.mode === 'product' && camera.orderId) {
      const orderId = camera.orderId
      let product = null

      // Tenta JSON do nosso sistema
      try {
        const parsed = JSON.parse(rawData)
        product = inventory.find(p => p.id === parsed.id || p.name === parsed.name)
      } catch {}

      // Tenta match por texto
      if (!product) {
        const lower = rawData.toLowerCase().trim()
        product = inventory.find(p => {
          const n = p.name.toLowerCase()
          return lower.includes(n) || n.includes(lower.slice(0, 12))
        })
      }

      if (product) {
        setOrders(prev => prev.map(o => o.id === orderId
          ? { ...o, productData: product, status: 'ready' }
          : o
        ))
        addToast(`🏷️ Produto: ${product.name}`, 'success')
      } else {
        addToast('Produto não encontrado. Selecione manualmente.', 'warning')
      }
    }
  }, [camera, inventory, pessoas, addToast])

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
      const city = geo?.city || (labelData?.location || 'Desconhecido').split(',')[0].trim()

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

  // ── Finaliza todos os prontos ───────────────────────────────────────────────
  const finalizeAll = useCallback(async () => {
    const ready = orders.filter(o => o.status === 'ready')
    for (const o of ready) await finalizeOrder(o.id)
  }, [orders, finalizeOrder])

  const readyCount = orders.filter(o => o.status === 'ready').length
  const doneCount  = orders.filter(o => o.status === 'done').length

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        <button className="btn btn-primary" onClick={openLabelScan} style={{ gap: '0.4rem' }}>
          📷 Ler Etiqueta de Envio
        </button>

        {readyCount > 1 && (
          <button
            className="btn btn-sm"
            style={{ background: 'var(--success)', color: '#fff', border: 'none' }}
            onClick={finalizeAll}
          >
            ✅ Finalizar Todos ({readyCount})
          </button>
        )}

        {orders.length > 0 && (
          <button className="btn btn-secondary btn-sm" onClick={() => setOrders([])}>
            🗑️ Limpar fila
          </button>
        )}

        {orders.length > 0 && (
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
            {orders.length} etiqueta(s) · {readyCount} pronta(s) · {doneCount} finalizada(s)
          </span>
        )}
      </div>

      {/* Empty state */}
      {orders.length === 0 && (
        <div className="card" style={{
          textAlign: 'center', padding: '3rem 2rem', color: 'var(--text-muted)',
          border: '2px dashed var(--border)',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>📷</div>
          <p style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.4rem' }}>Nenhuma etiqueta na fila</p>
          <p style={{ fontSize: '0.82rem', marginBottom: '1.25rem', lineHeight: 1.6 }}>
            Clique em <b>"Ler Etiqueta de Envio"</b> para escanear o QR Code da etiqueta.<br/>
            Depois leia o QR do produto e finalize o pedido.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            <span>📦 Shopee</span><span>·</span>
            <span>📮 Correios</span><span>·</span>
            <span>🚚 Jadlog</span><span>·</span>
            <span>📋 Qualquer QR</span>
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
            onScanProduct={() => openProductScan(order.id)}
            onSetQty={qty => setOrders(prev => prev.map(o => o.id === order.id ? { ...o, quantity: qty } : o))}
            onSelectProduct={productId => selectProduct(order.id, productId)}
            onFinalize={() => finalizeOrder(order.id)}
            onRemove={() => setOrders(prev => prev.filter(o => o.id !== order.id))}
          />
        ))}
      </div>

      {/* Modal da câmera */}
      {camera && (
        <CameraModal
          title={camera.mode === 'label' ? '📷 Ler Etiqueta de Envio' : '🏷️ Ler QR Code do Produto'}
          subtitle={camera.mode === 'label'
            ? 'Aponte para o QR Code da etiqueta Shopee, Correios, Jadlog...'
            : 'Aponte para o QR Code do produto em estoque'}
          onDecoded={handleDecoded}
          onClose={() => setCamera(null)}
        />
      )}
    </div>
  )
}
