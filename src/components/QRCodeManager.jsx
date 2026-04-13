import React, { useState, useRef, useEffect, useCallback } from 'react'
import jsQR from 'jsqr'
import { supabase } from '../lib/supabase'
import { generateId, formatDate, normalizeText, formatCurrency } from '../utils/formatting'
import { geocode, packLocation } from '../utils/location'

// ─── Gera URL do QR Code via API pública ────────────────────────────────────
function qrUrl(product, size = 160) {
  const data = JSON.stringify({ id: product.id, name: product.name, price: product.price })
  return `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(data)}&size=${size}x${size}&bgcolor=ffffff&color=111827&margin=8`
}

// ─── Imprime etiqueta em nova janela ────────────────────────────────────────
function printLabel(product) {
  const url = qrUrl(product, 300)
  const win = window.open('', '_blank', 'width=420,height=520')
  win.document.write(`
    <html><head><title>Etiqueta — ${product.name}</title>
    <style>
      body { font-family: Arial, sans-serif; text-align: center; padding: 24px; margin: 0; }
      img  { display: block; margin: 0 auto 12px; }
      h2   { font-size: 18px; margin: 0 0 6px; }
      p    { font-size: 14px; color: #555; margin: 3px 0; }
      .price { font-size: 22px; font-weight: bold; color: #111; margin: 8px 0; }
      .badge { display: inline-block; padding: 3px 10px; border-radius: 99px;
               background: #f1f5f9; font-size: 12px; color: #475569; margin-top: 4px; }
      @media print { button { display: none; } }
    </style></head><body>
    <img src="${url}" width="220" height="220" />
    <h2>${product.name}</h2>
    <div class="price">R$ ${Number(product.price).toFixed(2).replace('.', ',')}</div>
    <p class="badge">${product.category}</p>
    <p style="margin-top:10px;font-size:12px;color:#999;">Estoque: ${product.quantity} un.</p>
    <br/><button onclick="window.print()" style="padding:8px 24px;font-size:14px;cursor:pointer;">🖨️ Imprimir</button>
    </body></html>`)
  win.document.close()
}

