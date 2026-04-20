/**
 * AnaBatchFlow.jsx
 * Modo Lote Contínuo da ANA — fluxo operacional completo.
 *
 * MÁQUINA DE ESTADOS:
 *  aguardando_etiqueta → lendo_etiqueta → cliente_validado
 *  → adicionando_produtos → finalizando → pronto_para_proxima
 *  → (volta para aguardando_etiqueta automaticamente)
 */
import React, { useState, useRef, useCallback, useEffect } from 'react'
import { analyzeText, analyzeDocument } from '../lib/gemini'
import { supabase } from '../lib/supabase'
import { generateId, formatDate, normalizeText, formatCurrency } from '../utils/formatting'
import { geocode, packLocation } from '../utils/location'
import Tesseract from 'tesseract.js'

// ─── Máquina de estados ───────────────────────────────────────────────────────
const S = {
  WAITING:    'aguardando_etiqueta',
  SCANNING:   'lendo_etiqueta',
  PROCESSING: 'processando_etiqueta',
  VALIDATED:  'cliente_validado',
  ADDING:     'adicionando_produtos',
  FINALIZING: 'finalizando',
  SUCCESS:    'pronto_para_proxima',
}

// ─── Helpers visuais ──────────────────────────────────────────────────────────
const STEP_CFG = [
  { key: S.WAITING,   icon: '📷', label: 'Etiqueta' },
  { key: S.VALIDATED, icon: '👤', label: 'Cliente'  },
  { key: S.ADDING,    icon: '📦', label: 'Produtos' },
  { key: S.SUCCESS,   icon: '✅', label: 'Concluído'},
]

const STEP_ORDER = [S.WAITING, S.SCANNING, S.PROCESSING, S.VALIDATED, S.ADDING, S.FINALIZING, S.SUCCESS]

function stepIndex(state) {
  const idx = STEP_ORDER.indexOf(state)
  if (idx <= 2) return 0   // etiqueta
  if (idx === 3) return 1  // cliente
  if (idx <= 5) return 2   // produtos
  return 3                 // concluído
}

function vibrate(pattern = [40]) {
  try { navigator.vibrate?.(pattern) } catch {}
}

