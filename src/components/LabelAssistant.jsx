import React, { useState, useEffect } from 'react';
import { analyzeOrderDocument, analyzeOrderText } from '../gemini';

export function LabelAssistant({ inventory, pessoas, onDataExtracted, addToast }) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [extractedData, setExtractedData] = useState(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    let timer;
    if (cooldown > 0) {
      timer = setInterval(() => {
        setCooldown(prev => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (cooldown > 0) return; // Bloqueia soltar imagens se estiver em espera
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const processFile = (file) => {
    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target.result;
      try {
        const data = await analyzeOrderDocument(base64, inventory || [], pessoas || []);
        if (data) setExtractedData(data);
        else if(addToast) addToast("A IA não conseguiu extrair os dados da imagem.", "error");
      } catch (error) {
        if (error.message.includes("Limite de leituras") || error.message.includes("429")) {
          setCooldown(60);
          if (addToast) addToast("Muitas leituras! Aguarde o tempo do contador na tela.", "warning");
        } else {
          if(addToast) addToast("Erro na leitura visual: " + error.message, "error");
        }
      } finally {
        setIsProcessing(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleTextAnalyze = async () => {
    if (!pastedText.trim()) return;
    setIsProcessing(true);
    try {
      const data = await analyzeOrderText(pastedText, cooldown > 0);
      if (data) {
         setExtractedData(data);
      } else {
         if(addToast) addToast("A IA não encontrou dados válidos nesse texto.", "warning");
      }
    } catch (error) {
      if (error.message.includes("Limite de leituras") || error.message.includes("429")) {
        setCooldown(60);
        if (addToast) addToast("Muitas leituras! Aguarde o tempo do contador na tela.", "warning");
      } else {
        if(addToast) addToast("Erro na leitura de texto: " + error.message, "error");
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div style={{ marginBottom: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem', background: 'var(--panel-bg)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
      <div style={{ display: 'flex', gap: '1rem', width: '100%' }}>
        {/* 1. ZONA DE IMAGENS E PDF */}
        <div 
          className={`bi-drop-zone ${isDragging ? 'dragging' : ''}`}
          onDragOver={(e) => { e.preventDefault(); if (cooldown === 0) setIsDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
          onDrop={handleDrop}
          style={{ flex: 1, position: 'relative', margin: 0, padding: '1.5rem', background: cooldown > 0 ? 'rgba(239, 68, 68, 0.05)' : 'rgba(59, 130, 246, 0.05)', border: `2px dashed ${cooldown > 0 ? '#ef4444' : '#3b82f6'}`, borderRadius: '8px', opacity: cooldown > 0 ? 0.7 : 1 }}
        >
          <input type="file" accept="image/*,application/pdf" onChange={(e) => e.target.files[0] && processFile(e.target.files[0])} style={{ display: 'none' }} id="label-upload" disabled={cooldown > 0} />
          <label htmlFor="label-upload" style={{ cursor: cooldown > 0 ? 'not-allowed' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', margin: 0 }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{cooldown > 0 ? '⏳' : '📸'}</div>
            <p style={{ fontSize: '0.9rem', margin: 0, color: cooldown > 0 ? '#ef4444' : '#3b82f6', fontWeight: '600' }}>{cooldown > 0 ? `Aguarde ${cooldown}s...` : 'Arrastar Imagem/PDF'}</p>
          </label>
          {isProcessing && <div className="ai-processing-overlay" style={{ borderRadius: '8px' }}><div className="ai-pulse"></div></div>}
        </div>

        {/* 2. ZONA DE TEXTO COPIADO (SHOPEE / ML) */}
        <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
           <textarea 
             value={pastedText}
             onChange={(e) => setPastedText(e.target.value)}
             placeholder="...ou cole o texto da etiqueta de envio aqui (Ex: Dados da Shopee ou Mercado Livre)"
             className="inline-input"
             style={{ flex: 1, resize: 'none', backgroundColor: 'var(--input-bg)' }}
           />
           <button onClick={handleTextAnalyze} disabled={isProcessing || !pastedText.trim()} className="save-btn" style={{ width: '100%', padding: '0.6rem', backgroundColor: cooldown > 0 ? '#10a37f' : undefined, borderColor: cooldown > 0 ? '#10a37f' : undefined, cursor: 'pointer' }}>
              {isProcessing ? 'Filtrando...' : cooldown > 0 ? `⚡ Filtrar Offline (Instantâneo)` : '🤖 Filtrar Dados da Etiqueta'}
           </button>
        </div>
      </div>

      {/* 3. ZONA DE PREVIEW E COLAR RÁPIDO */}
      {extractedData && (
        <div style={{ marginTop: '0.5rem', padding: '1.5rem', background: 'rgba(16, 163, 127, 0.05)', border: '1px solid rgba(16, 163, 127, 0.3)', borderRadius: '8px', width: '100%' }}>
          <h4 style={{ margin: '0 0 1rem 0', color: '#10a37f', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>✅</span> Dados Encontrados. Revise antes de colar:
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', fontSize: '0.9rem', marginBottom: '1.5rem', color: 'var(--text-color)' }}>
            <div><strong style={{ color: 'var(--text-muted)' }}>Cliente:</strong><br/>{extractedData.customerName || '-'}</div>
            <div><strong style={{ color: 'var(--text-muted)' }}>Destino:</strong><br/>{extractedData.location || '-'}</div>
            <div><strong style={{ color: 'var(--text-muted)' }}>CEP:</strong><br/>{extractedData.cep || '-'}</div>
            <div><strong style={{ color: 'var(--text-muted)' }}>Pedido (Ref):</strong><br/>{extractedData.orderId || '-'}</div>
            <div><strong style={{ color: 'var(--text-muted)' }}>NF:</strong><br/>{extractedData.nf || '-'}</div>
            <div style={{ gridColumn: '1 / -1' }}><strong style={{ color: 'var(--text-muted)' }}>Endereço Completo:</strong><br/>{extractedData.address || '-'}</div>
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
             <button onClick={() => { onDataExtracted(extractedData); setExtractedData(null); setPastedText(''); }} className="save-btn" style={{ flex: 1, padding: '0.8rem', fontSize: '1rem', fontWeight: 'bold' }}>
               ⚡ Colar Rápido no Formulário
             </button>
             <button onClick={() => setExtractedData(null)} className="cancel-btn" style={{ padding: '0.8rem 1.5rem' }}>
               Descartar
             </button>
          </div>
        </div>
      )}
    </div>
  );
}