// ─── Componente principal ────────────────────────────────────────────────────
export function QRCodeManager({ inventory, setInventory, transactions, setTransactions, pessoas, setPessoas, addToast }) {
  const [search,       setSearch]       = useState('')
  const [scannerOpen,  setScannerOpen]  = useState(false)
  const [scannedItem,  setScannedItem]  = useState(null)  // produto lido pelo QR
  const [scanning,     setScanning]     = useState(false)
  const [scanMsg,      setScanMsg]      = useState('Aponte a câmera para o QR Code')

  // Formulário do pedido após scan
  const [form, setForm] = useState({ customer: '', quantity: 1, city: '', address: '', bairro: '', rastreio: '', modalidade: '', orderRef: '' })
  const [processing, setProcessing] = useState(false)

  const videoRef   = useRef(null)
  const canvasRef  = useRef(null)
  const streamRef  = useRef(null)
  const rafRef     = useRef(null)

  // ── Filtra produtos ──────────────────────────────────────────────────────
  const filtered = React.useMemo(() => {
    const tokens = normalizeText(search).split(/\s+/).filter(Boolean)
    return tokens.length
      ? inventory.filter(i => tokens.every(t => normalizeText(`${i.name} ${i.category}`).includes(t)))
      : inventory
  }, [inventory, search])

  // ── Abre câmera ──────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setScannerOpen(true)
    setScanning(true)
    setScanMsg('Iniciando câmera...')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setScanMsg('Aponte para o QR Code do produto')
        scanFrame()
      }
    } catch (e) {
      setScanMsg('❌ Câmera não disponível. Use a opção de upload abaixo.')
      setScanning(false)
    }
  }, [])

  // ── Loop de leitura de frames ─────────────────────────────────────────────
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
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const code = jsQR(imageData.data, imageData.width, imageData.height)
    if (code) {
      handleQRDecoded(code.data)
    } else {
      rafRef.current = requestAnimationFrame(scanFrame)
    }
  }, [])

  // ── Para câmera ───────────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [])

  useEffect(() => () => stopCamera(), [stopCamera])

  // ── Leitura via upload de imagem ──────────────────────────────────────────
  const handleFileUpload = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!file) return
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
        const code = jsQR(imageData.data, imageData.width, imageData.height)
        if (code) {
          handleQRDecoded(code.data)
        } else {
          addToast('QR Code não encontrado na imagem.', 'warning')
        }
      }
      img.src = ev.target.result
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }, [inventory])

  // ── Processa dados do QR ──────────────────────────────────────────────────
  const handleQRDecoded = useCallback((rawData) => {
    stopCamera()
    setScannerOpen(false)
    setScanning(false)
    try {
      const parsed = JSON.parse(rawData)
      const product = inventory.find(p => p.id === parsed.id || p.name === parsed.name)
      if (!product) {
        addToast('Produto não encontrado no estoque.', 'error')
        return
      }
      setScannedItem(product)
      setForm({ customer: '', quantity: 1, city: '', address: '', bairro: '', rastreio: '', modalidade: '', orderRef: '' })
      addToast(`✅ QR lido: ${product.name}`, 'success')
    } catch {
      addToast('QR Code inválido — não pertence a este sistema.', 'error')
    }
  }, [inventory, stopCamera])

  // ── Finaliza pedido ───────────────────────────────────────────────────────
  const handleOrder = useCallback(async (e) => {
    e.preventDefault()
    if (!scannedItem || !form.customer || form.quantity < 1 || !form.city) {
      addToast('Preencha todos os campos obrigatórios.', 'warning')
      return
    }
    if (Number(scannedItem.quantity) < Number(form.quantity)) {
      addToast('Estoque insuficiente!', 'error')
      return
    }
    setProcessing(true)
    try {
      let pessoa = pessoas.find(p => p.name.toLowerCase() === form.customer.toLowerCase())
      if (!pessoa) {
        pessoa = { id: generateId(), name: form.customer.trim(), document: '', role: 'cliente', contact: '' }
        if (setPessoas) setPessoas(prev => [...prev, pessoa])
        await supabase.from('pessoas').insert([pessoa])
      }

      const geo  = await geocode(form.city)
      const city = geo?.city || form.city.split(',')[0].trim()
      const packed = packLocation(scannedItem.name, {
        city, lat: geo?.lat, lng: geo?.lng,
        orderId: form.orderRef, cep: '',
        address: form.address, bairro: form.bairro,
        rastreio: form.rastreio, modalidade: form.modalidade,
      })
      const newQty = Number(scannedItem.quantity) - Number(form.quantity)
      const tx = {
        id: generateId(), type: 'saída',
        itemId: scannedItem.id, itemName: packed, city,
        quantity: Number(form.quantity), unitPrice: scannedItem.price,
        totalValue: scannedItem.price * Number(form.quantity),
        personName: pessoa.name, date: formatDate(),
      }

      const [{ error: e1 }, { error: e2 }] = await Promise.all([
        supabase.from('inventory').update({ quantity: newQty }).eq('id', scannedItem.id),
        supabase.from('transactions').insert([tx]),
      ])
      if (e1 || e2) throw new Error('Erro ao salvar no banco.')

      setInventory(prev => prev.map(i => i.id === scannedItem.id ? { ...i, quantity: newQty } : i))
      setTransactions(prev => [...prev, tx])
      addToast(`🔥 Pedido de ${form.quantity}x "${scannedItem.name}" registrado!`, 'success')
      setScannedItem(null)
    } catch (err) {
      addToast(`Erro: ${err.message}`, 'error')
    } finally {
      setProcessing(false)
    }
  }, [scannedItem, form, inventory, pessoas, setPessoas, setInventory, setTransactions, addToast])

  // ── Cor do badge de estoque ───────────────────────────────────────────────
  const stockBadge = (qty) => {
    if (qty <= 0)  return 'badge badge-red'
    if (qty < 5)   return 'badge badge-orange'
    return 'badge badge-green'
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>🏷️ QR Codes dos Produtos</h1>
        <p>Gere etiquetas, imprima e leia QR Codes para registrar pedidos instantaneamente</p>
      </div>

      {/* Barra de ações */}
      <div className="filters mb-3">
        <input className="search-input" type="text" placeholder="🔍 Buscar produto..." value={search} onChange={e => setSearch(e.target.value)} />

        {/* Escanear via câmera */}
        <button className="btn btn-primary" onClick={startCamera}>
          📷 Escanear QR Code
        </button>

        {/* Escanear via imagem */}
        <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
          📁 Carregar Imagem
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileUpload} />
        </label>

        <span className="text-muted text-small">{filtered.length} produto(s)</span>
      </div>

      {/* Scanner de câmera */}
      {scannerOpen && (
        <div className="card mb-3" style={{ position: 'relative', maxWidth: 480 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>📷 Scanner de QR Code</h3>
            <button className="btn btn-secondary btn-sm" onClick={() => { stopCamera(); setScannerOpen(false) }}>✕ Fechar</button>
          </div>
          <div style={{ position: 'relative', borderRadius: 'var(--radius)', overflow: 'hidden', background: '#000', aspectRatio: '4/3' }}>
            <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
            {/* Mira */}
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 180, height: 180,
              border: '3px solid #22c55e',
              borderRadius: 12, boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
            }} />
          </div>
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          <p style={{ marginTop: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center' }}>{scanMsg}</p>
        </div>
      )}

      {/* Modal de pedido após scan */}
      {scannedItem && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: '1rem',
        }}>
          <div className="card" style={{ maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto', margin: 0 }}>

            {/* Banner de sucesso */}
            <div style={{
              background: 'linear-gradient(135deg, #16a34a, #15803d)',
              borderRadius: 'var(--radius)', padding: '1rem 1.25rem',
              display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem',
            }}>
              <span style={{ fontSize: '1.5rem' }}>✅</span>
              <div>
                <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.95rem' }}>QR Code lido com sucesso!</div>
                <div style={{ color: '#bbf7d0', fontSize: '0.82rem' }}>{scannedItem.name}</div>
              </div>
              <button onClick={() => setScannedItem(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#bbf7d0', fontSize: '1.4rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            {/* Info do produto */}
            <div className="stat-grid mb-3" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
              <div className="stat-card" style={{ padding: '0.6rem' }}>
                <span className="stat-label">Produto</span>
                <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>{scannedItem.name}</span>
              </div>
              <div className="stat-card" style={{ padding: '0.6rem' }}>
                <span className="stat-label">Preço Unit.</span>
                <span className="stat-value color-blue" style={{ fontSize: '1rem' }}>{formatCurrency(scannedItem.price)}</span>
              </div>
              <div className="stat-card" style={{ padding: '0.6rem' }}>
                <span className="stat-label">Estoque</span>
                <span className={stockBadge(scannedItem.quantity)} style={{ marginTop: '0.2rem' }}>{scannedItem.quantity} un.</span>
              </div>
            </div>

            {/* Formulário de pedido */}
            <form onSubmit={handleOrder} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div className="form-group">
                <label>Cliente *</label>
                <input type="text" list="qr-pessoas-list" placeholder="Nome do cliente..." value={form.customer} onChange={e => setForm(p => ({ ...p, customer: e.target.value }))} required />
                <datalist id="qr-pessoas-list">{pessoas.map(p => <option key={p.id} value={p.name} />)}</datalist>
              </div>

              <div className="form-row">
                <div className="form-group" style={{ maxWidth: 110 }}>
                  <label>Quantidade *</label>
                  <input type="number" min="1" max={scannedItem.quantity} value={form.quantity} onChange={e => setForm(p => ({ ...p, quantity: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Referência / Pedido</label>
                  <input type="text" placeholder="#12345 ou NF: 999" value={form.orderRef} onChange={e => setForm(p => ({ ...p, orderRef: e.target.value }))} />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Destino (Cidade ou CEP) *</label>
                  <input type="text" placeholder="Ex: São Paulo" value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Endereço</label>
                  <input type="text" placeholder="Rua, Número" value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Bairro</label>
                  <input type="text" value={form.bairro} onChange={e => setForm(p => ({ ...p, bairro: e.target.value }))} placeholder="Ex: Centro" />
                </div>
                <div className="form-group">
                  <label>Rastreio</label>
                  <input type="text" value={form.rastreio} onChange={e => setForm(p => ({ ...p, rastreio: e.target.value }))} placeholder="BR0000000000000" />
                </div>
                <div className="form-group">
                  <label>Modalidade</label>
                  <select value={form.modalidade} onChange={e => setForm(p => ({ ...p, modalidade: e.target.value }))}>
                    <option value="">Selecione...</option>
                    {['COLETA','PAC','SEDEX','SEDEX 10','JADLOG','CORREIOS','TRANSPORTADORA','RETIRADA'].map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Total */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '0.75rem 1rem', background: 'var(--surface-2)',
                borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
              }}>
                <span style={{ fontWeight: 600 }}>Total do Pedido:</span>
                <span style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--success)' }}>
                  {formatCurrency(scannedItem.price * Number(form.quantity || 0))}
                </span>
              </div>

              <div className="form-row" style={{ gap: '0.75rem' }}>
                <button type="button" className="btn btn-secondary btn-lg" style={{ flex: 1 }} onClick={() => setScannedItem(null)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary btn-lg" style={{ flex: 2 }} disabled={processing}>
                  {processing ? '⏳ Processando...' : '🔥 Finalizar Pedido'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Grid de produtos */}
      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <p className="text-muted">Nenhum produto encontrado.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem' }}>
          {filtered.map(product => (
            <div key={product.id} className="card" style={{ padding: '1rem', overflow: 'hidden' }}>
              {/* Barra colorida */}
              <div style={{ height: 4, background: product.color || '#2563eb', borderRadius: 2, marginBottom: '0.75rem' }} />

              {/* Nome + dot */}
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: product.color || '#2563eb', flexShrink: 0, marginTop: 3 }} />
                <span style={{ fontWeight: 700, fontSize: '0.88rem', lineHeight: 1.3 }}>{product.name}</span>
              </div>

              {/* Badges */}
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', fontSize: '0.72rem' }}>{product.category}</span>
                <span className={stockBadge(product.quantity)} style={{ fontSize: '0.72rem' }}>
                  {product.quantity <= 0 ? 'Sem estoque' : `${product.quantity} un.`}
                </span>
              </div>

              {/* QR Code */}
              <div style={{ display: 'flex', justifyContent: 'center', background: '#f8fafc', borderRadius: 8, padding: '0.5rem', marginBottom: '0.75rem' }}>
                <img
                  src={qrUrl(product)}
                  alt={`QR — ${product.name}`}
                  style={{ width: 130, height: 130 }}
                />
              </div>

              {/* Preço */}
              <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.75rem' }}>
                {formatCurrency(product.price)}
              </div>

              {/* Botões */}
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ flex: 1, fontSize: '0.76rem' }}
                  onClick={() => printLabel(product)}
                >
                  🖨️ Imprimir
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  style={{ flex: 1, fontSize: '0.76rem' }}
                  disabled={product.quantity <= 0}
                  onClick={() => {
                    setScannedItem(product)
                    setForm({ customer: '', quantity: 1, city: '', address: '', bairro: '', rastreio: '', modalidade: '', orderRef: '' })
                  }}
                >
                  🛒 Registrar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