// ─── Stepper visual ───────────────────────────────────────────────────────────
function Stepper({ state }) {
  const current = stepIndex(state)
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, marginBottom: '1.2rem' }}>
      {STEP_CFG.map((s, i) => {
        const done    = i < current
        const active  = i === current
        const pending = i > current
        return (
          <React.Fragment key={s.key}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                fontSize: done ? '1rem' : '0.95rem',
                background: done ? '#16a34a' : active ? '#2563eb' : '#e2e8f0',
                color: done || active ? '#fff' : '#94a3b8',
                border: active ? '2px solid #1d4ed8' : '2px solid transparent',
                boxShadow: active ? '0 0 0 3px rgba(37,99,235,0.2)' : 'none',
                transition: 'all 0.3s', fontWeight: 700, fontSize: '0.8rem',
              }}>
                {done ? '✓' : s.icon}
              </div>
              <span style={{ fontSize: '0.67rem', fontWeight: active ? 700 : 500, color: active ? '#2563eb' : done ? '#16a34a' : '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                {s.label}
              </span>
            </div>
            {i < STEP_CFG.length - 1 && (
              <div style={{ flex: 1, height: 2, background: i < current ? '#16a34a' : '#e2e8f0', marginBottom: 18, minWidth: 20, transition: 'background 0.3s' }} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ─── Câmera com autocaptura ───────────────────────────────────────────────────
function AutoCamera({ title, subtitle, autoCapture = true, onCapture, onClose }) {
  const [msg,       setMsg]       = useState('Iniciando câmera...')
  const [active,    setActive]    = useState(false)
  const [countdown, setCountdown] = useState(null)
  const videoRef   = useRef(null)
  const streamRef  = useRef(null)
  const timerRef   = useRef(null)

  useEffect(() => {
    startCam()
    return () => { stopCam(); clearTimeout(timerRef.current) }
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

      if (autoCapture) {
        setMsg('📷 Posicione a etiqueta — captura automática em 3s')
        setCountdown(3)
        let c = 3
        const tick = () => {
          c--
          if (c > 0) {
            setCountdown(c)
            setMsg(`📷 Capturando em ${c}s...`)
            timerRef.current = setTimeout(tick, 1000)
          } else {
            setCountdown(0)
            setMsg('⚡ Capturando...')
            setTimeout(doCapture, 100)
          }
        }
        timerRef.current = setTimeout(tick, 1000)
      } else {
        setMsg('📷 Posicione o produto no quadro')
      }
    } catch {
      setMsg('❌ Câmera não disponível — use "Galeria" para enviar foto')
    }
  }

  function stopCam() {
    clearTimeout(timerRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
  }

  const doCapture = useCallback(() => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width  = v.videoWidth
    canvas.height = v.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(v, 0, 0)
    // Pré-processamento: grayscale + contraste para melhorar OCR
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const pix = imgData.data
    const contrast = 60
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast))
    for (let i = 0; i < pix.length; i += 4) {
      let g = 0.2126 * pix[i] + 0.7152 * pix[i+1] + 0.0722 * pix[i+2]
      g = factor * (g - 128) + 128
      pix[i] = pix[i+1] = pix[i+2] = Math.max(0, Math.min(255, g))
    }
    ctx.putImageData(imgData, 0, 0)
    stopCam()
    onCapture(canvas.toDataURL('image/jpeg', 0.85))
  }, [onCapture])

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => { stopCam(); onCapture(ev.target.result) }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 4000, padding: '1rem' }}>
      <div style={{ background: '#fff', borderRadius: 20, padding: '1.25rem', maxWidth: 460, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>{title}</h3>
            {subtitle && <p style={{ margin: 0, fontSize: '0.74rem', color: '#64748b' }}>{subtitle}</p>}
          </div>
          <button onClick={() => { stopCam(); onClose() }} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: '#64748b', fontSize: '0.85rem', fontWeight: 700 }}>✕</button>
        </div>

        {/* Vídeo */}
        <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#0f172a', height: 300 }}>
          <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
          {active && (
            <div style={{
              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
              width: '88%', height: '65%',
              border: `2px solid ${countdown === 0 ? '#16a34a' : '#3b82f6'}`,
              borderRadius: 10, boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
              pointerEvents: 'none', transition: 'border-color 0.3s',
            }} />
          )}
          {countdown !== null && countdown > 0 && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: '3.5rem', fontWeight: 900, color: '#fff', textShadow: '0 2px 12px rgba(0,0,0,0.8)', pointerEvents: 'none' }}>
              {countdown}
            </div>
          )}
        </div>

        <p style={{ textAlign: 'center', fontSize: '0.79rem', color: '#64748b', margin: '0.6rem 0 0.75rem' }}>{msg}</p>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={doCapture}
            style={{ flex: 2, padding: '0.6rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', boxShadow: '0 2px 8px rgba(37,99,235,0.4)' }}
          >
            📸 Capturar Agora
          </button>
          <label style={{ flex: 1, padding: '0.6rem', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', textAlign: 'center' }}>
            📁 Galeria
            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
          </label>
        </div>
      </div>
    </div>
  )
}

// ─── Card do cliente lido ─────────────────────────────────────────────────────
function CustomerCard({ customer, onClear }) {
  return (
    <div style={{ background: 'linear-gradient(135deg,#eff6ff,#dbeafe)', border: '1.5px solid #bfdbfe', borderRadius: 14, padding: '1rem 1.2rem', marginBottom: '1rem', position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: '1.1rem', flexShrink: 0 }}>
            {(customer.name || '?')[0].toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: '0.95rem', color: '#0f172a' }}>{customer.name || '—'}</div>
            <div style={{ fontSize: '0.72rem', color: '#3b82f6', fontWeight: 600 }}>{customer.isNew ? '🆕 Novo cliente' : '✅ Cliente existente'}</div>
          </div>
        </div>
        <button onClick={onClear} title="Cancelar cliente" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '1.1rem', padding: 0 }}>✕</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem 1rem', marginTop: '0.75rem', fontSize: '0.78rem', color: '#334155' }}>
        {customer.cep      && <span>📮 {customer.cep}</span>}
        {customer.city     && <span>📍 {customer.city}{customer.state ? ` / ${customer.state}` : ''}</span>}
        {customer.address  && <span style={{ gridColumn: 'span 2' }}>🏠 {customer.address}</span>}
        {customer.rastreio && <span style={{ gridColumn: 'span 2', fontFamily: 'monospace', fontSize: '0.72rem', color: '#2563eb' }}>📦 {customer.rastreio}</span>}
        {customer.orderId  && <span>🔖 Pedido: {customer.orderId}</span>}
      </div>
    </div>
  )
}

