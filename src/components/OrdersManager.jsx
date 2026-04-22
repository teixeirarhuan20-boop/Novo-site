import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { LabelAssistant } from './LabelAssistant'

import { geocode, packLocation, unpackLocation, jitter } from '../utils/location'
import { generateId, formatDate, normalizeText, formatCurrency } from '../utils/formatting'
import { analyzeDocument } from '../lib/gemini'

// ─── Crop automático da etiqueta ─────────────────────────────────────────────
// Detecta a região clara (etiqueta branca) e elimina o fundo (papelão/mesa)
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
      const BRIGHT = 180 // luminância mínima para "branco/claro"

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
          if (lum > BRIGHT) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }

      const w = maxX - minX, h = maxY - minY
      if (w < 80 || h < 80) { resolve(dataUrl); return } // muito pequeno — usa original

      const PAD = 14
      const sx = Math.max(0, minX - PAD), sy = Math.max(0, minY - PAD)
      const sw = Math.min(width  - sx, w + PAD * 2)
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

// ─── Bipe de confirmação ──────────────────────────────────────────────────────
function playBeep() {
  try {
    const ac   = new (window.AudioContext || window.webkitAudioContext)()
    const osc  = ac.createOscillator()
    const gain = ac.createGain()
    osc.connect(gain); gain.connect(ac.destination)
    osc.frequency.value = 1047            // Dó5
    gain.gain.setValueAtTime(0.28, ac.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.22)
    osc.start(ac.currentTime); osc.stop(ac.currentTime + 0.22)
  } catch {}
}

