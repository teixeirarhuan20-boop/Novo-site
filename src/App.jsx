import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { InventoryManager } from './components/InventoryManager';
import { LeadsManager } from './components/LeadsManager';
import { OutreachManager } from './components/OutreachManager';
import { PeopleManager } from './components/PeopleManager';
import { HistoryManager } from './components/HistoryManager';
import { StockInManager } from './components/StockInManager';
import { sendMessageToGemini } from './gemini';
import { supabase } from './lib/supabase';
import './index.css';

function App() {
  const [activeTab, setActiveTab] = useState('estoque'); 
  
  const [inventory, setInventory] = useState([]);
  const [leads, setLeads] = useState([]);
  const [outreachLeads, setOutreachLeads] = useState([]);
  const [pessoas, setPessoas] = useState([]);
  const [transactions, setTransactions] = useState([]);

  // Carregar dados do Supabase ao iniciar
  useEffect(() => {
    async function fetchData() {
      // 1. Estoque
      const { data: inv } = await supabase.from('inventory').select('*');
      if (inv) setInventory(inv);

      // 2. Pessoas
      const { data: pes } = await supabase.from('pessoas').select('*');
      if (pes) setPessoas(pes);

      // 3. Transações
      const { data: tra } = await supabase.from('transactions').select('*');
      if (tra) setTransactions(tra);

      // 4. Leads (Opcional, se estiver usando)
      // const { data: lds } = await supabase.from('leads').select('*');
      // if (lds) setLeads(lds);
    }
    fetchData();
  }, []);

  // Persistência local (Opcional, mantida como backup rápido)
  useEffect(() => {
    localStorage.setItem('companyInventory', JSON.stringify(inventory));
  }, [inventory]);

  useEffect(() => {
    localStorage.setItem('companyPessoas', JSON.stringify(pessoas));
  }, [pessoas]);

  useEffect(() => {
    localStorage.setItem('companyTransactions', JSON.stringify(transactions));
  }, [transactions]);

  const [messages, setMessages] = useState([
    { role: 'bot', text: 'Olá! Sou sua vendedora. Minha irmã gêmea (A Ana) atende os contatos lá na fila terceira aba!' }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const messagesEndRef = useRef(null);

  // Bind Persistência de Dados
  useEffect(() => {
    localStorage.setItem('companyInventory', JSON.stringify(inventory));
  }, [inventory]);

  useEffect(() => {
    localStorage.setItem('companyLeads', JSON.stringify(leads));
  }, [leads]);
  
  useEffect(() => {
    localStorage.setItem('companyOutreach', JSON.stringify(outreachLeads));
  }, [outreachLeads]);

  useEffect(() => {
    localStorage.setItem('companyPessoas', JSON.stringify(pessoas));
  }, [pessoas]);

  useEffect(() => {
    localStorage.setItem('companyTransactions', JSON.stringify(transactions));
  }, [transactions]);

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

    const botResponse = await sendMessageToGemini(messages, text, inventory, (novosDados) => {
       const leadRecemCriado = {
         id: Date.now().toString() + Math.random().toString(),
         nome: novosDados.nome || '',
         email: novosDados.email || '',
         telefone: novosDados.telefone || '',
         site: novosDados.site || '',
         data: new Date().toLocaleDateString() + ' às ' + new Date().toLocaleTimeString()
       };
       setLeads(prev => [...prev, leadRecemCriado]);
    });

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
    <div className="dashboard-layout">
      <div className="sidebar">
        <h2>Meu Negócio CRM</h2>
        <button className={`nav-item ${activeTab === 'estoque' ? 'active' : ''}`} onClick={() => setActiveTab('estoque')}>📦 Seu Estoque</button>
        <button className={`nav-item ${activeTab === 'entrada' ? 'active' : ''}`} onClick={() => setActiveTab('entrada')}>🔁 Entradas / Saídas</button>
        <button className={`nav-item ${activeTab === 'historico' ? 'active' : ''}`} onClick={() => setActiveTab('historico')}>📜 Histórico</button>
        <button className={`nav-item ${activeTab === 'pessoas' ? 'active' : ''}`} onClick={() => setActiveTab('pessoas')}>👥 Pessoas</button>
        {/* <button className={`nav-item ${activeTab === 'leads' ? 'active' : ''}`} onClick={() => setActiveTab('leads')}>👥 CRM Leads</button> */}
        {/* <button className={`nav-item ${activeTab === 'abordagem' ? 'active' : ''}`} onClick={() => setActiveTab('abordagem')}>💌 Abordagem (Ana)</button> */}
      </div>

      <div className="main-content">
         
         {activeTab === 'estoque' && <InventoryManager inventory={inventory} setInventory={setInventory} transactions={transactions} />}

         {activeTab === 'entrada' && <StockInManager inventory={inventory} setInventory={setInventory} pessoas={pessoas} transactions={transactions} setTransactions={setTransactions} />}
         
         {activeTab === 'historico' && <HistoryManager transactions={transactions} />}
         
         {activeTab === 'pessoas' && <PeopleManager pessoas={pessoas} setPessoas={setPessoas} />}

         {/* activeTab === 'leads' && (
           <div className="inventory-panel"> 
             <LeadsManager leads={leads} setLeads={setLeads} sendToAna={handleSendToAna} />
           </div>
         ) */}
         
         {/* activeTab === 'abordagem' && (
           <div className="inventory-panel"> 
             <OutreachManager outreachLeads={outreachLeads} setOutreachLeads={setOutreachLeads} inventory={inventory} />
           </div>
         ) */}
         
         {/* !isChatOpen && (
           <button className="floating-chat-btn" onClick={() => setIsChatOpen(true)}>
             💬 Falar com a Vendedora
           </button>
         ) */}
      </div>

      {/* isChatOpen && (
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
      ) */}
    </div>
  );
}

export default App;