// ─── Item do carrinho ─────────────────────────────────────────────────────────
function CartItem({ item, onQtyChange, onRemove }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.6rem 0.8rem', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#2563eb', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{item.stock} em estoque · {formatCurrency(item.price)} un.</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <input
          type="number" min={1} max={item.stock}
          value={item.quantity}
          onChange={e => onQtyChange(Math.max(1, Math.min(item.stock, Number(e.target.value) || 1)))}
          style={{ width: 52, padding: '3px 6px', fontSize: '0.82rem', textAlign: 'center', border: '1.5px solid #e2e8f0', borderRadius: 7 }}
        />
        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#16a34a', minWidth: 60, textAlign: 'right' }}>
          {formatCurrency(item.price * item.quantity)}
        </span>
        <button onClick={onRemove} style={{ background: '#fee2e2', border: 'none', borderRadius: 6, padding: '4px 7px', cursor: 'pointer', color: '#dc2626', fontSize: '0.8rem' }}>✕</button>
      </div>
    </div>
  )
}

// ─── Adição manual de produto ─────────────────────────────────────────────────
function ManualProductAdder({ inventory, cart, onAdd }) {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [qty, setQty] = useState(1)
  const [open, setOpen] = useState(false)

  const filtered = React.useMemo(() => {
    const q = normalizeText(search)
    return inventory.filter(i => i.quantity > 0 && normalizeText(i.name).includes(q))
  }, [inventory, search])

  const selected = inventory.find(i => i.id === selectedId)
  const cartIds  = new Set(cart.map(c => c.productId))
  const inCart   = selectedId && cartIds.has(selectedId)

  function handleAdd() {
    if (!selected || qty < 1) return
    const effectiveQty = inCart
      ? Math.min(qty, selected.quantity - (cart.find(c => c.productId === selectedId)?.quantity || 0))
      : Math.min(qty, selected.quantity)
    if (effectiveQty < 1) { return }
    onAdd(selected, effectiveQty)
    setSelectedId(''); setSearch(''); setQty(1); setOpen(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{ width: '100%', padding: '0.65rem', background: '#f1f5f9', border: '1.5px dashed #cbd5e1', borderRadius: 12, cursor: 'pointer', color: '#64748b', fontWeight: 700, fontSize: '0.82rem' }}
      >
        ✏️ Adicionar Manualmente
      </button>
    )
  }

  return (
    <div style={{ background: '#f8fafc', borderRadius: 12, padding: '0.9rem', border: '1.5px solid #e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.4px' }}>+ Produto Manual</span>
        <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '1rem' }}>✕</button>
      </div>
      <input
        type="text" placeholder="🔍 Buscar produto..."
        value={search} onChange={e => { setSearch(e.target.value); setSelectedId('') }}
        style={{ width: '100%', marginBottom: '0.5rem', padding: '0.4rem 0.7rem', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: '0.8rem', boxSizing: 'border-box' }}
      />
      <select
        value={selectedId} onChange={e => setSelectedId(e.target.value)}
        style={{ width: '100%', marginBottom: '0.5rem', padding: '0.4rem 0.6rem', border: `1.5px solid ${selectedId ? '#2563eb' : '#e2e8f0'}`, borderRadius: 8, fontSize: '0.8rem', background: selectedId ? '#eff6ff' : '#fff' }}
      >
        <option value="">Selecione o produto...</option>
        {filtered.map(i => (
          <option key={i.id} value={i.id} disabled={cartIds.has(i.id) && i.quantity <= (cart.find(c=>c.productId===i.id)?.quantity||0)}>
            {i.name} — {i.quantity} un. ({cartIds.has(i.id) ? `${cart.find(c=>c.productId===i.id)?.quantity||0} no carrinho` : 'disponível'})
          </option>
        ))}
      </select>
      {selected && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <div style={{ fontSize: '0.76rem', color: '#64748b', flex: 1 }}>
            Estoque: {selected.quantity} · {formatCurrency(selected.price)}/un.
            {inCart && ` · ${cart.find(c=>c.productId===selectedId)?.quantity} já no carrinho`}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={{ fontSize: '0.74rem', color: '#64748b' }}>Qtd:</label>
            <input
              type="number" min={1} max={selected.quantity} value={qty}
              onChange={e => setQty(Math.max(1, Math.min(selected.quantity, Number(e.target.value) || 1)))}
              style={{ width: 52, padding: '3px 6px', fontSize: '0.82rem', textAlign: 'center', border: '1.5px solid #e2e8f0', borderRadius: 7 }}
            />
            <button
              onClick={handleAdd}
              style={{ padding: '5px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}
            >
              ＋
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Painel de erros de validação ─────────────────────────────────────────────
function ValidationErrors({ errors }) {
  if (!errors.length) return null
  return (
    <div style={{ background: '#fef2f2', border: '1.5px solid #fecaca', borderRadius: 12, padding: '0.85rem 1rem', marginBottom: '0.75rem' }}>
      <div style={{ fontWeight: 800, color: '#dc2626', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '0.4rem' }}>
        ⚠️ Verifique antes de finalizar
      </div>
      {errors.map((e, i) => <div key={i} style={{ fontSize: '0.8rem', color: '#b91c1c', marginBottom: '0.2rem' }}>• {e}</div>)}
    </div>
  )
}

// ─── Tela de sucesso ──────────────────────────────────────────────────────────
function SuccessScreen({ customerName, itemCount, completedCount, countdown }) {
  return (
    <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
      <div style={{ fontSize: '4rem', marginBottom: '0.5rem', animation: 'none' }}>✅</div>
      <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0f172a', margin: '0 0 0.3rem' }}>Pedido finalizado!</h2>
      <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '1rem' }}>
        <b>{customerName}</b> · {itemCount} produto{itemCount > 1 ? 's' : ''}<br />
        Total desta sessão: <b>{completedCount}</b> pedido{completedCount > 1 ? 's' : ''}
      </p>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: 10,
        padding: '0.6rem 1.2rem', fontSize: '0.85rem', fontWeight: 700, color: '#16a34a',
      }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', animation: 'pulse 1s infinite' }} />
        Próxima etiqueta em {countdown}s...
      </div>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────
export function AnaBatchFlow({ inventory, setInventory, transactions, setTransactions, pessoas, setPessoas, addToast, onClose }) {
  const [flowState,    setFlowState]    = useState(S.WAITING)
  const [customer,     setCustomer]     = useState(null)   // dados da etiqueta
  const [cart,         setCart]         = useState([])     // [{cartId, productId, name, quantity, price, stock}]
  const [errors,       setErrors]       = useState([])
  const [showCamera,   setShowCamera]   = useState(false)  // câmera da etiqueta
  const [showQRScan,   setShowQRScan]   = useState(false)  // câmera do produto
  const [processing,   setProcessing]   = useState(false)
  const [completedCnt, setCompletedCnt] = useState(0)
  const [successCd,    setSuccessCd]    = useState(3)
  const successTimer = useRef(null)
  const resetTimer   = useRef(null)

  // ── Limpeza ao desmontar ───────────────────────────────────────────────────
  useEffect(() => () => {
    clearTimeout(successTimer.current)
    clearTimeout(resetTimer.current)
  }, [])

  // ── Resetar para o próximo cliente ────────────────────────────────────────
  const resetForNext = useCallback(() => {
    setCustomer(null)
    setCart([])
    setErrors([])
    setProcessing(false)
    setFlowState(S.WAITING)
    setSuccessCd(3)
    // Auto-abrir câmera após breve pausa
    resetTimer.current = setTimeout(() => setShowCamera(true), 400)
  }, [])

  // ── Countdown após sucesso ─────────────────────────────────────────────────
  useEffect(() => {
    if (flowState !== S.SUCCESS) return
    let c = 3
    setSuccessCd(c)
    const tick = () => {
      c--
      if (c > 0) { setSuccessCd(c); successTimer.current = setTimeout(tick, 1000) }
      else resetForNext()
    }
    successTimer.current = setTimeout(tick, 1000)
    return () => clearTimeout(successTimer.current)
  }, [flowState, resetForNext])

  // ── Processar imagem da etiqueta ────────────────────────────────────────────
  const handleLabelCapture = useCallback(async (imageData) => {
    setShowCamera(false)
    setFlowState(S.PROCESSING)
    setErrors([])

    try {
      addToast('🔍 Analisando etiqueta...', 'info')

      // 1) OCR local — rápido e offline
      const { data: { text } } = await Tesseract.recognize(imageData, 'por')
      let data = await analyzeText(text, inventory, pessoas)

      // 2) Fallback Vision AI se OCR não extraiu dados suficientes
      if (!data?.customerName && !data?.location) {
        addToast('Refinando com IA visual...', 'info')
        const b64 = imageData.includes(',') ? imageData.split(',')[1] : imageData
        data = await analyzeDocument(`data:image/jpeg;base64,${b64}`, inventory, pessoas)
      }

      if (!data?.customerName && !data?.location && !data?.cep) {
        throw new Error('Não foi possível identificar dados na etiqueta. Tente novamente.')
      }

      // 3) Resolver cliente
      const name = data.customerName?.trim() || 'Desconhecido'
      const existing = pessoas.find(p => normalizeText(p.name) === normalizeText(name))

      const newCustomer = {
        name,
        address:    data.address  || '',
        city:       data.location ? data.location.split('-')[0].split(',')[0].trim() : '',
        state:      data.state    || '',
        cep:        data.cep      || '',
        bairro:     data.bairro   || '',
        rastreio:   data.rastreio || '',
        orderId:    data.orderId  || '',
        modalidade: data.modalidade || '',
        isNew:      !existing,
        pessoaId:   existing?.id || null,
        rawData:    data,
      }

      vibrate([40, 30, 40])
      setCustomer(newCustomer)
      setFlowState(S.VALIDATED)
      addToast(`✅ Cliente: ${name}${newCustomer.isNew ? ' (novo)' : ''}`, 'success')
    } catch (err) {
      setFlowState(S.WAITING)
      addToast(`Falha na leitura: ${err.message}`, 'error')
    }
  }, [inventory, pessoas, addToast])

  // ── Processar foto de QR/produto ────────────────────────────────────────────
  const handleProductCapture = useCallback(async (imageData) => {
    setShowQRScan(false)
    try {
      const { data: { text } } = await Tesseract.recognize(imageData, 'por')
      const lower = normalizeText(text)

      // Busca produto cujo nome aparece no texto extraído
      const product = inventory.find(p =>
        lower.includes(normalizeText(p.name)) ||
        normalizeText(p.name).split(' ').filter(w => w.length > 3).some(w => lower.includes(w))
      )

      if (product) {
        addProductToCart(product, 1)
        vibrate([30])
        addToast(`🏷️ Produto lido: ${product.name}`, 'success')
      } else {
        addToast('Produto não identificado na foto. Use "Adicionar Manualmente".', 'warning')
      }
    } catch {
      addToast('Erro ao processar a foto do produto.', 'error')
    }
  }, [inventory])

  // ── Adicionar produto ao carrinho ───────────────────────────────────────────
  const addProductToCart = useCallback((product, qty) => {
    setCart(prev => {
      const existing = prev.find(c => c.productId === product.id)
      if (existing) {
        // Mesmo produto: soma quantidade (respeitando estoque)
        const totalQty = Math.min(existing.quantity + qty, product.quantity)
        addToast(`📦 ${product.name}: ${totalQty} un. no carrinho`, 'info')
        return prev.map(c => c.productId === product.id ? { ...c, quantity: totalQty } : c)
      }
      // Produto novo no carrinho
      return [...prev, {
        cartId:    generateId(),
        productId: product.id,
        name:      product.name,
        quantity:  Math.min(qty, product.quantity),
        price:     product.price,
        stock:     product.quantity,
      }]
    })
    setFlowState(S.ADDING)
    setErrors([])
  }, [addToast])

  // ── Validar pedido ─────────────────────────────────────────────────────────
  const validate = useCallback(() => {
    const errs = []
    if (!customer)       errs.push('Nenhum cliente identificado.')
    if (cart.length < 1) errs.push('Adicione ao menos 1 produto ao pedido.')
    cart.forEach(item => {
      if (item.quantity < 1) errs.push(`Quantidade inválida: ${item.name}`)
      const inv = inventory.find(i => i.id === item.productId)
      if (!inv) errs.push(`Produto não encontrado no estoque: ${item.name}`)
      else if (Number(inv.quantity) < item.quantity)
        errs.push(`Estoque insuficiente: ${item.name} (${inv.quantity} disponível, ${item.quantity} solicitado)`)
    })
    setErrors(errs)
    return errs.length === 0
  }, [customer, cart, inventory])

  // ── Finalizar pedido ────────────────────────────────────────────────────────
  const finalizeOrder = useCallback(async () => {
    if (!validate()) return
    setProcessing(true)
    setFlowState(S.FINALIZING)

    try {
      // 1) Garantir cliente existe no banco
      let pessoa = customer.pessoaId
        ? pessoas.find(p => p.id === customer.pessoaId)
        : pessoas.find(p => normalizeText(p.name) === normalizeText(customer.name))

      if (!pessoa && customer.name !== 'Desconhecido') {
        pessoa = { id: generateId(), name: customer.name, document: '', role: 'cliente', contact: '' }
        if (setPessoas) setPessoas(prev => [...prev, pessoa])
        await supabase.from('pessoas').insert([pessoa])
        addToast(`👤 "${pessoa.name}" cadastrado!`, 'success')
      }

      // 2) Geocode (uma vez por pedido)
      const geoQuery = customer.cep || customer.city || ''
      const geo  = geoQuery ? await geocode(geoQuery) : null
      const city = geo?.city || customer.city || 'Desconhecido'

      // 3) Processar cada item do carrinho
      const txs      = []
      const invDiffs = []   // {id, newQty}

      for (const item of cart) {
        const inv = inventory.find(i => i.id === item.productId)
        if (!inv) throw new Error(`Produto não encontrado: ${item.name}`)
        if (Number(inv.quantity) < item.quantity) throw new Error(`Estoque insuficiente: ${item.name}`)

        const newQty = Number(inv.quantity) - item.quantity
        const packed = packLocation(item.name, {
          city, lat: geo?.lat, lng: geo?.lng,
          orderId:    customer.orderId    || '',
          cep:        customer.cep        || '',
          address:    customer.address    || '',
          bairro:     customer.bairro     || '',
          rastreio:   customer.rastreio   || '',
          modalidade: customer.modalidade || '',
        })

        txs.push({
          id: generateId(), type: 'saída',
          itemId: item.productId, itemName: packed, city,
          quantity:   item.quantity,
          unitPrice:  item.price,
          totalValue: item.price * item.quantity,
          personName: pessoa?.name || customer.name,
          date:       formatDate(),
          status:     'pendente',
        })
        invDiffs.push({ id: item.productId, newQty })
      }

      // 4) Gravar tudo no banco em paralelo
      const invUpdates = invDiffs.map(d => supabase.from('inventory').update({ quantity: d.newQty }).eq('id', d.id))
      const txInsert   = supabase.from('transactions').insert(txs)

      const results = await Promise.all([...invUpdates, txInsert])
      const errResult = results.find(r => r.error)
      if (errResult) throw new Error(errResult.error.message)

      // 5) Atualizar estado local
      setInventory(prev => prev.map(i => {
        const diff = invDiffs.find(d => d.id === i.id)
        return diff ? { ...i, quantity: diff.newQty } : i
      }))
      setTransactions(prev => [...prev, ...txs])

      // 6) Log de auditoria
      const logEntry = {
        timestamp: new Date().toISOString(),
        customer:  customer.name,
        items:     cart.map(c => `${c.name} x${c.quantity}`).join(', '),
        city,
        total:     cart.reduce((s, c) => s + c.price * c.quantity, 0),
      }
      console.info('[ANA BATCH] Pedido finalizado:', logEntry)

      vibrate([50, 30, 50, 30, 100])
      setCompletedCnt(n => n + 1)
      setFlowState(S.SUCCESS)
      addToast(`🔥 Pedido de ${customer.name} finalizado! (${cart.length} iten${cart.length > 1 ? 's' : ''})`, 'success')
    } catch (err) {
      setFlowState(S.ADDING)
      setProcessing(false)
      addToast(`Erro ao finalizar: ${err.message}`, 'error')
    }
  }, [customer, cart, inventory, pessoas, setPessoas, setInventory, setTransactions, addToast, validate])

  // ── Cancelar cliente atual ─────────────────────────────────────────────────
  const cancelCurrent = useCallback(() => {
    if (cart.length > 0 && !window.confirm('Tem um pedido em aberto. Cancelar mesmo assim?')) return
    setCustomer(null)
    setCart([])
    setErrors([])
    setFlowState(S.WAITING)
    clearTimeout(successTimer.current)
  }, [cart])

  // ── Total do carrinho ──────────────────────────────────────────────────────
  const cartTotal = cart.reduce((s, c) => s + c.price * c.quantity, 0)
  const canFinalize = customer && cart.length > 0 && !processing

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#f8fafc', zIndex: 2000, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>

      {/* ── Barra superior ── */}
      <div style={{
        background: '#fff', borderBottom: '1px solid #e2e8f0',
        padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 10,
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg,#7c3aed,#2563eb)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: '0.85rem' }}>
            ANA
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0f172a' }}>Modo Lote Contínuo</div>
            <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
              {completedCnt > 0 ? `${completedCnt} pedido${completedCnt > 1 ? 's' : ''} hoje` : 'Pronto para operar'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {completedCnt > 0 && (
            <span style={{ background: '#dcfce7', color: '#16a34a', borderRadius: 99, padding: '2px 9px', fontSize: '0.73rem', fontWeight: 700 }}>
              ✅ {completedCnt}
            </span>
          )}
          <button
            onClick={onClose}
            style={{ background: '#f1f5f9', border: 'none', borderRadius: 9, padding: '6px 12px', cursor: 'pointer', color: '#64748b', fontWeight: 700, fontSize: '0.8rem' }}
          >
            ✕ Sair
          </button>
        </div>
      </div>

      {/* ── Conteúdo principal ── */}
      <div style={{ flex: 1, padding: '1.25rem 1rem', maxWidth: 560, margin: '0 auto', width: '100%' }}>

        {/* Stepper */}
        <Stepper state={flowState} />

        {/* ── ESTADO: aguardando etiqueta ── */}
        {flowState === S.WAITING && (
          <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
            <div style={{ fontSize: '4rem', marginBottom: '0.75rem' }}>📷</div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.4rem' }}>Aguardando etiqueta</h2>
            <p style={{ color: '#64748b', fontSize: '0.83rem', lineHeight: 1.6, marginBottom: '1.5rem', maxWidth: 320, margin: '0 auto 1.5rem' }}>
              Posicione a câmera na etiqueta do cliente. O sistema lê automaticamente e avança para o próximo passo.
            </p>
            <button
              onClick={() => setShowCamera(true)}
              style={{ padding: '0.85rem 2rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 14, fontWeight: 800, fontSize: '1rem', cursor: 'pointer', boxShadow: '0 4px 16px rgba(37,99,235,0.4)' }}
            >
              📷 Ler Etiqueta
            </button>
          </div>
        )}

        {/* ── ESTADO: processando etiqueta ── */}
        {(flowState === S.PROCESSING || flowState === S.SCANNING) && (
          <div style={{ textAlign: 'center', padding: '2rem 0' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🔍</div>
            <div style={{ fontWeight: 700, color: '#374151', marginBottom: '0.5rem' }}>Analisando etiqueta...</div>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>OCR + IA identificando cliente e endereço</div>
          </div>
        )}

        {/* ── ESTADOS: cliente_validado / adicionando_produtos / finalizando ── */}
        {[S.VALIDATED, S.ADDING, S.FINALIZING].includes(flowState) && customer && (
          <>
            {/* Card do cliente */}
            <CustomerCard customer={customer} onClear={cancelCurrent} />

            {/* Erros de validação */}
            <ValidationErrors errors={errors} />

            {/* Carrinho */}
            <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: '0.85rem' }}>
              <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  Produtos do Pedido
                </span>
                <span style={{ fontSize: '0.72rem', color: cart.length > 0 ? '#2563eb' : '#94a3b8', fontWeight: 700 }}>
                  {cart.length > 0 ? `${cart.length} item${cart.length > 1 ? 's' : ''}` : 'Vazio'}
                </span>
              </div>

              <div style={{ padding: '0.6rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                {cart.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '1.5rem', color: '#94a3b8', fontSize: '0.83rem' }}>
                    📦 Nenhum produto adicionado ainda
                  </div>
                ) : (
                  cart.map(item => (
                    <CartItem
                      key={item.cartId}
                      item={item}
                      onQtyChange={qty => setCart(prev => prev.map(c => c.cartId === item.cartId ? { ...c, quantity: qty } : c))}
                      onRemove={() => setCart(prev => prev.filter(c => c.cartId !== item.cartId))}
                    />
                  ))
                )}
              </div>

              {cart.length > 0 && (
                <div style={{ padding: '0.65rem 1rem', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', background: '#f8fafc' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#374151' }}>Total do Pedido</span>
                  <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#16a34a' }}>{formatCurrency(cartTotal)}</span>
                </div>
              )}
            </div>

            {/* Adicionar produtos */}
            {flowState !== S.FINALIZING && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                <button
                  onClick={() => setShowQRScan(true)}
                  style={{
                    width: '100%', padding: '0.7rem', background: 'linear-gradient(135deg,#eff6ff,#dbeafe)',
                    border: '1.5px solid #bfdbfe', borderRadius: 12,
                    fontWeight: 800, fontSize: '0.85rem', cursor: 'pointer', color: '#2563eb',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  🏷️ Ler QR / Foto do Produto
                </button>
                <ManualProductAdder inventory={inventory} cart={cart} onAdd={addProductToCart} />
              </div>
            )}

            {/* Ações finais */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button
                onClick={finalizeOrder}
                disabled={!canFinalize || flowState === S.FINALIZING}
                style={{
                  width: '100%', padding: '0.9rem',
                  background: canFinalize ? '#16a34a' : '#e2e8f0',
                  color: canFinalize ? '#fff' : '#94a3b8',
                  border: 'none', borderRadius: 14, fontWeight: 800, fontSize: '1rem',
                  cursor: canFinalize ? 'pointer' : 'not-allowed',
                  boxShadow: canFinalize ? '0 4px 16px rgba(22,163,74,0.35)' : 'none',
                  transition: 'all 0.2s',
                }}
              >
                {flowState === S.FINALIZING ? '⏳ Finalizando...' : '🔥 Finalizar Pedido'}
              </button>
              <button
                onClick={cancelCurrent}
                disabled={flowState === S.FINALIZING}
                style={{ width: '100%', padding: '0.65rem', background: 'transparent', border: '1.5px solid #fca5a5', borderRadius: 12, fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', color: '#dc2626' }}
              >
                ✕ Cancelar Cliente Atual
              </button>
            </div>
          </>
        )}

        {/* ── ESTADO: sucesso ── */}
        {flowState === S.SUCCESS && (
          <SuccessScreen
            customerName={customer?.name || ''}
            itemCount={cart.length}
            completedCount={completedCnt}
            countdown={successCd}
          />
        )}

      </div>

      {/* ── Câmera da etiqueta (auto-captura) ── */}
      {showCamera && (
        <AutoCamera
          title="📷 Leitura de Etiqueta"
          subtitle="Enquadre a etiqueta — captura automática em 3s"
          autoCapture={true}
          onCapture={handleLabelCapture}
          onClose={() => { setShowCamera(false); setFlowState(S.WAITING) }}
        />
      )}

      {/* ── Câmera do produto (manual) ── */}
      {showQRScan && (
        <AutoCamera
          title="🏷️ Identificar Produto"
          subtitle="Fotografe a embalagem ou código do produto"
          autoCapture={false}
          onCapture={handleProductCapture}
          onClose={() => setShowQRScan(false)}
        />
      )}
    </div>
  )
}
