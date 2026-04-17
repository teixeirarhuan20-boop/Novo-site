import React, { useState, useEffect, useRef } from 'react';
import { analyzeOrderDocument, analyzeOrderText } from '../gemini';
import Tesseract from 'tesseract.js';

export function LabelAssistant({ inventory, pessoas, onDataExtracted, addToast }) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [extractedData, setExtractedData] = useState(null);
  const [cooldown, setCooldown] = useState(0);
  const [scanProgress, setScanProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [showCamera, setShowCamera] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    let timer;
    if (cooldown > 0) {
      timer = setInterval(() => {
        setCooldown(prev => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [cooldown]);

  const startCamera = async () => {
    setShowCamera(true);
    setIsProcessing(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment', width: { ideal: 1280 } } 
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      if (addToast) addToast("Erro ao acessar câmera: " + err.message, "error");
      setShowCamera(false);
    } finally {
      setIsProcessing(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setShowCamera(false);
  };

  // Cleanup da câmera ao desmontar o componente
  useEffect(() => () => stopCamera(), []);

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (cooldown > 0) return; // Bloqueia soltar imagens se estiver em espera
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const captureAndProcess = () => {
    if (!videoRef.current) return;

    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoRef.current, 0, 0);

    // Converte para Blob para reutilizar a lógica de processamento de arquivo
    canvas.toBlob((blob) => {
      const file = new File([blob], "capture.jpg", { type: "image/jpeg" });
      processFile(file);
      stopCamera();
    }, 'image/jpeg', 0.95);
  };

  const processFile = (file) => {
    setScanProgress(0);
    setIsProcessing(true);

    // Verificação de Qualidade (Somente para imagens)
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreviewUrl(e.target.result);
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          canvas.width = 64; canvas.height = 64; // Miniatura para processamento rápido
          ctx.drawImage(img, 0, 0, 64, 64);
          const { data } = ctx.getImageData(0, 0, 64, 64);
          let totalLum = 0, totalDiff = 0;
          for (let i = 0; i < data.length; i += 4) {
            const lum = 0.2126 * data[i] + 0.7152 * data[i+1] + 0.0722 * data[i+2];
            totalLum += lum;
            if (i >= 4) {
              const prevLum = 0.2126 * data[i-4] + 0.7152 * data[i-3] + 0.0722 * data[i-2];
              totalDiff += Math.abs(lum - prevLum);
            }
          }
          const avgLum = totalLum / (data.length / 4);
          const avgDiff = totalDiff / (data.length / 4);
          
          if (addToast) {
            if (avgLum < 70) addToast("🌙 Imagem escura detectada. Aumente a iluminação para melhor leitura.", "warning");
            if (avgDiff < 10) addToast("🌫️ Imagem embaçada ou sem contraste detectada.", "warning");
          }

          // Criar canvas processado (escala de cinza) para o Tesseract
          const procCanvas = document.createElement('canvas');
          const procCtx = procCanvas.getContext('2d');
          procCanvas.width = img.width;
          procCanvas.height = img.height;
          procCtx.drawImage(img, 0, 0);

          const imageData = procCtx.getImageData(0, 0, procCanvas.width, procCanvas.height);
          const pixels = imageData.data;
          
          // Otimização para OCR: Aumentar contraste e normalizar tons de cinza
          const contrast = 65; // Ajuste de intensidade (0-100)
          const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

          for (let i = 0; i < pixels.length; i += 4) {
            // 1. Converte para tons de cinza (Luma BT.709)
            let v = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
            
            // 2. Aplica o fator de contraste e faz o clamping entre 0 e 255
            v = Math.max(0, Math.min(255, factor * (v - 128) + 128));
            
            pixels[i] = pixels[i + 1] = pixels[i + 2] = v;
          }
          procCtx.putImageData(imageData, 0, 0);
          
          performOCR(procCanvas, file);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    } else {
      performOCR(file, file);
    }
  };

  const performOCR = (source, originalFile) => {
    // OCR Local e Ilimitado com Tesseract.js
    Tesseract.recognize(
      source,
      'por',
      { logger: m => { if (m.status === 'recognizing text') setScanProgress(Math.floor(m.progress * 100)); } }
    ).then(async ({ data: { text } }) => {
      console.log("📝 Texto extraído via Tesseract:", text);
      try {
        // Envia o texto extraído para o motor de filtragem que já construímos
        const data = await analyzeOrderText(text, inventory || [], pessoas || [], cooldown > 0);
        if (data && (data.customerName || data.orderId || data.rastreio)) {
          setExtractedData(data);
          if(addToast) addToast("✅ Etiqueta lida localmente com sucesso!", "success");
        } else {
          // Fallback: se o Tesseract falhar em ler bem o texto, tenta passar a imagem pra IA
          if (addToast) addToast("Buscando detalhes com a IA Remota...", "info");
          const reader = new FileReader();
          reader.onload = async (event) => {
            const base64 = event.target.result;
            try {
              const fallbackData = await analyzeOrderDocument(base64, inventory || [], pessoas || []);
              if (fallbackData) setExtractedData(fallbackData);
              else if(addToast) addToast("Nenhum dado legível na imagem.", "error");
            } catch (fallbackErr) {
              if (fallbackErr.message.includes("429") || fallbackErr.message.includes("Limite")) {
                setCooldown(60);
                if (addToast) addToast("Cota esgotada. Somente leitura local funcionando.", "warning");
              } else {
                if(addToast) addToast("Erro na IA Remota: " + fallbackErr.message, "error");
              }
            } finally { setIsProcessing(false); }
          };
          reader.readAsDataURL(originalFile);
          return; // Sai do then para esperar o reader
        }
      } catch (error) {
        if (addToast) addToast("Erro no filtro: " + error.message, "error");
      }
      setScanProgress(0);
      setIsProcessing(false);
    }).catch(err => {
      setScanProgress(0);
      setIsProcessing(false);
      if(addToast) addToast("Erro no Scanner Local: " + err.message, "error");
    });
  };

  const handleTextAnalyze = async () => {
    if (!pastedText.trim()) return;
    setIsProcessing(true);
    try {
      const data = await analyzeOrderText(pastedText, inventory || [], pessoas || [], cooldown > 0);
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
        {showCamera ? (
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden', borderRadius: '8px', background: '#000', height: '350px' }}>
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '85%', height: '60%', border: '2px solid rgba(59, 130, 246, 0.8)', borderRadius: '8px', boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)', pointerEvents: 'none' }}></div>
            <div style={{ position: 'absolute', bottom: '10px', left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: '10px' }}>
              <button 
                onClick={captureAndProcess}
                className="save-btn" 
                style={{ padding: '5px 15px', fontSize: '0.8rem' }}
              >
                📸 Capturar
              </button>
              <button 
                onClick={stopCamera}
                className="cancel-btn" 
                style={{ padding: '5px 15px', fontSize: '0.8rem' }}
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
        <div 
          className={`bi-drop-zone ${isDragging ? 'dragging' : ''}`}
          onDragOver={(e) => { e.preventDefault(); if (cooldown === 0) setIsDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
          onDrop={handleDrop}
          style={{ flex: 1, position: 'relative', margin: 0, padding: '1.5rem', background: cooldown > 0 ? 'rgba(239, 68, 68, 0.05)' : 'rgba(59, 130, 246, 0.05)', border: `2px dashed ${cooldown > 0 ? '#ef4444' : '#3b82f6'}`, borderRadius: '8px', opacity: cooldown > 0 ? 0.7 : 1 }}
        >
          <input type="file" accept="image/*,application/pdf" onChange={(e) => e.target.files[0] && processFile(e.target.files[0])} style={{ display: 'none' }} id="label-upload" disabled={cooldown > 0} />
          <label htmlFor="label-upload" style={{ cursor: cooldown > 0 ? 'not-allowed' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', margin: 0 }}>
            {previewUrl ? (
              <img src={previewUrl} alt="Preview" style={{ maxHeight: '80px', borderRadius: '4px', marginBottom: '10px', border: '1px solid var(--border-color)' }} />
            ) : (
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{cooldown > 0 ? '⏳' : ''}</div>
            )}
            <p style={{ fontSize: '0.75rem', margin: 0, color: cooldown > 0 ? '#ef4444' : '#3b82f6', fontWeight: '600', textAlign: 'center' }}>
              {cooldown > 0 ? `Aguarde ${cooldown}s...` : previewUrl ? 'Trocar Arquivo' : 'Arrastar Imagem/PDF'}
            </p>
            <button 
              onClick={(e) => { e.preventDefault(); startCamera(); }}
              className="btn-secondary"
              style={{ marginTop: '10px', fontSize: '0.7rem', padding: '4px 8px' }}
            >
              📷 Usar Câmera
            </button>
          </label>
          {isProcessing && (
            <div className="ai-processing-overlay" style={{ borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="ai-pulse"></div>
              {scanProgress > 0 && scanProgress < 100 && (
                <div style={{ width: '70%', background: 'rgba(255,255,255,0.1)', height: '6px', borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <div style={{ width: `${scanProgress}%`, background: '#3b82f6', height: '100%', transition: 'width 0.3s ease-out', boxShadow: '0 0 10px rgba(59, 130, 246, 0.5)' }}></div>
                </div>
              )}
              <span style={{ fontSize: '0.7rem', color: 'white', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {scanProgress > 0 && scanProgress < 100 ? `Escaneando... ${scanProgress}%` : 'Processando...'}
              </span>
            </div>
          )}
        </div>
        )}

        {/* 2. ZONA DE TEXTO COPIADO (SHOPEE / ML) */}
        <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
           <textarea 
             value={pastedText}
             onChange={(e) => setPastedText(e.target.value)}
             placeholder="...ou cole o texto da etiqueta de envio aqui (Ex: Dados da Shopee ou Mercado Livre)"
             className="inline-input"
             style={{ flex: 1, resize: 'none', backgroundColor: 'var(--input-bg)', minHeight: '120px', color: 'var(--text-color)' }}
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
            <div><strong style={{ color: 'var(--text-muted)' }}>Cliente:</strong><br/>{extractedData.customerName || <em style={{color: '#94a3b8'}}>Não identificado</em>}</div>
            <div><strong style={{ color: 'var(--text-muted)' }}>Destino:</strong><br/>{extractedData.location || <em style={{color: '#94a3b8'}}>Não identificado</em>}</div>
            <div><strong style={{ color: 'var(--text-muted)' }}>CEP:</strong><br/>{extractedData.cep || <em style={{color: '#94a3b8'}}>Não informado</em>}</div>
            <div><strong style={{ color: 'var(--text-muted)' }}>Pedido (Ref):</strong><br/>{extractedData.orderId || <em style={{color: '#94a3b8'}}>Sem ref</em>}</div>
            <div><strong style={{ color: 'var(--text-muted)' }}>NF:</strong><br/>{extractedData.nf || <em style={{color: '#94a3b8'}}>Sem NF</em>}</div>
            <div><strong style={{ color: 'var(--text-muted)' }}>Produto Detectado:</strong><br/>{extractedData.productName || <em style={{color: '#94a3b8'}}>Não identificado</em>}</div>
            <div><strong style={{ color: 'var(--text-muted)' }}>Quantidade:</strong><br/>{extractedData.quantity || '1'}</div>
            <div style={{ gridColumn: '1 / -1' }}><strong style={{ color: 'var(--text-muted)' }}>Endereço Completo:</strong><br/>{extractedData.address || <em style={{color: '#94a3b8'}}>Não extraído</em>}</div>
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