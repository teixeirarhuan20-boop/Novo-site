import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { LabelAssistant } from './LabelAssistant';

// ── Utilitários do mapa ──────────────────────────────────────────────────────
function unpackLocation(itemName) {
  if (!itemName || typeof itemName !== 'string') return null;
  const m = itemName.match(/\s*\|\|\s*(.*?)\s*\|\|\s*/);
  if (m) {
    const p = m[1].split(';').map(part => part.trim());
    return {
      cleanName: itemName.replace(/\s*\|\|.*?\|\|\s*/, '').trim(),
      city:  p[0] || null,
      lat:   p[1] && p[1] !== 'null' ? Number(p[1]) : null,
      lng:   p[2] && p[2] !== 'null' ? Number(p[2]) : null,
    };
  }
  return null;
}

const COLOR_PALETTE = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#4b5563'];

function getProductColor(name, inventory = []) {
  // Busca no inventário
  const inInv = inventory.find(i => i.name.toLowerCase().trim() === name.toLowerCase().trim());
  if (inInv && inInv.color) return inInv.color;

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
}

// ── Mini-mapa de pedidos ──────────────────────────────────────────────────────
function OrdersMap({ transactions, inventory, isActive }) {
  const containerRef = useRef(null);
  const mapRef      = useRef(null);
  const markersRef  = useRef([]);

  const sales = transactions.filter(t => t.type === 'saída');
  const productList = [...new Set(sales.map(t => unpackLocation(t.itemName)?.cleanName || t.itemName.split('||')[0].trim()))];

  // Inicializa mapa com polling (CDN pode não estar pronto)
  useEffect(() => {
    const init = () => {
      if (!containerRef.current || mapRef.current) return;
      if (!window.L) { setTimeout(init, 200); return; }
      mapRef.current = window.L.map(containerRef.current).setView([-15.78, -47.93], 4);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
      }).addTo(mapRef.current);
      setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 150);
    };
    init();
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, []);

  // Forca recalculo quando a aba fica vísivel
  useEffect(() => {
    if (!isActive) return;
    const t = setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 200);
    return () => clearTimeout(t);
  }, [isActive]);

  // Atualiza marcadores quando transações mudam
  useEffect(() => {
    if (!mapRef.current || !window.L) return;
    markersRef.current.forEach(m => mapRef.current.removeLayer(m));
    markersRef.current = [];

    sales.forEach(t => {
      const loc = unpackLocation(t.itemName);
      if (!loc || !loc.lat || !loc.lng || isNaN(loc.lat) || isNaN(loc.lng)) return;
      const color = getProductColor(loc.cleanName, inventory);
      const jitter = v => v + (Math.random() - 0.5) * 0.008;
      const marker = window.L.circleMarker([jitter(loc.lat), jitter(loc.lng)], {
        radius: 12, fillColor: color, color: '#fff',
        weight: 3, opacity: 1, fillOpacity: 0.9,
      }).addTo(mapRef.current).bindPopup(`
        <b style="color:${color}; font-size: 1rem;">${loc.cleanName}</b><br>
        <span style="color: #64748b; font-size: 0.85rem;">👤 ${t.personName || 'Cliente'}</span><br>
        <hr style="margin: 5px 0; border: 0; border-top: 1px solid #eee;" />
        📍 ${loc.city || 'Cidade'}<br>
        💰 <b>R$ ${Number(t.totalValue).toFixed(2)}</b><br>
        📦 ${t.quantity} un.
      `);
      markersRef.current.push(marker);
    });

    if (markersRef.current.length > 0) {
      const group = window.L.featureGroup(markersRef.current);
      mapRef.current.fitBounds(group.getBounds().pad(0.3));
    }
    setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 200);
  }, [transactions]);

  return (
    <div style={{ marginTop: '2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h3 style={{ color: '#1e293b', margin: 0 }}>🗺️ Mapa de Vendas</h3>
        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
          {markersRef.current.length} pedido(s) no mapa
        </span>
      </div>

      {/* Legenda de cores */}
      {productList.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
          {productList.map((p, i) => (
            <span key={p} style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: '#f1f5f9', borderRadius: '20px',
              padding: '3px 10px', fontSize: '0.78rem', color: '#334155'
            }}>
              <span style={{
                width: 12, height: 12, borderRadius: '50%',
                backgroundColor: getProductColor(p, inventory),
                flexShrink: 0, display: 'inline-block'
              }} />
              {p}
            </span>
          ))}
        </div>
      )}

      <div ref={containerRef} style={{
        height: '400px', borderRadius: '12px', overflow: 'hidden',
        border: '1px solid #e2e8f0', background: '#e5e7eb'
      }} />

      {sales.filter(t => { const l = unpackLocation(t.itemName); return !l?.lat; }).length > 0 && (
        <p style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '0.5rem' }}>
          ⚠️ Alguns pedidos não têm coordenadas — verifique se o campo Destino foi preenchido corretamente.
        </p>
      )}
    </div>
  );
}

