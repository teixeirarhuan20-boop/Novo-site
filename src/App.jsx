import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { InventoryManager } from './components/InventoryManager';
import { Dashboard } from './components/Dashboard';
import { LeadsManager } from './components/LeadsManager';
import { OutreachManager } from './components/OutreachManager';
import { PeopleManager } from './components/PeopleManager';
import { HistoryManager } from './components/HistoryManager';
import { StockInManager } from './components/StockInManager';
import { OrdersManager } from './components/OrdersManager';
import { SalesMap } from './components/SalesMap';
import { SystemLogManager } from './components/SystemLogManager';
import { sendMessageToGemini } from './gemini';
import { supabase } from './lib/supabase';
import './index.css';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard'); 
  const [uiMode, setUiMode] = useState('pro'); // 'pro' ou 'classic'
  
  const [inventory, setInventory] = useState([]);
  const [leads, setLeads] = useState([]);
  const [outreachLeads, setOutreachLeads] = useState([]);
  const [pessoas, setPessoas] = useState([]);
  const [transactions, setTransactions] = useState([]);

  // --- TOAST SYSTEM ---
  const [toasts, setToasts] = useState([]);
  
  const addToast = (message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000); // Some após 5 segundos
  };

  // Carregar dados do Supabase ao iniciar e configurar Realtime
  useEffect(() => {
    async function fetchData() {
      console.log('--- INICIANDO CONEXÃO ---');
      try {
        // 0. Verifica se a coluna 'color' existe no inventário
        const { error: colorCheckError } = await supabase.from('inventory').select('color').limit(1);
        if (colorCheckError && colorCheckError.message.includes('color')) {
          // Coluna não existe — exibe alerta com SQL para o usuário adicionar
          console.warn('Coluna color não existe no inventory. Adicione via SQL Editor do Supabase.');
          addToast(
            '⚠️ Execute no Supabase SQL Editor: ALTER TABLE inventory ADD COLUMN color text DEFAULT \'#2563eb\';',
            'error'
          );
        }

        // 0.1 Verifica se a coluna 'city' existe nas transações
        const { error: cityCheckError } = await supabase.from('transactions').select('city').limit(1);
        if (cityCheckError && cityCheckError.message.includes('city')) {
          console.warn('Coluna city não existe no transactions. Adicione via SQL Editor.');
          addToast(
            '⚠️ Execute no Supabase SQL Editor: ALTER TABLE transactions ADD COLUMN city text;',
            'error'
          );
        }

        // 1. Estoque — cor agora vem direto do Supabase
        const { data: inv, error: invErr } = await supabase.from('inventory').select('*');
        if (invErr) throw invErr;
        if (inv) setInventory(inv);

        // 2. Pessoas
        const { data: pes, error: pesErr } = await supabase.from('pessoas').select('*');
        if (pesErr) throw pesErr;
        if (pes) setPessoas(pes);

        // 3. Transações
        const { data: tra, error: traErr } = await supabase.from('transactions').select('*');
        if (traErr) throw traErr;
        if (tra) setTransactions(tra);

        console.log('--- DADOS CARREGADOS COM SUCESSO ---');
      } catch (err) {
        console.error('ERRO AO CARREGAR DADOS:', err);
        addToast('Erro ao carregar dados do servidor. Verifique sua conexão.', 'error');
      }

      // --- CONFIGURAÇÃO DO REALTIME ---
      const channel = supabase
        .channel('db-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, (payload) => {
          if (payload.eventType === 'INSERT') {
            setInventory(prev => prev.find(i => i.id === payload.new.id) ? prev : [...prev, payload.new]);
          } else if (payload.eventType === 'UPDATE') {
            setInventory(prev => prev.map(item => item.id === payload.new.id ? payload.new : item));
          } else if (payload.eventType === 'DELETE') {
            setInventory(prev => prev.filter(item => item.id !== payload.old.id));
          }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pessoas' }, (payload) => {
          if (payload.eventType === 'INSERT') {
            setPessoas(prev => prev.find(p => p.id === payload.new.id) ? prev : [...prev, payload.new]);
          } else if (payload.eventType === 'UPDATE') {
            setPessoas(prev => prev.map(p => p.id === payload.new.id ? payload.new : p));
          } else if (payload.eventType === 'DELETE') {
            setPessoas(prev => prev.filter(p => p.id !== payload.old.id));
          }
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions' }, (payload) => {
          setTransactions(prev => prev.find(t => t.id === payload.new.id) ? prev : [...prev, payload.new]);
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
    fetchData();
  }, []);

  const [messages, setMessages] = useState([
    { role: 'bot', text: 'Olá! Sou sua vendedora. Minha irmã gêmea (A Ana) atende os contatos lá na fila terceira aba!' }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);
  
  useEffect(() => {
    if(isChatOpen) {
        scrollToBottom();
    }
  }, [isChatOpen]);

  const handleSendMessage = async (text) => {
    const newMessages = [...messages, { role: 'user', text }];
    setMessages([...newMessages, { role: 'bot', text: '...' }]);
    setIsLoading(true);

    const botResponse = await sendMessageToGemini(
      messages,
      text,
      inventory,
      (novosDados) => { // onLeadCaptured
        const leadRecemCriado = {
          id: Date.now().toString() + Math.random().toString(),
          nome: novosDados.customerName || '',
          email: novosDados.email || '',
          telefone: novosDados.telefone || '',
          site: novosDados.site || '', // Assuming 'site' might come from somewhere else or be null
          data: new Date().toLocaleDateString() + ' às ' + new Date().toLocaleTimeString()
        };
        setLeads(prev => [...prev, leadRecemCriado]);
        addToast(`Novo lead capturado: ${leadRecemCriado.nome}`, 'success');
      },
      async (orderData) => { // onOrderPlaced
        try {
          const item = inventory.find(i => (i.name || '').toLowerCase() === (orderData.productName || '').toLowerCase());
          if (!item) {
            addToast(`Produto "${orderData.productName}" não encontrado no estoque.`, 'error');
            return;
          }

          if (item.quantity < orderData.quantity) {
            addToast(`Estoque insuficiente para "${item.productName}". Disponível: ${item.quantity}`, 'error');
            return;
          }

          let pessoa = pessoas.find(p => p.name.toLowerCase() === orderData.customerName.toLowerCase());
          if (!pessoa) {
            // Auto-cadastro de cliente
            pessoa = {
              id: Date.now().toString() + Math.random().toString(),
              name: orderData.customerName.trim(),
              document: '',
              role: 'cliente',
              contact: orderData.telefone || orderData.email || ''
            };
            setPessoas(prev => [...prev, pessoa]);
            await supabase.from('pessoas').insert([pessoa]);
            addToast(`Novo cliente cadastrado automaticamente: ${pessoa.name}`, "success");
          }

          // Geocodificação (simplificada para o exemplo, idealmente usaria a mesma lógica do OrdersManager)
          let lat = null, lng = null;
          if (orderData.location) {
            try {
              const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(orderData.location)}&countrycodes=br&limit=1`);
              const data = await response.json();
              if (data && data.length > 0) {
                lat = data[0].lat;
                lng = data[0].lon;
              }
            } catch (err) {
              console.error('Erro na geocodificação via IA:', err);
            }
          }

          const packedItemName = `${item.name} ||${orderData.location || 'Desconhecido'};${lat};${lng};${orderData.orderId || ''};${orderData.nf || ''};${orderData.cep || ''};${orderData.address || ''};${orderData.bairro || ''};${orderData.rastreio || ''};${orderData.modalidade || ''}||`;
          const newQuantity = Number(item.quantity) - Number(orderData.quantity);

          const newTransaction = {
            id: Date.now().toString() + Math.random().toString(),
            type: 'saída',
            itemId: item.id,
            itemName: packedItemName,
            city: orderData.location ? orderData.location.split(',')[0].trim() : 'Desconhecido',
            quantity: orderData.quantity,
            unitPrice: item.price,
            totalValue: item.price * orderData.quantity,
            personName: pessoa.name,
            date: new Date().toLocaleDateString() + ' às ' + new Date().toLocaleTimeString()
          };

          await supabase.from('inventory').update({ quantity: newQuantity }).eq('id', item.id);
          await supabase.from('transactions').insert([newTransaction]);

          setInventory(prev => prev.map(i => i.id === item.id ? { ...i, quantity: newQuantity } : i));
          setTransactions(prev => [...prev, newTransaction]);
          addToast(`Pedido de ${orderData.quantity}x ${item.name} para ${pessoa.name} registrado!`, 'success');
        } catch (error) {
          console.error('Erro ao processar pedido via IA:', error);
          addToast(`Erro ao registrar pedido via IA: ${error.message}`, 'error');
        }
      }
    );

    setMessages([...newMessages, { role: 'bot', text: botResponse }]);
    setIsLoading(false);
  };
  
  // Função Mágica que clona o lead pra aba Ana
  const handleSendToAna = (lead) => {
     if(!outreachLeads.find(l => l.id === lead.id)) {
        setOutreachLeads(prev => [...prev, lead]);
     }
     setActiveTab('abordagem'); 
  };

  return (
    <div className={`dashboard-layout ui-mode-${uiMode}`}>
      <div className="sidebar">
        <h2 className="sidebar-logo">MEU NEGÓCIO <span style={{ color: '#3b82f6' }}>PRO</span></h2>
        
        <div className="sidebar-section">ANÁLISE</div>
        <button className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>📊 Dashboard</button>
        <button className={`nav-item ${activeTab === 'mapa' ? 'active' : ''}`} onClick={() => setActiveTab('mapa')}>🗺️ Mapa do Brasil</button>
        
        <div style={{ padding: '0 1rem', fontSize: '0.7rem', color: '#64748b', marginTop: '1.5rem', fontWeight: 'bold' }}>OPERAÇÃO</div>
        <button className={`nav-item ${activeTab === 'pedidos' ? 'active' : ''}`} onClick={() => setActiveTab('pedidos')}>🛒 Pedidos</button>
        <button className={`nav-item ${activeTab === 'entrada' ? 'active' : ''}`} onClick={() => setActiveTab('entrada')}>🔁 Movimentações</button>
        
        <div style={{ padding: '0 1rem', fontSize: '0.7rem', color: '#64748b', marginTop: '1.5rem', fontWeight: 'bold' }}>GESTÃO</div>
        <button className={`nav-item ${activeTab === 'estoque' ? 'active' : ''}`} onClick={() => setActiveTab('estoque')}>📦 Seu Estoque</button>
        <button className={`nav-item ${activeTab === 'pessoas' ? 'active' : ''}`} onClick={() => setActiveTab('pessoas')}>👥 Pessoas</button>
        <button className={`nav-item ${activeTab === 'historico' ? 'active' : ''}`} onClick={() => setActiveTab('historico')}>📜 Histórico</button>

        <div style={{ padding: '0 1rem', fontSize: '0.7rem', color: '#64748b', marginTop: '1.5rem', fontWeight: 'bold' }}>SISTEMA</div>
        <button className={`nav-item ${activeTab === 'logs' ? 'active' : ''}`} onClick={() => setActiveTab('logs')}>🚨 Log de Erros</button>

        <div className="sidebar-footer" style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
          <button 
            className="ui-toggle-btn" 
            onClick={() => setUiMode(uiMode === 'pro' ? 'classic' : 'pro')}
          >
            {uiMode === 'pro' ? '✨ Mudar p/ Clássico' : '🚀 Ativar Modo Pro'}
          </button>
        </div>
      </div>

      <div className="main-content">
         <div style={{ display: activeTab === 'dashboard' ? 'block' : 'none', height: '100%' }}>
            <Dashboard inventory={inventory} transactions={transactions} />
         </div>
         
         <div style={{ display: activeTab === 'mapa' ? 'block' : 'none', height: '100%' }}>
            <SalesMap transactions={transactions} inventory={inventory} isActive={activeTab === 'mapa'} />
         </div>

         <div style={{ display: activeTab === 'pedidos' ? 'block' : 'none', height: '100%' }}>
            <OrdersManager inventory={inventory} setInventory={setInventory} pessoas={pessoas} setPessoas={setPessoas} transactions={transactions} setTransactions={setTransactions} addToast={addToast} isActive={activeTab === 'pedidos'} />
         </div>

         <div style={{ display: activeTab === 'estoque' ? 'block' : 'none', height: '100%' }}>
            <InventoryManager inventory={inventory} setInventory={setInventory} transactions={transactions} setTransactions={setTransactions} />
         </div>

         <div style={{ display: activeTab === 'entrada' ? 'block' : 'none', height: '100%' }}>
            <StockInManager inventory={inventory} setInventory={setInventory} pessoas={pessoas} transactions={transactions} setTransactions={setTransactions} />
         </div>
         
         <div style={{ display: activeTab === 'historico' ? 'block' : 'none', height: '100%' }}>
            <HistoryManager transactions={transactions} setTransactions={setTransactions} inventory={inventory} setInventory={setInventory} />
         </div>
         
         <div style={{ display: activeTab === 'pessoas' ? 'block' : 'none', height: '100%' }}>
            <PeopleManager pessoas={pessoas} setPessoas={setPessoas} transactions={transactions} />
         </div>
         
         <div style={{ display: activeTab === 'logs' ? 'block' : 'none', height: '100%' }}>
            <SystemLogManager />
         </div>

         {activeTab === 'leads' && (
           <div className="inventory-panel"> 
             <LeadsManager leads={leads} setLeads={setLeads} sendToAna={handleSendToAna} />
           </div>
         )}
         
         {activeTab === 'abordagem' && (
           <div className="inventory-panel"> 
             <OutreachManager outreachLeads={outreachLeads} setOutreachLeads={setOutreachLeads} inventory={inventory} />
           </div>
         )}
         
         {!isChatOpen && (
           <button className="floating-chat-btn" onClick={() => setIsChatOpen(true)}>
             💬 Falar com a Vendedora
           </button>
         )}
      </div>

      {isChatOpen && (
        <div className="ai-panel">
          <div className="chat-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
               <div className="avatar bot">IA</div>
               Vendedora Virtual
            </div>
            <button className="close-chat-btn" onClick={() => setIsChatOpen(false)} title="Minimizar">✕</button>
          </div>
          <div className="chat-container">
            {messages.map((msg, index) => (
              <ChatMessage key={index} text={msg.text} role={msg.role} />
            ))}
            <div ref={messagesEndRef} />
          </div>
          <ChatInput onSendMessage={handleSendMessage} disabled={isLoading} />
        </div>
      )}

      {/* TOAST RENDERER */}
      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast ${toast.type}`}>
            {toast.type === 'success' && '✅'}
            {toast.type === 'error' && '❌'}
            {toast.type === 'warning' && '⚠️'}
            {toast.type === 'info' && 'ℹ️'}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;