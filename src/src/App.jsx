import React, { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './lib/supabase'
import { sendMessageToGemini } from './lib/gemini'
import { generateId, formatDate } from './utils/formatting'
import { geocode, packLocation } from './utils/location'
import { useToast } from './hooks/useToast'

import { ConfigError }       from './components/ConfigError'
import { Sidebar }           from './components/Sidebar'
import { ToastContainer }    from './components/ToastContainer'
import { ChatMessage }       from './components/ChatMessage'
import { ChatInput }         from './components/ChatInput'
import { Dashboard }         from './components/Dashboard'
import { InventoryManager }  from './components/InventoryManager'
import { OrdersManager }     from './components/OrdersManager'
import { StockInManager }    from './components/StockInManager'
import { PeopleManager }     from './components/PeopleManager'
import { HistoryManager }    from './components/HistoryManager'
import { SalesMap }          from './components/SalesMap'
import { SystemLogManager }  from './components/SystemLogManager'
import { LeadsManager }      from './components/LeadsManager'
import { OutreachManager }   from './components/OutreachManager'
import './index.css'

// ─── Verificação de configuração ────────────────────────────────────────────
const isConfigured =
  Boolean(import.meta.env.VITE_SUPABASE_URL) &&
  Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY) &&
  Boolean(import.meta.env.VITE_GEMINI_API_KEY)

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const { toasts, addToast, removeToast } = useToast()

  // ── Estado global ──────────────────────────────────────────────────────────
  const [inventory,     setInventory]     = useState([])
  const [transactions,  setTransactions]  = useState([])
  const [pessoas,       setPessoas]       = useState([])
  const [leads,         setLeads]         = useState([])
  const [outreachLeads, setOutreachLeads] = useState([])

  // ── Chat ───────────────────────────────────────────────────────────────────
  const [messages,    setMessages]    = useState([
    { role: 'bot', text: 'Olá! Sou a **Luna**, sua vendedora virtual. Como posso te ajudar hoje?' }
  ])
  const [chatOpen,    setChatOpen]    = useState(false)
  const [chatLoading, setChatLoading] = useState(false)
  const messagesEndRef = useRef(null)

  // ── Carregar dados do Supabase ─────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) return

    const loadData = async () => {
      try {
        const [inv, pes, tra] = await Promise.all([
          supabase.from('inventory').select('*'),
          supabase.from('pessoas').select('*'),
          supabase.from('transactions').select('*'),
        ])
        if (inv.error) throw inv.error
        if (pes.error) throw pes.error
        if (tra.error) throw tra.error
        if (inv.data) setInventory(inv.data)
        if (pes.data) setPessoas(pes.data)
        if (tra.data) setTransactions(tra.data)
      } catch (err) {
        console.error('Erro ao carregar dados:', err)
        addToast('Erro ao carregar dados do servidor.', 'error')
      }
    }

    loadData()

    // Realtime
    const channel = supabase.channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, ({ eventType, new: n, old: o }) => {
        if (eventType === 'INSERT') setInventory(prev => prev.find(i => i.id === n.id) ? prev : [...prev, n])
        if (eventType === 'UPDATE') setInventory(prev => prev.map(i => i.id === n.id ? n : i))
        if (eventType === 'DELETE') setInventory(prev => prev.filter(i => i.id !== o.id))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pessoas' }, ({ eventType, new: n, old: o }) => {
        if (eventType === 'INSERT') setPessoas(prev => prev.find(p => p.id === n.id) ? prev : [...prev, n])
        if (eventType === 'UPDATE') setPessoas(prev => prev.map(p => p.id === n.id ? n : p))
        if (eventType === 'DELETE') setPessoas(prev => prev.filter(p => p.id !== o.id))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions' }, ({ new: n }) => {
        setTransactions(prev => prev.find(t => t.id === n.id) ? prev : [...prev, n])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  // ── Scroll chat ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (chatOpen) setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [messages, chatOpen])

  // ── Envio de mensagem para IA ──────────────────────────────────────────────
  const handleSendMessage = useCallback(async (text) => {
    const history = [...messages]
    setMessages(prev => [...prev, { role: 'user', text }, { role: 'bot', text: '...' }])
    setChatLoading(true)

    const onLeadCaptured = (data) => {
      const lead = {
        id: generateId(),
        nome: data.customerName || '',
        email: data.email || '',
        telefone: data.telefone || '',
        data: formatDate(),
      }
      setLeads(prev => [...prev, lead])
      addToast(`Novo lead: ${lead.nome}`, 'success')
    }

    const onOrderPlaced = async (orderData) => {
      try {
        const item = inventory.find(i =>
          (i.name || '').toLowerCase() === (orderData.productName || '').toLowerCase()
        )
        if (!item) { addToast(`Produto "${orderData.productName}" não encontrado.`, 'error'); return }
        if (Number(item.quantity) < Number(orderData.quantity)) {
          addToast('Estoque insuficiente!', 'error'); return
        }

        let pessoa = pessoas.find(p => p.name.toLowerCase() === (orderData.customerName || '').toLowerCase())
        if (!pessoa) {
          pessoa = { id: generateId(), name: orderData.customerName.trim(), document: '', role: 'cliente', contact: orderData.telefone || '' }
          setPessoas(prev => [...prev, pessoa])
          await supabase.from('pessoas').insert([pessoa])
          addToast(`Cliente "${pessoa.name}" cadastrado automaticamente!`, 'success')
        }

        const geo  = orderData.location ? await geocode(orderData.location) : null
        const city = geo?.city || (orderData.location || 'Desconhecido').split(',')[0].trim()

        const packedName = packLocation(item.name, {
          city, lat: geo?.lat, lng: geo?.lng,
          orderId: orderData.orderId, nf: orderData.nf,
          cep: orderData.cep, address: orderData.address,
          bairro: orderData.bairro, rastreio: orderData.rastreio,
          modalidade: orderData.modalidade,
        })

        const newQty = Number(item.quantity) - Number(orderData.quantity)
        const tx = {
          id: generateId(), type: 'saída', itemId: item.id, itemName: packedName, city,
          quantity: Number(orderData.quantity), unitPrice: item.price,
          totalValue: item.price * Number(orderData.quantity),
          personName: pessoa.name, date: formatDate(),
        }

        await Promise.all([
          supabase.from('inventory').update({ quantity: newQty }).eq('id', item.id),
          supabase.from('transactions').insert([tx]),
        ])
        setInventory(prev => prev.map(i => i.id === item.id ? { ...i, quantity: newQty } : i))
        setTransactions(prev => [...prev, tx])
        addToast(`Pedido de ${orderData.quantity}x "${item.name}" registrado!`, 'success')
      } catch (err) {
        addToast(`Erro no pedido via IA: ${err.message}`, 'error')
      }
    }

    const response = await sendMessageToGemini(history, text, inventory, onLeadCaptured, onOrderPlaced)
    setMessages(prev => [...prev.slice(0, -1), { role: 'bot', text: response }])
    setChatLoading(false)
  }, [messages, inventory, pessoas, addToast])

  const handleSendToAna = useCallback((lead) => {
    if (!outreachLeads.find(l => l.id === lead.id)) {
      setOutreachLeads(prev => [...prev, lead])
    }
    setActiveTab('abordagem')
  }, [outreachLeads])

  // ── Proteção de configuração ───────────────────────────────────────────────
  if (!isConfigured) return <ConfigError />

  // ── Render de abas ─────────────────────────────────────────────────────────
  const renderTab = () => {
    const props = { inventory, setInventory, transactions, setTransactions, pessoas, setPessoas, addToast }
    switch (activeTab) {
      case 'dashboard': return <Dashboard inventory={inventory} transactions={transactions} />
      case 'mapa':      return <SalesMap  inventory={inventory} transactions={transactions} isActive={activeTab === 'mapa'} />
      case 'pedidos':   return <OrdersManager {...props} isActive={activeTab === 'pedidos'} />
      case 'entrada':   return <StockInManager {...props} />
      case 'estoque':   return <InventoryManager {...props} />
      case 'pessoas':   return <PeopleManager {...props} />
      case 'historico': return <HistoryManager {...props} />
      case 'logs':      return <SystemLogManager />
      case 'leads':     return <LeadsManager leads={leads} setLeads={setLeads} onSendToAna={handleSendToAna} addToast={addToast} />
      case 'abordagem': return <OutreachManager outreachLeads={outreachLeads} setOutreachLeads={setOutreachLeads} inventory={inventory} addToast={addToast} />
      default:          return <Dashboard inventory={inventory} transactions={transactions} />
    }
  }

  return (
    <div className="app-layout">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="main-content">
        {renderTab()}
      </main>

      {/* Chat flutuante */}
      {!chatOpen && (
        <button className="chat-fab" onClick={() => setChatOpen(true)}>
          💬 Luna
        </button>
      )}

      {chatOpen && (
        <div className="chat-panel">
          <div className="chat-header">
            <div className="chat-header-info">
              <div className="chat-avatar">IA</div>
              Luna — Vendedora Virtual
            </div>
            <button className="chat-close" onClick={() => setChatOpen(false)}>✕</button>
          </div>
          <div className="chat-messages">
            {messages.map((m, i) => <ChatMessage key={i} role={m.role} text={m.text} />)}
            <div ref={messagesEndRef} />
          </div>
          <ChatInput onSend={handleSendMessage} disabled={chatLoading} />
        </div>
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  )
}
