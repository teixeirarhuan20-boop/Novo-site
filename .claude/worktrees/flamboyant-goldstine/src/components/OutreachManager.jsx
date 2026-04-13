import React, { useState } from 'react';
import { generateAnaMessage } from '../gemini';

export function OutreachManager({ outreachLeads, setOutreachLeads, inventory }) {
  const [messages, setMessages] = useState({});
  const [loadingId, setLoadingId] = useState(null);

  const removeLead = (id) => {
    if (window.confirm("Remover da Fila de Abordagem? (Isso não vai deletá-lo do banco de Leads original)")) {
      setOutreachLeads(prev => prev.filter(l => l.id !== id));
    }
  };

  const handleGenerate = async (lead) => {
    setLoadingId(lead.id);
    const textoCriadoPelaAna = await generateAnaMessage(lead, inventory);
    setMessages(prev => ({ ...prev, [lead.id]: textoCriadoPelaAna }));
    setLoadingId(null);
  };

  const handleChange = (id, newText) => {
    setMessages(prev => ({ ...prev, [id]: newText }));
  };

  const sendWhatsApp = (lead) => {
    let rawText = messages[lead.id];
    if (!rawText) {
       alert("Você precisa pedir pra Ana Gerar o Rascunho antes de enviar pro Zap!");
       return;
    }

    let tel = lead.telefone || '';
    // Mantenha apenas os números para limpar o formato que veio do Google
    tel = tel.replace(/\D/g, ''); 
    
    // Se não tiver DDD nacional, normalmente para API da wa.me em formato BR assume-se +55
    if (tel.length >= 10 && tel.length <= 11 && !tel.startsWith('55')) {
       tel = '55' + tel;
    }
    
    const uriText = encodeURIComponent(rawText);
    
    // Fallback: Se o telefone for muito curto ou sem sentido, abre a janela genérica do WhatsApp pro vendedor escolher o contato manual
    const link = tel.length > 8 ? `https://wa.me/${tel}?text=${uriText}` : `https://api.whatsapp.com/send?text=${uriText}`;
    
    window.open(link, '_blank');
  };

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: 0 }}>💌 Fila de Abordagem (Ana)</h1>
        <p style={{ color: '#8e8e8e', marginTop: '0.5rem' }}>
           Envie leads para cá, deixe a inteligência redigir o argumento e dispare as vendas de forma automatizada pelo seu WhatsApp Web.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '1.5rem' }}>
        {outreachLeads.length === 0 ? (
           <p style={{ color: '#666', gridColumn: '1 / -1' }}>Nenhum lead aguardando contato na sua mesa. Vá até a tela "CRM Leads" e aperte em "Enviar p/ Ana".</p>
        ) : (
           outreachLeads.map(lead => (
             <div key={lead.id} className="lead-card" style={{ background: '#1c1c1c', border: '1px solid #333', padding: '1.5rem', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                
                {/* Linha de titulo do cartao e infos básicas */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3 style={{ margin: 0, color: '#10a37f' }}>{lead.nome}</h3>
                    <div style={{ fontSize: '0.85rem', color: '#888', marginTop: '0.3rem' }}>
                       {lead.telefone ? `📞 ${lead.telefone}` : ''} {lead.site ? ` | 🌐 ${lead.site}` : ''}
                    </div>
                  </div>
                  <button onClick={() => removeLead(lead.id)} className="close-chat-btn" title="Descartar da Fila">✕</button>
                </div>

                {/* Área dinâmica. Se já clicou em gerar, mostra a text area */}
                {messages[lead.id] !== undefined ? (
                   <textarea 
                     value={messages[lead.id]} 
                     onChange={(e) => handleChange(lead.id, e.target.value)}
                     rows={7}
                     className="inline-input"
                     style={{ resize: 'vertical', fontSize: '0.95rem', lineHeight: '1.4' }}
                   />
                ) : (
                  <div style={{ padding: '2rem 0', textAlign: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                     Cérebro da Ana aguardando ordem...
                  </div>
                )}

                {/* Botões de Ação na Base do Card */}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto' }}>
                  
                  {messages[lead.id] === undefined ? (
                    <button onClick={() => handleGenerate(lead)} disabled={loadingId === lead.id} className="edit-btn" style={{ flex: 1, height: '40px' }}>
                       {loadingId === lead.id ? '🧠 Ana está digitando...' : '✨ Gerar Rascunho com Ana'}
                    </button>
                  ) : (
                    <button onClick={() => handleGenerate(lead)} disabled={loadingId === lead.id} className="cancel-btn" style={{ flex: 1, background: '#333' }}>
                       {loadingId === lead.id ? 'Refazendo...' : '♻️ Refazer'}
                    </button>
                  )}

                  <button onClick={() => sendWhatsApp(lead)} className="whatsapp-btn" style={{ flex: 1, display: messages[lead.id] ? 'block' : 'none' }}>
                     🟢 Disparar WA
                  </button>
                  
                </div>

             </div>
           ))
        )}
      </div>
    </div>
  );
}