// ─── Camera Scanner — modo lote, leitura automática contínua ─────────────────
function CameraScanner({ inventory, pessoas, transactions, onReviewQueue, onClose }) {
  const videoRef     = useRef(null)
  const canvasRef    = useRef(null)
  const streamRef    = useRef(null)
  const timerRef     = useRef(null)
  const busyRef      = useRef(false)
  const invRef       = useRef(inventory)
  const pesRef       = useRef(pessoas)
  const transRef     = useRef(transactions)
  const queueRef     = useRef([])

  useEffect(() => { invRef.current   = inventory   }, [inventory])
  useEffect(() => { pesRef.current   = pessoas     }, [pessoas])
  useEffect(() => { transRef.current = transactions }, [transactions])

  const [phase,  setPhase]  = useState('init')   // init|scanning|reading
  const [queue,  setQueue]  = useState([])
  const [flash,  setFlash]  = useState(null)      // {name,isDup} — overlay 1.2s
  const [torch,  setTorch]  = useState(false)
  const [errMsg, setErrMsg] = useState('')

  useEffect(() => { queueRef.current = queue }, [queue])

  // ── Inicia câmera ──────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    }).then(stream => {
      if (!alive) { stream.getTracks().forEach(t => t.stop()); return }
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play().then(() => setPhase('scanning')).catch(() => {})
      }
    }).catch(err => { setPhase('error'); setErrMsg(err.message) })
    return () => {
      alive = false
      clearTimeout(timerRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  // ── Captura automática ─────────────────────────────────────────────────────
  const tryCapture = useCallback(async () => {
    if (busyRef.current) return
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || video.readyState < 2 || !canvas) {
      timerRef.current = setTimeout(tryCapture, 600); return
    }

    canvas.width = video.videoWidth; canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0)

    // Detecção de etiqueta: mede % de pixels claros na janela central
    const iw = canvas.width, ih = canvas.height
    const rx = Math.floor(iw * 0.04), ry = Math.floor(ih * 0.28)
    const rw = Math.floor(iw * 0.92), rh = Math.floor(ih * 0.44)
    const { data } = ctx.getImageData(rx, ry, rw, rh)
    let bright = 0
    const step = 6, total = Math.floor(rw / step) * Math.floor(rh / step)
    for (let y = 0; y < rh; y += step)
      for (let x = 0; x < rw; x += step) {
        const i = (y * rw + x) * 4
        if (0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2] > 170) bright++
      }
    if (bright / total < 0.10) { timerRef.current = setTimeout(tryCapture, 1000); return }

    busyRef.current = true
    setPhase('reading')

    try {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.88)
      const cropped = await cropToWhiteLabel(dataUrl)
      const result  = await analyzeDocument(cropped, invRef.current, pesRef.current)

      if (!result || (!result.customerName && !result.orderId && !result.cep && !result.location)) {
        busyRef.current = false; setPhase('scanning')
        timerRef.current = setTimeout(tryCapture, 2000); return
      }

      // Verifica duplicata: já na fila ou registrado hoje
      const todayStr = new Date().toLocaleDateString('pt-BR')
      const isDupTrans = transRef.current.some(t => {
        if (t.type !== 'saída' || !t.date?.startsWith(todayStr)) return false
        const loc = unpackLocation(t.itemName)
        return (result.orderId && loc?.orderId === result.orderId) ||
               (result.customerName && t.personName?.toLowerCase() === result.customerName?.trim().toLowerCase())
      })
      const isDupQueue = queueRef.current.some(q =>
        (result.orderId && q.orderId === result.orderId) ||
        (result.customerName && q.customerName?.toLowerCase() === result.customerName?.trim().toLowerCase())
      )

      const item = { ...result, _id: `${Date.now()}-${Math.random()}`, _isDup: isDupTrans || isDupQueue }
      playBeep()
      setFlash({ name: result.customerName || result.orderId || '✓', isDup: item._isDup })

      setTimeout(() => {
        setQueue(prev => [...prev, item])
        setFlash(null)
        busyRef.current = false
        setPhase('scanning')
        timerRef.current = setTimeout(tryCapture, 1400)
      }, 1100)

    } catch {
      busyRef.current = false; setPhase('scanning')
      timerRef.current = setTimeout(tryCapture, 2500)
    }
  }, [])

  useEffect(() => {
    if (phase !== 'scanning') return
    timerRef.current = setTimeout(tryCapture, 1800)
    return () => clearTimeout(timerRef.current)
  }, [phase, tryCapture])

  const removeFromQueue = useCallback(id => setQueue(prev => prev.filter(q => q._id !== id)), [])

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try { await track.applyConstraints({ advanced: [{ torch: !torch }] }); setTorch(v => !v) } catch {}
  }, [torch])

  const frameColor = phase === 'reading' ? '#fbbf24' : flash ? (flash.isDup ? '#f97316' : '#22c55e') : '#fff'

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#000', display: 'flex', flexDirection: 'column' }}>

      {/* ── Área de vídeo ── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', minHeight: 0 }}>
        <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />

        {/* Overlay escuro */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '28%', background: 'rgba(0,0,0,0.55)' }} />
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '28%', background: 'rgba(0,0,0,0.55)' }} />
          <div style={{ position: 'absolute', top: '28%', left: 0, width: '4%', height: '44%', background: 'rgba(0,0,0,0.55)' }} />
          <div style={{ position: 'absolute', top: '28%', right: 0, width: '4%', height: '44%', background: 'rgba(0,0,0,0.55)' }} />
          {/* Moldura */}
          <div style={{ position: 'absolute', top: '28%', left: '4%', right: '4%', height: '44%', border: `2.5px solid ${frameColor}`, borderRadius: 10, transition: 'border-color 0.2s' }} />
          {/* Cantos */}
          {[['28%','4%','top','left'],['28%','4%','top','right'],['28%','4%','bottom','left'],['28%','4%','bottom','right']].map(([t,l,v,h],i) => (
            <div key={i} style={{ position: 'absolute', [v]: `calc(${v === 'top' ? '28%' : '28%'} - 2px)`, [h]: `calc(4% - 2px)`, width: 20, height: 20, [`border${v.charAt(0).toUpperCase()+v.slice(1)}`]: `4px solid ${frameColor}`, [`border${h.charAt(0).toUpperCase()+h.slice(1)}`]: `4px solid ${frameColor}`, borderRadius: v==='top'?(h==='left'?'6px 0 0 0':'0 6px 0 0'):(h==='left'?'0 0 0 6px':'0 0 6px 0'), transition: 'border-color 0.2s' }} />
          ))}
        </div>

        {/* Flash de confirmação */}
        {flash && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: flash.isDup ? 'rgba(249,115,22,0.2)' : 'rgba(34,197,94,0.2)', pointerEvents: 'none' }}>
            <div style={{ background: flash.isDup ? '#f97316' : '#22c55e', color: '#fff', padding: '0.7rem 1.4rem', borderRadius: 12, fontSize: '1rem', fontWeight: 800, boxShadow: '0 4px 20px rgba(0,0,0,0.3)', maxWidth: '80%', textAlign: 'center' }}>
              {flash.isDup ? '⚠️ Duplicata — ' : '✅ '}{flash.name}
            </div>
          </div>
        )}

        {/* Indicador de leitura */}
        {phase === 'reading' && (
          <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.75)', color: '#fbbf24', padding: '4px 14px', borderRadius: 99, fontSize: '0.78rem', fontWeight: 700 }}>
            ⏳ Lendo...
          </div>
        )}

        {/* Badge fila */}
        {queue.length > 0 && (
          <div style={{ position: 'absolute', top: 12, right: 12, background: '#2563eb', color: '#fff', borderRadius: 99, padding: '4px 13px', fontSize: '0.8rem', fontWeight: 800, boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
            {queue.length} na fila
          </div>
        )}

        {/* Instrução */}
        {phase === 'error' ? (
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', color: '#ef4444', fontWeight: 700, textAlign: 'center', padding: '0 1rem' }}>
            ❌ {errMsg || 'Câmera indisponível'}
          </div>
        ) : (
          <div style={{ position: 'absolute', top: '75%', left: 0, right: 0, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
            <span style={{ background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '0.73rem', fontWeight: 600, padding: '3px 12px', borderRadius: 99 }}>
              {phase === 'reading' ? 'Processando...' : 'Encaixe a etiqueta na moldura'}
            </span>
          </div>
        )}
      </div>

      {/* ── Fila (últimos 3) ── */}
      {queue.length > 0 && (
        <div style={{ background: '#0f172a', borderTop: '1px solid #1e293b', maxHeight: 108, overflowY: 'auto' }}>
          {[...queue].reverse().slice(0, 3).map(item => (
            <div key={item._id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.38rem 1rem', borderBottom: '1px solid #1e293b', background: item._isDup ? 'rgba(249,115,22,0.07)' : 'transparent' }}>
              <span style={{ fontSize: '0.68rem', flexShrink: 0 }}>{item._isDup ? '⚠️' : '✅'}</span>
              <span style={{ fontSize: '0.78rem', color: '#e2e8f0', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.customerName || item.orderId || '—'}
              </span>
              {item.location && <span style={{ fontSize: '0.67rem', color: '#475569', flexShrink: 0 }}>{item.location}</span>}
              <button onClick={() => removeFromQueue(item._id)} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: '0.82rem', padding: '0 2px', flexShrink: 0, lineHeight: 1 }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* ── Barra de ações ── */}
      <div style={{ background: '#0f172a', padding: '0.8rem 1rem 1.1rem', display: 'flex', gap: '0.55rem', alignItems: 'center' }}>
        <button onClick={toggleTorch} style={{ padding: '0.45rem 0.85rem', borderRadius: 9, background: torch ? '#fef08a' : '#1e293b', color: torch ? '#78350f' : '#94a3b8', border: '1px solid #334155', fontWeight: 600, cursor: 'pointer', fontSize: '0.78rem', flexShrink: 0 }}>
          {torch ? '🔦 ON' : '🔦'}
        </button>
        <button onClick={onClose} style={{ padding: '0.45rem 0.85rem', borderRadius: 9, background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', fontWeight: 600, cursor: 'pointer', fontSize: '0.78rem', flexShrink: 0 }}>
          ✕ Fechar
        </button>
        {queue.length > 0 && (
          <button
            onClick={() => { onReviewQueue(queue); }}
            style={{ marginLeft: 'auto', padding: '0.55rem 1.15rem', borderRadius: 9, background: 'linear-gradient(135deg,#1d4ed8,#2563eb)', color: '#fff', border: 'none', fontWeight: 800, cursor: 'pointer', fontSize: '0.85rem', boxShadow: '0 2px 10px rgba(37,99,235,0.45)', flexShrink: 0 }}
          >
            Revisar {queue.length} pedido{queue.length !== 1 ? 's' : ''} →
          </button>
        )}
      </div>

      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  )
}

// ─── Item individual na fila de revisão ──────────────────────────────────────
function QueueItem({ item, inventory, onChange, onRemove }) {
  const [search, setSearch] = useState('')
  const [open,   setOpen]   = useState(false)
  const selected = inventory.find(i => i.id === item.selectedProduct)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (q ? inventory.filter(i => i.name.toLowerCase().includes(q)) : inventory).slice(0, 10)
  }, [inventory, search])

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: '0.85rem 1rem', border: `1.5px solid ${item._isDup && item.keep ? '#fed7aa' : '#e2e8f0'}`, opacity: item.keep ? 1 : 0.45, transition: 'opacity 0.15s' }}>
      {/* Cabeçalho */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.55rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {item._isDup && <span style={{ background: '#fff7ed', color: '#f97316', fontSize: '0.65rem', fontWeight: 700, padding: '2px 7px', borderRadius: 99, border: '1px solid #fed7aa', marginRight: 5, whiteSpace: 'nowrap' }}>⚠️ Duplicata</span>}
          <span style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.88rem' }}>{item.customerName || '—'}</span>
          {item.orderId && <span style={{ color: '#94a3b8', fontSize: '0.7rem', marginLeft: 6 }}>#{item.orderId.slice(0, 16)}</span>}
          <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 2 }}>
            {[item.location, item.bairro, item.cep, item.rastreio ? `📦 ${item.rastreio}` : null].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
          {item._isDup && (
            <button onClick={() => onChange({ keep: !item.keep })} style={{ padding: '2px 8px', borderRadius: 6, fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer', background: item.keep ? '#fef3c7' : '#f0fdf4', color: item.keep ? '#d97706' : '#16a34a', border: `1px solid ${item.keep ? '#fde68a' : '#bbf7d0'}`, whiteSpace: 'nowrap' }}>
              {item.keep ? 'Ignorar' : 'Incluir'}
            </button>
          )}
          <button onClick={onRemove} style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: '0.95rem', padding: '0 2px', lineHeight: 1 }}>✕</button>
        </div>
      </div>

      {/* Seletor de produto + qtd */}
      {item.keep && (
        <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            {selected ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: 8, padding: '0.32rem 0.65rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#16a34a', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📦 {selected.name}</span>
                <button onClick={() => { onChange({ selectedProduct: '' }); setSearch('') }} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.8rem', lineHeight: 1 }}>✕</button>
              </div>
            ) : (
              <>
                <input
                  value={search} onChange={e => { setSearch(e.target.value); setOpen(true) }}
                  onFocus={() => setOpen(true)}
                  placeholder="🔍 Produto..."
                  style={{ width: '100%', padding: '0.35rem 0.65rem', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: '0.78rem', boxSizing: 'border-box', outline: 'none' }}
                />
                {open && (
                  <div style={{ position: 'absolute', top: '105%', left: 0, right: 0, zIndex: 60, background: '#fff', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.13)', border: '1px solid #e2e8f0', overflow: 'hidden', maxHeight: 170, overflowY: 'auto' }}>
                    {filtered.map(inv => (
                      <button key={inv.id} onClick={() => { onChange({ selectedProduct: inv.id }); setSearch(''); setOpen(false) }} style={{ width: '100%', padding: '0.42rem 0.75rem', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontSize: '0.78rem', color: '#1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.name}</span>
                        <span style={{ color: '#94a3b8', fontSize: '0.68rem', flexShrink: 0 }}>{inv.quantity} un</span>
                      </button>
                    ))}
                    {!filtered.length && <div style={{ padding: '0.5rem 0.75rem', color: '#94a3b8', fontSize: '0.78rem' }}>Nenhum produto</div>}
                  </div>
                )}
              </>
            )}
          </div>
          <input
            type="number" min="1" value={item.quantity}
            onChange={e => onChange({ quantity: Math.max(1, Number(e.target.value) || 1) })}
            style={{ width: 54, padding: '0.35rem 0.4rem', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: '0.82rem', textAlign: 'center' }}
          />
        </div>
      )}
    </div>
  )
}

// ─── Tela de revisão da fila ──────────────────────────────────────────────────
function QueueReview({ queue, inventory, onConfirm, onBack }) {
  const [items, setItems] = useState(() =>
    queue.map(q => ({ ...q, selectedProduct: '', quantity: 1, keep: true }))
  )

  const update = useCallback((id, updates) => {
    setItems(prev => prev.map(it => it._id === id ? { ...it, ...updates } : it))
  }, [])

  const remove = useCallback((id) => {
    setItems(prev => prev.filter(it => it._id !== id))
  }, [])

  const valid = items.filter(it => it.keep && it.selectedProduct)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: '#f8fafc', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{ background: '#0f172a', padding: '0.8rem 1.1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.15rem', lineHeight: 1 }}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#fff' }}>📋 Revisar Pedidos</div>
          <div style={{ fontSize: '0.7rem', color: '#475569' }}>
            {items.length} etiqueta{items.length !== 1 ? 's' : ''} · {valid.length} com produto selecionado
          </div>
        </div>
        {valid.length > 0 && (
          <button
            onClick={() => onConfirm(items.filter(it => it.keep && it.selectedProduct))}
            style={{ padding: '0.5rem 1.1rem', borderRadius: 9, background: '#22c55e', color: '#fff', border: 'none', fontWeight: 800, cursor: 'pointer', fontSize: '0.83rem', boxShadow: '0 2px 8px rgba(34,197,94,0.35)', whiteSpace: 'nowrap' }}
          >
            ✅ Confirmar {valid.length}
          </button>
        )}
      </div>

      {/* Lista */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 0.85rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
        {items.length === 0 && (
          <div style={{ textAlign: 'center', color: '#94a3b8', marginTop: '3rem' }}>
            <div style={{ fontSize: '2rem' }}>📭</div>
            <div style={{ marginTop: '0.5rem', fontSize: '0.88rem' }}>Fila vazia</div>
          </div>
        )}
        {items.map(item => (
          <QueueItem
            key={item._id}
            item={item}
            inventory={inventory}
            onChange={updates => update(item._id, updates)}
            onRemove={() => remove(item._id)}
          />
        ))}
      </div>

      {/* Footer */}
      {valid.length > 0 && (
        <div style={{ background: '#fff', borderTop: '1px solid #e2e8f0', padding: '0.85rem 1rem', flexShrink: 0 }}>
          <button
            onClick={() => onConfirm(items.filter(it => it.keep && it.selectedProduct))}
            style={{ width: '100%', padding: '0.7rem', borderRadius: 10, background: 'linear-gradient(135deg,#16a34a,#22c55e)', color: '#fff', border: 'none', fontWeight: 800, cursor: 'pointer', fontSize: '0.92rem', boxShadow: '0 3px 12px rgba(34,197,94,0.3)' }}
          >
            ✅ Registrar {valid.length} pedido{valid.length !== 1 ? 's' : ''}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseDate(str) {
  if (!str) return new Date(0)
  const part = str.split(' ')[0] // "17/04/2026"
  const [d, m, y] = part.split('/')
  return new Date(`${y}-${m}-${d}`)
}

const STATUS_CFG = {
  pendente:   { label: 'Pendente',   color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', icon: '🕐' },
  em_envio:   { label: 'Em Envio',   color: '#d97706', bg: '#fef3c7', border: '#fde68a', icon: '🚚' },
  finalizado: { label: 'Finalizado', color: '#16a34a', bg: '#dcfce7', border: '#bbf7d0', icon: '✅' },
  problema:   { label: 'Problema',   color: '#dc2626', bg: '#fee2e2', border: '#fecaca', icon: '⚠️' },
}

// ─── Status Badge com dropdown inline ─────────────────────────────────────────
function StatusBadge({ status, onChange, compact = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const cfg = STATUS_CFG[status] || STATUS_CFG.pendente

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={e => { e.stopPropagation(); if (onChange) setOpen(v => !v) }}
        style={{
          display: 'flex', alignItems: 'center', gap: compact ? 3 : 5,
          padding: compact ? '2px 8px' : '4px 11px',
          borderRadius: 99, border: `1.5px solid ${cfg.border}`,
          background: cfg.bg, color: cfg.color,
          fontSize: compact ? '0.68rem' : '0.75rem', fontWeight: 700,
          cursor: onChange ? 'pointer' : 'default', whiteSpace: 'nowrap',
          lineHeight: 1.4,
        }}
      >
        {cfg.icon} {!compact && cfg.label} {onChange && '▾'}
      </button>
      {open && onChange && (
        <div
          style={{
            position: 'absolute', top: '110%', left: 0, zIndex: 500,
            background: '#fff', borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.14)', border: '1px solid #e2e8f0',
            overflow: 'hidden', minWidth: 155,
          }}
          onClick={e => e.stopPropagation()}
        >
          {Object.entries(STATUS_CFG).map(([k, v]) => (
            <button
              key={k}
              onClick={() => { onChange(k); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '0.55rem 0.85rem', border: 'none',
                background: k === status ? v.bg : 'transparent',
                cursor: 'pointer', fontSize: '0.78rem', fontWeight: k === status ? 700 : 500,
                color: k === status ? v.color : '#374151', textAlign: 'left',
              }}
            >
              {v.icon} {v.label} {k === status && '✓'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Card de Resumo ───────────────────────────────────────────────────────────
function SummaryCard({ icon, label, value, color, bg, border, active, onClick, sub }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: active ? bg : '#fff',
        borderRadius: 14, padding: '1rem 1.2rem',
        border: `1.5px solid ${active ? border : '#e2e8f0'}`,
        boxShadow: active ? `0 0 0 3px ${color}20, 0 2px 8px rgba(0,0,0,0.05)` : '0 1px 3px rgba(0,0,0,0.06)',
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex', flexDirection: 'column', gap: '0.2rem',
        transition: 'all 0.15s', userSelect: 'none',
      }}
      onMouseEnter={e => onClick && (e.currentTarget.style.transform = 'translateY(-2px)')}
      onMouseLeave={e => onClick && (e.currentTarget.style.transform = '')}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: '1.15rem' }}>{icon}</span>
        <span style={{ fontSize: '1.65rem', fontWeight: 800, color: active ? color : '#0f172a', lineHeight: 1 }}>{value}</span>
      </div>
      <span style={{ fontSize: '0.71rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</span>
      {sub && <span style={{ fontSize: '0.68rem', color: color, fontWeight: 600 }}>{sub}</span>}
    </div>
  )
}

// ─── Detalhes expandidos do pedido ───────────────────────────────────────────
function OrderDetails({ tx, loc, status, onStatusChange }) {
  const fields = [
    ['Referência / Pedido', loc?.orderId || '—'],
    ['Endereço',           loc?.address || '—'],
    ['Bairro',             loc?.bairro  || '—'],
    ['CEP',                loc?.cep     || '—'],
    ['Modalidade',         loc?.modalidade || '—'],
    ['Rastreio',           loc?.rastreio   || '—'],
    ['Preço Unitário',     formatCurrency(tx.unitPrice)],
    ['Quantidade',         `${tx.quantity} un.`],
    ['Total',              formatCurrency(tx.totalValue)],
    ['Coordenadas',        loc?.lat ? `${Number(loc.lat).toFixed(4)}, ${Number(loc.lng).toFixed(4)}` : '—'],
    ['Data',               tx.date || '—'],
    ['ID',                 tx.id || '—'],
  ]
  return (
    <div style={{ padding: '0.85rem 1rem 1rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(195px, 1fr))', gap: '0.5rem', marginBottom: '0.85rem' }}>
        {fields.map(([k, v]) => (
          <div key={k} style={{ background: '#fff', borderRadius: 8, padding: '0.5rem 0.75rem', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '0.63rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{k}</div>
            <div style={{ fontSize: '0.8rem', color: '#1e293b', fontWeight: 500, marginTop: 2, wordBreak: 'break-all' }}>{v}</div>
          </div>
        ))}
      </div>
      {/* Alterar Status inline */}
      <div style={{ background: '#fff', borderRadius: 8, padding: '0.6rem 0.85rem', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', flexShrink: 0 }}>Alterar Status:</span>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {Object.entries(STATUS_CFG).map(([k, v]) => (
            <button
              key={k}
              onClick={() => onStatusChange(k)}
              style={{
                padding: '4px 12px', borderRadius: 99,
                background: k === status ? v.bg : '#f8fafc',
                border: `1.5px solid ${k === status ? v.border : '#e2e8f0'}`,
                color: k === status ? v.color : '#64748b',
                fontSize: '0.75rem', fontWeight: k === status ? 700 : 500,
                cursor: 'pointer', transition: 'all 0.12s',
              }}
            >
              {v.icon} {v.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Linha de Pedido (expansível) ────────────────────────────────────────────
function OrderRow({ tx, status, expanded, onExpand, onStatusChange, onViewMap, onDelete, selected, onSelect, batchMode }) {
  const loc      = useMemo(() => unpackLocation(tx.itemName), [tx.itemName])
  const cfg      = STATUS_CFG[status] || STATUS_CFG.pendente
  const prodName = loc?.cleanName || tx.itemName?.split('||')[0]?.trim() || '—'
  const city     = loc?.city || tx.city || '—'
  const rastreio = loc?.rastreio || null
  const date     = tx.date?.split(' ')[0] || '—'
  const [copied, setCopied] = useState(false)

  // Dias em envio
  const daysInStatus = useMemo(() => {
    if (status !== 'em_envio' || !tx.date) return null
    const parts = tx.date.split(' ')[0].split('/')
    if (parts.length < 3) return null
    const txDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`)
    const diff   = Math.floor((Date.now() - txDate.getTime()) / 86_400_000)
    return diff
  }, [status, tx.date])

  const copyRastreio = useCallback((e) => {
    e.stopPropagation()
    if (!rastreio) return
    navigator.clipboard.writeText(rastreio).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1800)
    }).catch(() => {})
  }, [rastreio])

  return (
    <>
      <tr
        onClick={() => onExpand(tx.id)}
        style={{
          cursor: 'pointer',
          background: expanded ? '#f8fafc' : selected ? '#eff6ff' : undefined,
          borderBottom: '1px solid #f1f5f9',
          borderLeft: `3px solid ${cfg.color}`,
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => !expanded && !selected && (e.currentTarget.style.background = '#fafafa')}
        onMouseLeave={e => !expanded && !selected && (e.currentTarget.style.background = '')}
      >
        {batchMode && (
          <td onClick={e => e.stopPropagation()} style={{ width: 38, textAlign: 'center', padding: '0.7rem 0.5rem' }}>
            <input
              type="checkbox" checked={selected}
              onChange={e => onSelect(tx.id, e.target.checked)}
              style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#7c3aed' }}
            />
          </td>
        )}
        <td style={{ padding: '0.7rem 0.75rem', fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap' }}>{date}</td>
        <td style={{ padding: '0.7rem 0.75rem', fontWeight: 600, fontSize: '0.83rem', color: '#0f172a', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tx.personName || '—'}
        </td>
        <td style={{ padding: '0.7rem 0.75rem', fontSize: '0.8rem', color: '#334155', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {prodName}
        </td>
        <td style={{ padding: '0.7rem 0.75rem', fontSize: '0.77rem', color: '#64748b' }}>{city}</td>
        <td style={{ padding: '0.7rem 0.75rem', fontSize: '0.78rem', textAlign: 'center' }}>{tx.quantity}</td>
        <td style={{ padding: '0.7rem 0.75rem', fontSize: '0.82rem', fontWeight: 700, color: '#16a34a', whiteSpace: 'nowrap' }}>{formatCurrency(tx.totalValue)}</td>
        <td style={{ padding: '0.7rem 0.75rem' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
            <StatusBadge status={status} onChange={onStatusChange} compact />
            {daysInStatus !== null && (
              <span style={{ fontSize: '0.62rem', fontWeight: 700, color: daysInStatus > 5 ? '#dc2626' : daysInStatus > 2 ? '#d97706' : '#64748b', whiteSpace: 'nowrap' }}>
                {daysInStatus === 0 ? 'hoje' : `há ${daysInStatus}d`}
              </span>
            )}
          </div>
        </td>
        <td style={{ padding: '0.7rem 0.75rem', maxWidth: 135 }} onClick={e => e.stopPropagation()}>
          {rastreio ? (
            <button
              onClick={copyRastreio}
              title="Clique para copiar"
              style={{ background: copied ? '#f0fdf4' : '#eff6ff', border: `1px solid ${copied ? '#bbf7d0' : '#bfdbfe'}`, borderRadius: 6, padding: '2px 7px', cursor: 'pointer', fontSize: '0.68rem', color: copied ? '#16a34a' : '#2563eb', fontWeight: 700, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', transition: 'all 0.15s' }}
            >
              {copied ? '✅ Copiado!' : `📦 ${rastreio}`}
            </button>
          ) : (
            <span style={{ color: '#cbd5e1', fontSize: '0.7rem' }}>—</span>
          )}
        </td>
        <td style={{ padding: '0.7rem 0.75rem' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'nowrap' }}>
            <button onClick={() => onViewMap(tx)} title="Ver no mapa" style={btnStyle('#e0f2fe', '#0284c7')}>🗺️</button>
            {status !== 'finalizado' && (
              <button onClick={() => onStatusChange('finalizado')} title="Finalizar pedido" style={btnStyle('#dcfce7', '#16a34a')}>✅</button>
            )}
            {status === 'pendente' && (
              <button onClick={() => onStatusChange('em_envio')} title="Marcar como enviado" style={btnStyle('#fef3c7', '#d97706')}>🚚</button>
            )}
            {status !== 'problema' && (
              <button onClick={() => onStatusChange('problema')} title="Marcar problema" style={btnStyle('#fee2e2', '#dc2626')}>⚠️</button>
            )}
            <button onClick={() => onDelete(tx.id)} title="Excluir" style={btnStyle('#fee2e2', '#dc2626', true)}>🗑️</button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
          <td colSpan={batchMode ? 10 : 9} style={{ padding: 0 }}>
            <OrderDetails tx={tx} loc={loc} status={status} onStatusChange={onStatusChange} />
          </td>
        </tr>
      )}
    </>
  )
}

function btnStyle(bg, color, ghost = false) {
  return {
    padding: '3px 7px', border: `1px solid ${ghost ? '#fecaca' : bg}`,
    background: ghost ? '#fff' : bg, borderRadius: 6,
    cursor: 'pointer', fontSize: '0.75rem', lineHeight: 1, flexShrink: 0,
    color: ghost ? color : undefined,
  }
}

// ─── Mapa de Pedidos ──────────────────────────────────────────────────────────
function OrdersMap({ transactions, focusTx }) {
  const containerRef = useRef(null)
  const mapRef       = useRef(null)
  const markersRef   = useRef([])
  const sales = useMemo(() => transactions.filter(t => t.type === 'saída'), [transactions])

  useEffect(() => {
    const init = () => {
      if (!containerRef.current || mapRef.current) return
      if (!window.L) { setTimeout(init, 200); return }
      mapRef.current = window.L.map(containerRef.current).setView([-15.78, -47.93], 4)
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap', maxZoom: 18,
      }).addTo(mapRef.current)
      setTimeout(() => mapRef.current?.invalidateSize(), 200)
    }
    init()
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null } }
  }, [])

  useEffect(() => {
    if (!mapRef.current || !window.L) return
    markersRef.current.forEach(m => mapRef.current.removeLayer(m))
    markersRef.current = []
    const blueIcon = window.L.divIcon({
      html: `<div style="width:12px;height:12px;border-radius:50%;background:#3b82f6;border:2px solid #fff;box-shadow:0 1px 6px rgba(59,130,246,0.5)"></div>`,
      className: '', iconSize: [12, 12], iconAnchor: [6, 6], popupAnchor: [0, -8],
    })
    sales.forEach(t => {
      const loc = unpackLocation(t.itemName)
      if (!loc?.lat || !loc?.lng || isNaN(loc.lat)) return
      const m = window.L.marker([jitter(loc.lat), jitter(loc.lng)], { icon: blueIcon })
        .addTo(mapRef.current)
        .bindPopup(`<div style="font-family:inherit;font-size:0.8rem;min-width:160px">
          <b>${loc.cleanName || t.itemName.split('||')[0]}</b><br>
          👤 ${t.personName} · 📍 ${loc.city || '—'}<br>
          💰 <b style="color:#16a34a">${formatCurrency(t.totalValue)}</b>
          ${loc.rastreio ? `<br>📦 ${loc.rastreio}` : ''}
        </div>`)
      markersRef.current.push(m)
    })
    if (markersRef.current.length) {
      try { mapRef.current.fitBounds(window.L.featureGroup(markersRef.current).getBounds().pad(0.3)) } catch {}
    }
    setTimeout(() => mapRef.current?.invalidateSize(), 200)
  }, [sales])

  useEffect(() => {
    if (!focusTx || !mapRef.current || !window.L) return
    const loc = unpackLocation(focusTx.itemName)
    if (!loc?.lat || !loc?.lng || isNaN(loc.lat)) return
    mapRef.current.setView([loc.lat, loc.lng], 13)
  }, [focusTx])

  return <div ref={containerRef} style={{ height: 360, width: '100%', borderRadius: '0 0 14px 14px' }} />
}

// ─── Componente Principal ─────────────────────────────────────────────────────
export function OrdersManager({ inventory, setInventory, pessoas, setPessoas, transactions, setTransactions, addToast, isActive }) {

  // ── Tabs ──
  const [pageTab, setPageTab] = useState('central')

  // ── Camera / fila ──
  const [showCamera,     setShowCamera]     = useState(false)
  const [showReview,     setShowReview]     = useState(false)
  const [pendingQueue,   setPendingQueue]   = useState([])
  // ── Form state ──
  const [showLabel,      setShowLabel]      = useState(false)
  const [dragOver,       setDragOver]       = useState(false)
  const [dragProcessing, setDragProcessing] = useState(false)
  // ── Central drag & drop ────────────────────────────────────────────────────
  const [centralDrag,    setCentralDrag]    = useState(false)
  const [centralBusy,    setCentralBusy]    = useState(false)
  const [centralResult,  setCentralResult]  = useState(null)
  const [productSearch,  setProductSearch]  = useState('')
  const [selectedItem,   setSelectedItem]   = useState('')
  const [selectedPessoa, setSelectedPessoa] = useState('')
  const [quantity,       setQuantity]       = useState(1)
  const [location,       setLocation]       = useState('')
  const [address,        setAddress]        = useState('')
  const [bairro,         setBairro]         = useState('')
  const [orderRef,       setOrderRef]       = useState('')
  const [rastreio,       setRastreio]       = useState('')
  const [modalidade,     setModalidade]     = useState('')
  const [processing,     setProcessing]     = useState(false)

  // ── Central state ──
  const [search,         setSearch]         = useState('')
  const [filterStatus,   setFilterStatus]   = useState('all')
  const [filterCity,     setFilterCity]     = useState('all')
  const [filterProduct,  setFilterProduct]  = useState('all')
  const [filterPeriod,   setFilterPeriod]   = useState('all')
  const [expandedId,     setExpandedId]     = useState(null)
  const [selectedIds,    setSelectedIds]    = useState(new Set())
  const [batchMode,      setBatchMode]      = useState(false)
  const [showMap,        setShowMap]        = useState(false)
  const [focusTx,        setFocusTx]        = useState(null)

  // ── Status persistido em localStorage ──
  const [statusMap, setStatusMap] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ord_statusMap') || '{}') } catch { return {} }
  })

  const getStatus = useCallback((t) => {
    if (t.status && t.status !== 'pendente') return t.status
    if (statusMap[t.id]) return statusMap[t.id]
    const loc = unpackLocation(t.itemName)
    return loc?.rastreio ? 'em_envio' : 'pendente'
  }, [statusMap])

  const updateStatus = useCallback(async (id, newStatus) => {
    const next = { ...statusMap, [id]: newStatus }
    setStatusMap(next)
    localStorage.setItem('ord_statusMap', JSON.stringify(next))
    setTransactions(prev => prev.map(t => t.id === id ? { ...t, status: newStatus } : t))
    await supabase.from('transactions').update({ status: newStatus }).eq('id', id).maybeSingle().catch(() => {})
  }, [statusMap, setTransactions])

  const deleteTransaction = useCallback(async (id) => {
    if (!window.confirm('Excluir este pedido permanentemente?')) return
    await supabase.from('transactions').delete().eq('id', id)
    setTransactions(prev => prev.filter(t => t.id !== id))
    setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n })
    addToast('Pedido excluído.', 'info')
  }, [setTransactions, addToast])

  // ── Sales data ──
  const now   = useMemo(() => new Date(), [])
  const sales = useMemo(() => transactions.filter(t => t.type === 'saída'), [transactions])

  // ── KPIs ──
  const todayStr      = now.toLocaleDateString('pt-BR')
  const todayCount    = useMemo(() => sales.filter(t => t.date?.split(' ')[0] === todayStr).length, [sales, todayStr])
  const emEnvioCount  = useMemo(() => sales.filter(t => getStatus(t) === 'em_envio').length, [sales, getStatus])
  const finalizCount  = useMemo(() => sales.filter(t => getStatus(t) === 'finalizado').length, [sales, getStatus])
  const problemaCount = useMemo(() => sales.filter(t => getStatus(t) === 'problema').length, [sales, getStatus])

  // ── Filtered sales ──
  const filteredSales = useMemo(() => {
    let list = [...sales]
    if (filterPeriod !== 'all') {
      const days = filterPeriod === 'today' ? 1 : filterPeriod === 'week' ? 7 : 30
      list = list.filter(t => (now - parseDate(t.date)) < days * 86_400_000)
    }
    if (filterStatus  !== 'all') list = list.filter(t => getStatus(t) === filterStatus)
    if (filterCity    !== 'all') list = list.filter(t => (unpackLocation(t.itemName)?.city || t.city) === filterCity)
    if (filterProduct !== 'all') list = list.filter(t => t.itemName?.split('||')[0]?.trim() === filterProduct)
    if (search.trim()) {
      const q = normalizeText(search)
      list = list.filter(t => {
        const loc = unpackLocation(t.itemName)
        return (
          normalizeText(t.personName  || '').includes(q) ||
          normalizeText(t.itemName    || '').includes(q) ||
          normalizeText(loc?.city     || t.city || '').includes(q) ||
          normalizeText(loc?.rastreio || '').includes(q) ||
          normalizeText(loc?.orderId  || '').includes(q)
        )
      })
    }
    return list.reverse()
  }, [sales, filterPeriod, filterStatus, filterCity, filterProduct, search, getStatus, now])

  const cities   = useMemo(() => [...new Set(sales.map(t => unpackLocation(t.itemName)?.city || t.city).filter(Boolean))].sort(), [sales])
  const products = useMemo(() => [...new Set(sales.map(t => t.itemName?.split('||')[0]?.trim()).filter(Boolean))].sort(), [sales])

  const hasFilters = search || filterStatus !== 'all' || filterCity !== 'all' || filterProduct !== 'all' || filterPeriod !== 'all'

  // ── Ações em lote ──
  const handleBatchStatus = useCallback(async (newStatus) => {
    const ids = [...selectedIds]
    for (const id of ids) await updateStatus(id, newStatus)
    addToast(`${ids.length} pedido${ids.length > 1 ? 's' : ''} atualizado${ids.length > 1 ? 's' : ''}.`, 'success')
    setSelectedIds(new Set())
  }, [selectedIds, updateStatus, addToast])

  const handleBatchDelete = useCallback(async () => {
    const ids = [...selectedIds]
    if (!window.confirm(`Excluir ${ids.length} pedido${ids.length > 1 ? 's' : ''}?`)) return
    for (const id of ids) await supabase.from('transactions').delete().eq('id', id)
    setTransactions(prev => prev.filter(t => !selectedIds.has(t.id)))
    setSelectedIds(new Set())
    addToast(`${ids.length} pedido${ids.length > 1 ? 's' : ''} excluído${ids.length > 1 ? 's' : ''}.`, 'info')
  }, [selectedIds, setTransactions, addToast])

  // ── Helper: verifica se orderId ou rastreio já existe nas transações ────────
  const isDuplicateOrder = useCallback((orderId, rastreio) => {
    if (!orderId && !rastreio) return false
    return transactions.some(t => {
      if (t.type !== 'saída') return false
      const loc = unpackLocation(t.itemName)
      if (orderId  && loc?.orderId  && loc.orderId  === orderId)  return true
      if (rastreio && loc?.rastreio && loc.rastreio === rastreio) return true
      return false
    })
  }, [transactions])

  // ── Processa fila do scanner em lote ──────────────────────────────────────
  const processQueue = useCallback(async (items) => {
    let ok = 0, fail = 0, dup = 0
    for (const item of items) {
      try {
        // Bloqueia duplicata real antes de salvar
        if (isDuplicateOrder(item.orderId, item.rastreio)) {
          addToast(`⚠️ Duplicata ignorada: ${item.customerName || item.orderId}`, 'warning')
          dup++; continue
        }
        const inv = inventory.find(i => i.id === item.selectedProduct)
        if (!inv) { fail++; continue }
        const qty = Number(item.quantity) || 1
        if (Number(inv.quantity) < qty) {
          addToast(`Estoque insuficiente: ${inv.name}`, 'warning'); fail++; continue
        }
        let pessoa = pessoas.find(p => p.name.toLowerCase() === item.customerName?.toLowerCase())
        if (!pessoa && item.customerName) {
          pessoa = { id: generateId(), name: item.customerName.trim(), document: '', role: 'cliente', contact: '' }
          if (setPessoas) setPessoas(prev => [...prev, pessoa])
          await supabase.from('pessoas').insert([pessoa])
        }
        const geo  = await geocode(item.location || item.cep || '')
        const city = geo?.city || item.location || ''
        const packedName = packLocation(inv.name, {
          city, lat: geo?.lat, lng: geo?.lng,
          orderId: item.orderId || '', cep: item.cep || '',
          address: item.address || '', bairro: item.bairro || '',
          rastreio: item.rastreio || '', modalidade: item.modalidade || '',
        })
        const newQty = Number(inv.quantity) - qty
        const tx = {
          id: generateId(), type: 'saída', itemId: inv.id, itemName: packedName, city,
          quantity: qty, unitPrice: inv.price, totalValue: inv.price * qty,
          personName: pessoa?.name || item.customerName || 'Desconhecido', date: formatDate(),
        }
        await Promise.all([
          supabase.from('inventory').update({ quantity: newQty }).eq('id', inv.id),
          supabase.from('transactions').insert([tx]),
        ])
        supabase.from('transactions').update({ status: 'pendente' }).eq('id', tx.id).then(() => {})
        setInventory(prev => prev.map(i => i.id === inv.id ? { ...i, quantity: newQty } : i))
        setTransactions(prev => [...prev, tx])
        ok++
      } catch (err) {
        addToast(`Erro: ${err.message}`, 'error'); fail++
      }
    }
    const parts = []
    if (ok   > 0) parts.push(`✅ ${ok} registrado${ok !== 1 ? 's' : ''}`)
    if (dup  > 0) parts.push(`⚠️ ${dup} duplicata${dup !== 1 ? 's' : ''} ignorada${dup !== 1 ? 's' : ''}`)
    if (fail > 0) parts.push(`❌ ${fail} com erro`)
    if (parts.length) addToast(parts.join(' · '), ok > 0 ? 'success' : 'warning')
    setShowReview(false); setPendingQueue([])
    if (ok > 0) setPageTab('central')
  }, [inventory, pessoas, setPessoas, setInventory, setTransactions, addToast, isDuplicateOrder])

  // ── Handlers do formulário (preservados intactos) ──
  const filteredProducts = useMemo(() => {
    const tokens = normalizeText(productSearch).split(/\s+/).filter(Boolean)
    return tokens.length
      ? inventory.filter(i => tokens.every(t => normalizeText(`${i.name} ${i.category || ''}`).includes(t)))
      : inventory
  }, [inventory, productSearch])

  const handleLabelData = useCallback(async (data) => {
    if (data.location || data.cep) {
      let loc = data.location || ''
      const cep = (data.cep || '').replace(/\D/g, '')
      if (cep && !loc.includes(cep)) {
        const fmt = cep.replace(/(\d{5})(\d{3})/, '$1-$2')
        loc += loc ? ` - CEP: ${fmt}` : fmt
      }
      setLocation(loc)
    }
    if (data.quantity)   setQuantity(Number(data.quantity))
    if (data.orderId)    setOrderRef(data.orderId)
    if (data.address)    setAddress(data.address)
    if (data.bairro)     setBairro(data.bairro)
    if (data.rastreio)   setRastreio(data.rastreio)
    if (data.modalidade) setModalidade(data.modalidade)
    if (data.nf && !orderRef) setOrderRef(`NF: ${data.nf}`)

    if (data.productName) {
      setProductSearch(data.productName)
      const tokens = normalizeText(data.productName).split(/\s+/).filter(t => t.length > 1)
      let best = null, bestScore = 0
      inventory.forEach(item => {
        const score = tokens.filter(t => normalizeText(item.name).includes(t)).length
        if (score > bestScore) { bestScore = score; best = item }
      })
      if (best && bestScore > 0) setSelectedItem(best.id)
    }

    if (data.customerName) {
      const name = data.customerName.trim()
      const existing = pessoas.find(p => p.name.toLowerCase() === name.toLowerCase())
      if (existing) {
        setSelectedPessoa(existing.name)
        addToast(`✅ Cliente identificado: ${existing.name}`, 'success')
      } else {
        setSelectedPessoa(name)
        addToast(`👤 Novo cliente detectado: ${name}`, 'info')
        const novo = { id: generateId(), name, document: '', role: 'cliente', contact: '' }
        if (setPessoas) setPessoas(prev => [...prev, novo])
        await supabase.from('pessoas').insert([novo])
      }
    }
  }, [inventory, pessoas, setPessoas, addToast, orderRef])

  // ── Drag & Drop na Central — filtra pedidos pela imagem ───────────────────
  const handleCentralDrop = useCallback(async (e) => {
    e.preventDefault()
    setCentralDrag(false)
    const file = e.dataTransfer.files?.[0]
    if (!file || !file.type.startsWith('image/')) {
      addToast('Arraste uma imagem de etiqueta.', 'warning'); return
    }
    setCentralBusy(true)
    setCentralResult(null)
    try {
      const dataUrl = await new Promise((res, rej) => {
        const reader = new FileReader()
        reader.onload = ev => res(ev.target.result)
        reader.onerror = rej
        reader.readAsDataURL(file)
      })

      // Recorta etiqueta + Vision direto
      const cropped = await cropToWhiteLabel(dataUrl)
      const result  = await analyzeDocument(cropped, inventory, pessoas)

      if (result && (result.customerName || result.location || result.rastreio || result.orderId)) {
        const q = result.customerName || result.rastreio || result.orderId || result.location || ''
        setSearch(q)
        setCentralResult(result)
        addToast(`🔍 Filtrando por: "${q}"`, 'success')
      } else {
        addToast('Não encontrei dados para filtrar. Tente outra imagem.', 'warning')
      }
    } catch (err) {
      addToast(`Erro: ${err.message}`, 'error')
    } finally {
      setCentralBusy(false)
    }
  }, [inventory, pessoas, addToast])

  // ── Drag & Drop de imagem para extração de dados ────────────────────────────
  const handleDrop = useCallback(async (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (!file || !file.type.startsWith('image/')) {
      addToast('Arraste uma imagem de etiqueta ou pedido.', 'warning')
      return
    }
    setDragProcessing(true)
    addToast('🔍 Lendo etiqueta...', 'info')
    try {
      const dataUrl = await new Promise((res, rej) => {
        const reader = new FileReader()
        reader.onload = ev => res(ev.target.result)
        reader.onerror = rej
        reader.readAsDataURL(file)
      })

      // Recorta automaticamente a etiqueta (remove fundo de papelão/mesa)
      const cropped = await cropToWhiteLabel(dataUrl)

      // Vision direto — muito mais preciso que OCR para fotos de etiqueta
      const result = await analyzeDocument(cropped, inventory, pessoas)

      if (result && (result.customerName || result.location || result.cep || result.orderId)) {
        await handleLabelData(result)
        addToast('✅ Dados extraídos!', 'success')
      } else {
        addToast('Não foi possível extrair dados. Tente uma foto mais próxima da etiqueta.', 'warning')
      }
    } catch (err) {
      addToast(`Erro ao processa