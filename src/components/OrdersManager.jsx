import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { LabelAssistant } from './LabelAssistant'
import { geocode, packLocation, unpackLocation, getProductColor, jitter } from '../utils/location'
import { generateId, formatDate, normalizeText, formatCurrency } from '../utils/formatting'

function OrdersMap({ transactions, inventory }) {
  const containerRef = useRef(null)
  const mapRef       = useRef(null)
  const markersRef   = useRef([])

  const sales = useMemo(() => transactions.filter(t => t.type === 'saída'), [transactions])

  useEffect(() => {
    const init = () => {
      if (!containerRef.current || mapRef.current) return
      if (!window.L) { setTimeout(init, 200); return }
      mapRef.current = window.L.map(containerRef.current).setView([-15.78, -47.93], 4)
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mapRef.current)
      setTimeout(() => mapRef.current?.invalidateSize(), 200)
    }
    init()
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null } }
  }, [])

  useEffect(() => {
    if (!mapRef.current || !window.L) return
    markersRef.current.forEach(m => mapRef.current.removeLayer(m))
    markersRef.current = []

    sales.forEach(t => {
      const loc = unpackLocation(t.itemName)
      if (!loc?.lat || !loc?.lng || isNaN(loc.lat)) return
      const color = getProductColor(loc.cleanName, inventory)
      const m = window.L.circleMarker([jitter(loc.lat), jitter(loc.lng)], {
        radius: 10, fillColor: color, color: '#fff', weight: 2, fillOpacity: 0.9,
      }).addTo(mapRef.current).bindPopup(`
        <b style="color:${color}">${loc.cleanName}</b><br>
        👤 ${t.personName}<br>📍 ${loc.city}<br>💰 R$ ${Number(t.totalValue).toFixed(2)}
      `)
      markersRef.current.push(m)
    })

    if (markersRef.current.length > 0) {
      mapRef.current.fitBounds(window.L.featureGroup(markersRef.current).getBounds().pad(0.3))
    }
    setTimeout(() => mapRef.current?.invalidateSize(), 200)
  }, [sales])

  return (
    <div className="card mt-3">
      <h3 style={{ marginBottom: '1rem', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
        🗺️ Mapa de Pedidos
      </h3>
      <div ref={containerRef} className="map-container" style={{ height: 380 }} />
    </div>
  )
}

export function OrdersManager({ inventory, setInventory, pessoas, setPessoas, transactions, setTransactions, addToast, isActive }) {
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

  const filteredProducts = useMemo(() => {
    const tokens = normalizeText(productSearch).split(/\s+/).filter(Boolean)
    return tokens.length
      ? inventory.filter(i => tokens.every(t => normalizeText(`${i.name} ${i.category}`).includes(t)))
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
    if (data.quantity) setQuantity(Number(data.quantity))
    if (data.orderId)   setOrderRef(data.orderId)
    if (data.address)   setAddress(data.address)
    if (data.bairro)    setBairro(data.bairro)
    if (data.rastreio)  setRastreio(data.rastreio)
    if (data.modalidade) setModalidade(data.modalidade)
    if (data.nf && !orderRef) setOrderRef(`NF: ${data.nf}`)

    // Produto
    if (data.productName) {
      setProductSearch(data.productName)
      const tokens = normalizeText(data.productName).split(/\s+/).filter(t => t.length > 1)
      let best = null, bestScore = 0
      inventory.forEach(item => {
        let score = tokens.filter(t => normalizeText(item.name).includes(t)).length
        if (score > bestScore) { bestScore = score; best = item }
      })
      if (best && bestScore > 0) setSelectedItem(best.id)
    }

    // Cliente: Tratamento de Seleção ou Cadastro Automático
    if (data.customerName) {
      const normalizedLabelName = data.customerName.trim();
      const existing = pessoas.find(p => p.name.toLowerCase() === normalizedLabelName.toLowerCase())
      
      if (existing) {
        setSelectedPessoa(existing.name)
        addToast(`✅ Cliente identificado: ${existing.name}`, 'success')
      } else {
        // Se não existe, já prepara o nome no campo para facilitar o autocadastro no submit
        setSelectedPessoa(normalizedLabelName)
        addToast(`👤 Novo cliente detectado: ${normalizedLabelName}`, 'info')
        
        // Opcional: Criar no banco imediatamente para não perder o vínculo
        const novo = { id: generateId(), name: normalizedLabelName, document: '', role: 'cliente', contact: '' }
        if (setPessoas) setPessoas(prev => [...prev, novo])
        await supabase.from('pessoas').insert([novo])
      }
    }
  }, [inventory, pessoas, setPessoas, addToast, orderRef])

  const handleOrder = useCallback(async (e) => {
    e.preventDefault()
    if (!selectedItem || !selectedPessoa || quantity <= 0 || !location) {
      addToast('Preencha todos os campos obrigatórios.', 'warning')
      return
    }

    setProcessing(true)
    try {
      const item   = inventory.find(i => i.id === selectedItem)
      let   pessoa = pessoas.find(p => p.name.toLowerCase() === selectedPessoa.toLowerCase())

      if (!item) { addToast('Produto não encontrado.', 'error'); return }
      if (Number(item.quantity) < Number(quantity)) { addToast('Estoque insuficiente!', 'error'); return }

      if (!pessoa) {
        pessoa = { id: generateId(), name: selectedPessoa.trim(), document: '', role: 'cliente', contact: '' }
        if (setPessoas) setPessoas(prev => [...prev, pessoa])
        await supabase.from('pessoas').insert([pessoa])
        addToast(`Novo cliente "${pessoa.name}" cadastrado!`, 'success')
      }

      // Geocodificação
      const geo  = await geocode(location)
      const city = geo?.city || location.split('-')[0].split(',')[0].trim()

      const packedName = packLocation(item.name, {
        city, lat: geo?.lat, lng: geo?.lng, orderId: orderRef, cep: '',
        address, bairro, rastreio, modalidade,
      })

      const newQty = Number(item.quantity) - Number(quantity)
      const tx = {
        id: generateId(), type: 'saída', itemId: item.id, itemName: packedName, city,
        quantity: Number(quantity), unitPrice: item.price,
        totalValue: item.price * Number(quantity),
        personName: pessoa.name, date: formatDate(),
      }

      const [{ error: e1 }, { error: e2 }] = await Promise.all([
        supabase.from('inventory').update({ quantity: newQty }).eq('id', item.id),
        supabase.from('transactions').insert([tx]),
      ])
      if (e1 || e2) throw new Error('Erro ao salvar no banco.')

      setInventory(prev => prev.map(i => i.id === item.id ? { ...i, quantity: newQty } : i))
      setTransactions(prev => [...prev, tx])

      addToast(`Pedido de ${quantity}x "${item.name}" registrado!`, 'success')
      setProductSearch(''); setSelectedItem(''); setSelectedPessoa('')
      setQuantity(1); setLocation(''); setAddress(''); setBairro('')
      setOrderRef(''); setRastreio(''); setModalidade('')
    } catch (err) {
      addToast(`Erro: ${err.message}`, 'error')
    } finally {
      setProcessing(false)
    }
  }, [selectedItem, selectedPessoa, quantity, location, address, bairro, orderRef, rastreio, modalidade, inventory, pessoas, setPessoas, setInventory, setTransactions, addToast])

  return (
    <div className="page">
      <div className="page-header">
        <h1>🛒 Novo Pedido</h1>
        <p>Registre vendas com baixa automática no estoque e geolocalização</p>
      </div>

      <div className="card" style={{ maxWidth: 680 }}>
        <LabelAssistant inventory={inventory} pessoas={pessoas} addToast={addToast} onDataExtracted={handleLabelData} />
        <hr className="divider" />

        <form onSubmit={handleOrder} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Produto */}
          <div className="form-group">
            <label>Produto</label>
            <input type="text" placeholder="🔍 Buscar produto..." value={productSearch} onChange={e => setProductSearch(e.target.value)} style={{ marginBottom: '0.4rem' }} />
            <select value={selectedItem} onChange={e => setSelectedItem(e.target.value)} required style={{ borderColor: productSearch ? 'var(--border-focus)' : undefined }}>
              <option value="">{filteredProducts.length ? 'Selecione o produto...' : 'Nenhum produto encontrado'}</option>
              {filteredProducts.map(i => (
                <option key={i.id} value={i.id} disabled={i.quantity <= 0}>
                  {i.name} ({i.quantity} un.) — R$ {Number(i.price).toFixed(2)}
                </option>
              ))}
            </select>
          </div>

          {/* Cliente */}
          <div className="form-group">
            <label>Cliente</label>
            <input type="text" list="pessoas-list" placeholder="Nome do cliente..." value={selectedPessoa} onChange={e => setSelectedPessoa(e.target.value)} required />
            <datalist id="pessoas-list">{pessoas.map(p => <option key={p.id} value={p.name} />)}</datalist>
          </div>

          <div className="form-row">
            <div className="form-group" style={{ maxWidth: 120 }}>
              <label>Quantidade</label>
              <input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} min="1" required />
            </div>
            <div className="form-group">
              <label>Referência / Pedido</label>
              <input type="text" placeholder="Ex: #12345 ou NF: 999" value={orderRef} onChange={e => setOrderRef(e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Destino (Cidade ou CEP) *</label>
              <input type="text" placeholder="Ex: São Paulo ou 01310-000" value={location} onChange={e => setLocation(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Endereço Completo</label>
              <input type="text" placeholder="Rua, Número, Bairro" value={address} onChange={e => setAddress(e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Bairro</label>
              <input type="text" value={bairro} onChange={e => setBairro(e.target.value)} placeholder="Ex: Centro" />
            </div>
            <div className="form-group">
              <label>Rastreio</label>
              <input type="text" value={rastreio} onChange={e => setRastreio(e.target.value)} placeholder="BR0000000000000" />
            </div>
            <div className="form-group">
              <label>Modalidade</label>
              <select value={modalidade} onChange={e => setModalidade(e.target.value)}>
                <option value="">Selecione...</option>
                {['COLETA','PAC','SEDEX','SEDEX 10','JADLOG','CORREIOS','TRANSPORTADORA','RETIRADA'].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          <button type="submit" className="btn btn-primary btn-lg btn-full" disabled={processing}>
            {processing ? '⏳ Processando...' : '🔥 Finalizar Pedido e Marcar no Mapa'}
          </button>
        </form>
      </div>

      {/* Últimas vendas */}
      <div className="mt-3">
        <h3 style={{ marginBottom: '0.75rem', fontWeight: 600 }}>Últimas Vendas</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Data</th><th>Cliente</th><th>Produto</th><th>Qtd</th><th>Total</th></tr>
            </thead>
            <tbody>
              {transactions.filter(t => t.type === 'saída').slice(-5).reverse().map((t, i) => (
                <tr key={i}>
                  <td className="text-muted text-small">{t.date.split(' ')[0]}</td>
                  <td>{t.personName}</td>
                  <td>{t.itemName?.split('||')[0]?.trim()}</td>
                  <td>{t.quantity}</td>
                  <td className="font-bold color-green">{formatCurrency(t.totalValue)}</td>
                </tr>
              ))}
              {!transactions.some(t => t.type === 'saída') && (
                <tr><td colSpan={5} className="empty-state">Nenhuma venda registrada ainda.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <OrdersMap transactions={transactions} inventory={inventory} />
    </div>
  )
}