export function OrdersManager({ inventory, setInventory, pessoas, setPessoas, transactions, setTransactions, addToast, isActive }) {
  const [selectedItem, setSelectedItem] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [selectedPessoa, setSelectedPessoa] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [locationInput, setLocationInput] = useState('');
  const [orderRef, setOrderRef] = useState('');
  const [fullAddress, setFullAddress] = useState('');
  const [bairro, setBairro] = useState('');
  const [rastreio, setRastreio] = useState('');
  const [modalidade, setModalidade] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState('');

  // Função para normalizar texto (remove acentos e converte para minúsculas)
  const normalizeText = (str) => (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  // Filtro de produtos em tempo real
  const filteredProducts = inventory.filter(item => {
    const normalizedSearch = normalizeText(productSearch);
    if (!normalizedSearch) return true;
    
    const tokens = normalizedSearch.split(/\s+/).filter(t => t.length > 0);
    const itemContent = normalizeText(`${item.name} ${item.category}`);
    
    // Verifica se todos os termos digitados existem no nome ou categoria (independente da ordem)
    return tokens.every(token => itemContent.includes(token));
  });

  const handleOrder = async (e) => {
    e.preventDefault();
    if (!selectedItem || !selectedPessoa || quantity <= 0 || !locationInput) {
      if(addToast) addToast("Por favor, preencha todos os campos do pedido.", "warning");
      return;
    }

    setIsProcessing(true);
    setMessage('Processando pedido e localizando no mapa...');

    try {
      const item = inventory.find(i => i.id === selectedItem);
      let pessoa = pessoas.find(p => p.id === selectedPessoa || p.name.toLowerCase() === selectedPessoa.toLowerCase().trim());
      
      if (!pessoa) {
        // Auto-cadastro de cliente
        pessoa = {
          id: Date.now().toString() + Math.random().toString(),
          name: selectedPessoa.trim(),
          document: '',
          role: 'cliente',
          contact: ''
        };
        if (setPessoas) setPessoas(prev => [...prev, pessoa]);
        await supabase.from('pessoas').insert([pessoa]);
        if (addToast) addToast(`Novo cliente cadastrado automaticamente: ${pessoa.name}`, "success");
      }
      
      if (item.quantity < quantity) {
        if(addToast) addToast("Estoque insuficiente para este pedido!", "error");
        setIsProcessing(false);
        setMessage('');
        return;
      }

      // 1. Geocodificação Automática (ViaCEP + Nominatim)
      let lat = null, lng = null;
      let cityOnly = locationInput.split('-')[0].split(',')[0].trim();

      try {
        const cepMatch = locationInput.match(/\d{5}-?\d{3}/);

        if (cepMatch) {
          // Tenta ViaCEP primeiro para obter cidade real do CEP
          const cepRaw = cepMatch[0].replace('-', '');
          try {
            const viaCepRes = await fetch(`https://viacep.com.br/ws/${cepRaw}/json/`);
            const viaCepData = await viaCepRes.json();
            if (!viaCepData.erro && viaCepData.localidade) {
              cityOnly = `${viaCepData.localidade} - ${viaCepData.uf}`;
              // Usa cidade+UF no Nominatim (muito mais confiável do que o CEP bruto)
              const geoRes = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(viaCepData.localidade + ', ' + viaCepData.uf + ', Brasil')}&countrycodes=br&limit=1`,
                { headers: { 'User-Agent': 'MeuNegocioCRM/1.0' } }
              );
              const geoData = await geoRes.json();
              if (geoData && geoData.length > 0) {
                lat = geoData[0].lat;
                lng = geoData[0].lon;
              }
            }
          } catch (_) { /* ViaCEP falhou, continua para Nominatim direto */ }
        }

        // Fallback: Nominatim direto (para cidades digitadas sem CEP, ou se ViaCEP falhou)
        if (!lat) {
          const query = cepMatch ? cepMatch[0] : locationInput;
          const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=br&limit=1`,
            { headers: { 'User-Agent': 'MeuNegocioCRM/1.0' } }
          );
          const data = await response.json();
          if (data && data.length > 0) {
            lat = data[0].lat;
            lng = data[0].lon;
            if (!cepMatch && data[0].display_name) {
              const parts = data[0].display_name.split(',');
              if (parts.length > 0) cityOnly = parts[0].trim();
            }
          }
        }
      } catch (err) {
        console.error('Erro na geocodificação:', err);
      }

      // 2. Preparar "Smart String" para o mapa
      const packedItemName = `${item.name} ||${cityOnly};${lat};${lng};${orderRef};;${locationInput.match(/\d{5}-?\d{3}/)?.[0] || ''};${fullAddress};${bairro};${rastreio};${modalidade}||`;
      const newQuantity = Number(item.quantity) - Number(quantity);

      // 3. Registrar Transação (Salvando 'city' separadamente para o histórico)
      const newTransaction = {
        id: Date.now().toString() + Math.random().toString(),
        type: 'saída',
        itemId: item.id,
        itemName: packedItemName,
        city: cityOnly, // <--- CAMPO CIDADE PARA O HISTÓRICO
        quantity: quantity,
        unitPrice: item.price,
        totalValue: item.price * quantity,
        personName: pessoa.name,
        date: new Date().toLocaleDateString() + ' às ' + new Date().toLocaleTimeString()
      };

      // 4. Sincronizar Supabase
      const { error: invError } = await supabase.from('inventory').update({ quantity: newQuantity }).eq('id', item.id);
      const { error: traError } = await supabase.from('transactions').insert([newTransaction]);

      if (invError || traError) {
        throw new Error('Erro ao salvar no banco de dados.');
      }

      // 5. Atualizar Estado Local
      setInventory(prev => prev.map(i => i.id === item.id ? { ...i, quantity: newQuantity } : i));
      setTransactions(prev => [...prev, newTransaction]);

      // Limpeza
      setSelectedItem('');
      setProductSearch('');
      setSelectedPessoa('');
      setQuantity(1);
      setLocationInput('');
      setOrderRef('');
      setFullAddress('');
      setBairro('');
      setRastreio('');
      setModalidade('');
      setMessage('✅ Pedido realizado com sucesso! Estoque atualizado e mapa marcado.');
      
      setTimeout(() => setMessage(''), 5000);

    } catch (error) {
      console.error(error);
      setMessage('❌ Erro ao processar pedido.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="inventory-panel">
      <div className="bi-header">
        <div>
          <h1>🛒 Novo Pedido de Venda</h1>
          <p>Lançamento rápido com baixa automática e geolocalização.</p>
        </div>
      </div>

      <div className="bi-card" style={{ maxWidth: '600px', margin: '0 auto' }}>
        <LabelAssistant 
          inventory={inventory} 
          pessoas={pessoas} 
          addToast={addToast}
          onDataExtracted={async (dadosIA) => {
            if (dadosIA.location || dadosIA.cep) {
              let loc = dadosIA.location || "";
              const cleanCep = (dadosIA.cep || "").replace(/\D/g, "");
              if (cleanCep && !loc.includes(cleanCep)) {
                const formattedCep = cleanCep.replace(/(\d{5})(\d{3})/, "$1-$2");
                loc += loc ? ` - CEP: ${formattedCep}` : formattedCep;
              }
              setLocationInput(loc);
            }
            if (dadosIA.quantity) setQuantity(Number(dadosIA.quantity));
            if (dadosIA.productName) {
              const searchName = normalizeText(dadosIA.productName);
              setProductSearch(dadosIA.productName);
              
              // Lógica de Busca Aproximada (Fuzzy Match por Tokens)
              const searchTokens = searchName.split(/\s+/).filter(t => t.length > 1);
              let bestMatch = null;
              let highestScore = 0;

              inventory.forEach(item => {
                const itemName = normalizeText(item.name);
                const itemTokens = itemName.split(/\s+/);
                let score = 0;

                // Pontua se a palavra da etiqueta estiver contida no nome do produto
                searchTokens.forEach(token => {
                  if (itemName.includes(token)) score++;
                });

                if (score > highestScore) {
                  highestScore = score;
                  bestMatch = item;
                }
              });

              // Seleciona o melhor resultado se houver uma compatibilidade mínima (ex: pelo menos 1 palavra)
              const matchedProduct = highestScore > 0 ? bestMatch : null;

              if (matchedProduct) {
                setSelectedItem(matchedProduct.id);
                setProductSearch(matchedProduct.name);
              } else if (addToast) {
                addToast(`Produto "${dadosIA.productName}" não identificado no estoque.`, "warning");
              }
            }
            if (dadosIA.orderId)   setOrderRef(dadosIA.orderId);
            if (dadosIA.address)   setFullAddress(dadosIA.address);
            if (dadosIA.bairro)    setBairro(dadosIA.bairro);
            if (dadosIA.rastreio)  setRastreio(dadosIA.rastreio);
            if (dadosIA.modalidade) setModalidade(dadosIA.modalidade);
            if (dadosIA.nf && !orderRef) setOrderRef(`NF: ${dadosIA.nf}`);
            
            // Lógica de Autocadastro de Cliente
            if (dadosIA.customerName) {
              const nomeCliente = dadosIA.customerName.trim();
              // Tenta achar o cliente ignorando maiúsculas e minúsculas
              const clienteExistente = pessoas.find(p => p.name.toLowerCase() === nomeCliente.toLowerCase());
              
              if (clienteExistente) {
                setSelectedPessoa(clienteExistente.name);
                if (addToast) addToast(`Mágica feita! Cliente já existente selecionado: ${nomeCliente}`, "success");
              } else {
                // Cria o cliente no formato exigido pelo banco
                const novoCliente = {
                  id: Date.now().toString() + Math.random().toString(),
                  name: nomeCliente,
                  document: '',
                  role: 'cliente',
                  contact: ''
                };
                // Atualiza o estado da tela imediatamente
                if (setPessoas) setPessoas(prev => [...prev, novoCliente]);
                // Seleciona a pessoa recém criada na caixinha de opções
                setSelectedPessoa(novoCliente.name);
                // Salva no banco de dados (Supabase) em segundo plano
                await supabase.from('pessoas').insert([novoCliente]);
                
                if (addToast) addToast(`Novo cliente cadastrado e selecionado: ${nomeCliente}! 🎉`, "success");
              }
            } else {
              if (addToast) addToast("Dados preenchidos! (Nenhum cliente identificado)", "success");
            }
          }} 
        />

        <form onSubmit={handleOrder} className="bi-filter-group" style={{ gap: '1.5rem' }}>
          
          <div className="bi-filter-group">
            <label>BUSCAR PRODUTO (NOME OU CATEGORIA)</label>
            <input 
              type="text" 
              placeholder="🔍 Comece a digitar o produto..." 
              value={productSearch} 
              onChange={(e) => setProductSearch(e.target.value)} 
              className="input-field"
              style={{ padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', marginBottom: '0.5rem' }}
            />
            <select 
              value={selectedItem} 
              onChange={(e) => setSelectedItem(e.target.value)} 
              required
              style={{ border: productSearch ? '2px solid #3b82f6' : '1px solid #cbd5e1' }}
            >
              <option value="">
                {filteredProducts.length === 0 ? 'Nenhum produto encontrado' : 'Selecione o produto filtrado...'}
              </option>
              {filteredProducts.map(item => (
                <option key={item.id} value={item.id} disabled={item.quantity <= 0}>
                  {item.name} ({item.quantity} un.) - R$ {item.price}
                </option>
              ))}
            </select>
          </div>

          <div className="bi-filter-group">
            <label>CLIENTE (PESSOA)</label>
            <input 
              type="text" 
              list="pessoas-list"
              placeholder="Digite o nome ou selecione o cliente..." 
              value={selectedPessoa} 
              onChange={(e) => setSelectedPessoa(e.target.value)} 
              className="input-field"
              style={{ padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              required 
            />
            <datalist id="pessoas-list">
              {pessoas.map(p => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="bi-filter-group">
              <label>QUANTIDADE</label>
              <input 
                type="number" 
                value={quantity} 
                onChange={(e) => setQuantity(e.target.value)} 
                min="1" 
                className="input-field" 
                style={{ padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                required 
              />
            </div>
            <div className="bi-filter-group">
              <label>PEDIDO (REF)</label>
              <input 
                type="text" 
                placeholder="Ex: #12345" 
                value={orderRef} 
                onChange={(e) => setOrderRef(e.target.value)} 
                className="input-field"
                style={{ padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="bi-filter-group">
              <label>DESTINO (CIDADE OU CEP)</label>
              <input 
                type="text" 
                placeholder="Ex: São Paulo ou 01310-000" 
                value={locationInput} 
                onChange={(e) => setLocationInput(e.target.value)} 
                className="input-field"
                style={{ padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                required 
              />
            </div>
            <div className="bi-filter-group">
              <label>ENDEREÇO COMPLETO</label>
              <input 
                type="text" 
                placeholder="Rua, Número, Bairro" 
                value={fullAddress} 
                onChange={(e) => setFullAddress(e.target.value)} 
                className="input-field"
                style={{ padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="bi-filter-group">
              <label>BAIRRO</label>
              <input 
                type="text" 
                placeholder="Ex: Pajuçara" 
                value={bairro} 
                onChange={(e) => setBairro(e.target.value)} 
                className="input-field"
                style={{ padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <div className="bi-filter-group">
              <label>RASTREIO</label>
              <input 
                type="text" 
                placeholder="Ex: BR2641257085334" 
                value={rastreio} 
                onChange={(e) => setRastreio(e.target.value)} 
                className="input-field"
                style={{ padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
          </div>

          <div className="bi-filter-group">
            <label>MODALIDADE DE ENVIO</label>
            <select
              value={modalidade}
              onChange={(e) => setModalidade(e.target.value)}
              style={{ padding: '0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', width: '100%' }}
            >
              <option value="">Selecione a modalidade...</option>
              <option value="COLETA">COLETA</option>
              <option value="PAC">PAC</option>
              <option value="SEDEX">SEDEX</option>
              <option value="SEDEX 10">SEDEX 10</option>
              <option value="JADLOG">JADLOG</option>
              <option value="CORREIOS">CORREIOS</option>
              <option value="TRANSPORTADORA">TRANSPORTADORA</option>
              <option value="RETIRADA">RETIRADA</option>
            </select>
          </div>

          <button 
            type="submit" 
            className="action-btn" 
            style={{ width: '100%', marginTop: '1rem', padding: '1rem' }}
            disabled={isProcessing}
          >
            {isProcessing ? 'Processando...' : '🔥 Finalizar e Marcar no Mapa'}
          </button>

          {message && (
            <div style={{ 
              marginTop: '1rem', 
              padding: '1rem', 
              borderRadius: '8px', 
              backgroundColor: message.includes('✅') ? '#f0fdf4' : '#fef2f2',
              color: message.includes('✅') ? '#166534' : '#991b1b',
              fontSize: '0.9rem',
              fontWeight: '500',
              textAlign: 'center'
            }}>
              {message}
            </div>
          )}
        </form>
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h3 style={{ marginBottom: '1rem', color: '#1e293b' }}>Últimas Vendas</h3>
        <table className="bi-data-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Cliente</th>
              <th>Produto</th>
              <th>Qtd</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {transactions.filter(t => t.type === 'saída').slice(-5).reverse().map((t, idx) => (
              <tr key={idx}>
                <td>{t.date.split(' ')[0]}</td>
                <td>{t.personName}</td>
                <td>{t.itemName.split('||')[0]}</td>
                <td>{t.quantity}</td>
                <td style={{ fontWeight: 'bold', color: '#16a34a' }}>R$ {Number(t.totalValue).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Mapa de vendas embutido ── */}
      <OrdersMap transactions={transactions} inventory={inventory} isActive={isActive} />
    </div>
  );
}
