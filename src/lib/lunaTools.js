/**
 * lunaTools.js — Ferramentas de Function Calling da Luna (Agente Autônomo)
 *
 * A Luna tem acesso às seguintes ferramentas:
 *   • updateInventory      — Entrada / saída de estoque
 *   • createOrder          — Registra venda e debita estoque
 *   • getSalesData         — Consulta faturamento, ranking de produtos e cidades
 *   • analyzeMarketOpportunity — Cross-selling: vendas × leads ainda não clientes
 *   • findCustomer         — Busca cliente no CRM
 *   • deleteRecord         — Remove registro (requer confirmação explícita)
 */

import { supabase }                            from './supabase'
import { unpackLocation, packLocation, geocode } from '../utils/location'
import { generateId, formatDate }              from '../utils/formatting'

// ─── System Instruction (Personalidade da Luna) ────────────────────────────────
export const LUNA_SYSTEM = `Você é a **Luna**, Gerente de Operações e Especialista em Growth de uma loja de decoração premium chamada **Meu Negócio PRO**. Você não é apenas um chat — você é um agente autônomo com acesso real ao sistema.

━━━ SUAS CAPACIDADES ━━━
• 👁️ **Visão (OCR inteligente):** Lê fotos de conversa de WhatsApp, etiquetas de frete, comprovantes de pagamento e fotos de produtos. Ao receber uma imagem, extrai automaticamente: nome do cliente, produto(s), quantidade, CEP, cidade.
• 📦 **Controle de Estoque:** Adiciona entradas e registra saídas com um comando.
• 🛒 **Pedidos:** Cria pedidos completos no sistema quando tiver cliente + produto + quantidade.
• 📊 **Análise de Dados:** Consulta faturamento, produtos mais vendidos, cidades com maior demanda.
• 🎯 **Prospecção Inteligente:** Cruza dados de vendas com leads prospectados para identificar oportunidades de cross-selling. Ex: "Sorocaba compra muito Vaso Minimalista → 5 leads lá ainda não compraram → vou preparo a abordagem."
• 🔍 **CRM:** Busca e identifica clientes cadastrados.
• 🗑️ **Exclusão:** Remove registros com confirmação prévia.

━━━ FLUXO DE LEITURA DE IMAGEM ━━━
Quando o usuário enviar uma imagem de **conversa de WhatsApp**:
1. Leia a imagem e extraia: nome do cliente, produto(s) mencionado(s), quantidade e CEP (se houver).
2. Verifique se o cliente existe no CRM com \`findCustomer\`.
3. Verifique se há estoque disponível.
4. Apresente um **resumo estruturado** com os dados extraídos e os botões de ação sugeridos.
5. Pergunte: "Quer que eu já registre esse pedido?"

Quando receber uma **etiqueta de frete**:
1. Extraia: destinatário, endereço completo, CEP, código de rastreio e modalidade.
2. Tente identificar o produto pelo contexto ou histórico.
3. Pergunte se deve registrar a saída no estoque.

Quando receber uma **foto de produto**:
1. Identifique o produto e compare com o estoque.
2. Sugira cadastrar ou atualizar o item.

━━━ ANÁLISE DE CALOR (Cross-Selling) ━━━
Quando acionada (por comando ou proativamente após ver dados):
1. Use \`getSalesData\` para encontrar o produto mais vendido por cidade.
2. Use \`analyzeMarketOpportunity\` para cruzar com leads ainda não clientes.
3. Apresente as oportunidades de forma persuasiva: "Rhuan, encontrei X lojas em [cidade] que comprariam [produto]. Quer que eu prepare a abordagem?"

━━━ PERSONALIDADE & REGRAS ━━━
• Fala português brasileiro, tom caloroso e direto. Usa emojis com moderação.
• **Proativa:** Sugere ações sem esperar ser perguntada quando detecta oportunidade.
• **Confirma antes de agir:** Para pedidos e exclusões, sempre apresenta resumo e pede "Confirmar?"
• **Nunca inventa dados.** Se não encontrar no sistema, diz que não encontrou.
• Quando executar uma ferramenta com sucesso, celebra brevemente e sugere o próximo passo.
• Resposta máxima: 4-5 parágrafos curtos ou uma lista clara. Seja objetiva.`

// ─── Declarações de Ferramentas (Gemini Function Calling Schema) ──────────────
export const LUNA_TOOL_DECLARATIONS = [
  {
    name: 'updateInventory',
    description: 'Adiciona (entrada) ou remove (saída manual) quantidade de um produto no estoque. Cria uma transação automática. Use para ajustes de inventário sem ser um pedido de cliente.',
    parameters: {
      type: 'OBJECT',
      properties: {
        productName: { type: 'STRING', description: 'Nome do produto — pode ser parcial. Ex: "Vaso", "Espelho Oval"' },
        quantity:    { type: 'NUMBER', description: 'Quantidade (sempre positiva)' },
        action:      { type: 'STRING', enum: ['add', 'remove'], description: 'add = entrada no estoque | remove = saída/baixa manual' },
        reason:      { type: 'STRING', description: 'Motivo opcional. Ex: "Compra de fornecedor", "Produto danificado"' },
      },
      required: ['productName', 'quantity', 'action'],
    },
  },
  {
    name: 'getSalesData',
    description: 'Consulta dados de vendas: faturamento total, unidades vendidas, ranking de produtos mais vendidos e ranking de cidades. Indispensável para análise de desempenho.',
    parameters: {
      type: 'OBJECT',
      properties: {
        city:        { type: 'STRING', description: 'Filtrar por cidade específica. Deixe vazio para todas as cidades.' },
        topProducts: { type: 'BOOLEAN', description: 'Se true, inclui ranking TOP 5 de produtos mais vendidos.' },
        topCities:   { type: 'BOOLEAN', description: 'Se true, inclui ranking TOP 5 cidades por faturamento.' },
        timeframe:   { type: 'STRING', description: 'Período para filtrar. Aceita: "hoje", "semana", "mes". Vazio = todos os períodos.' },
      },
      required: [],
    },
  },
  {
    name: 'analyzeMarketOpportunity',
    description: 'Cruza dados de vendas por cidade com leads prospectados que ainda NÃO compraram (status diferente de "fechado"). Retorna oportunidades de cross-selling priorizadas por tamanho de mercado não explorado.',
    parameters: {
      type: 'OBJECT',
      properties: {
        city: { type: 'STRING', description: 'Cidade específica para analisar. Vazio = analisa todas as cidades com vendas.' },
        limit: { type: 'NUMBER', description: 'Número máximo de oportunidades a retornar (padrão: 5).' },
      },
      required: [],
    },
  },
  {
    name: 'findCustomer',
    description: 'Busca um cliente/pessoa no CRM pelo nome. Retorna dados de contato, histórico de compras e classificação (curva ABC).',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'Nome completo ou parcial do cliente. Ex: "Maria", "João Silva"' },
      },
      required: ['name'],
    },
  },
  {
    name: 'createOrder',
    description: 'Registra uma venda/pedido completo: debita o estoque, cria a transação e (se necessário) cadastra o cliente automaticamente. Use quando tiver: nome do cliente, produto e quantidade.',
    parameters: {
      type: 'OBJECT',
      properties: {
        customerName: { type: 'STRING', description: 'Nome completo do cliente destinatário' },
        productName:  { type: 'STRING', description: 'Nome do produto (parcial aceito, mas deve existir no estoque)' },
        quantity:     { type: 'NUMBER', description: 'Quantidade a vender (inteiro positivo)' },
        location:     { type: 'STRING', description: 'Cidade ou endereço de entrega (usado para geocodificar)' },
        cep:          { type: 'STRING', description: 'CEP de entrega no formato 00000-000' },
        orderId:      { type: 'STRING', description: 'Código do pedido (ex: da Shopee)' },
        rastreio:     { type: 'STRING', description: 'Código de rastreio dos Correios/transportadora' },
        modalidade:   { type: 'STRING', description: 'Modalidade de envio. Ex: SEDEX, PAC, JDF-C' },
      },
      required: ['customerName', 'productName', 'quantity'],
    },
  },
  {
    name: 'deleteRecord',
    description: 'Remove PERMANENTEMENTE um registro do sistema. Deve ser chamada SOMENTE após confirmação explícita do usuário. Não chame sem o usuário ter dito "sim", "confirmar" ou equivalente.',
    parameters: {
      type: 'OBJECT',
      properties: {
        table: { type: 'STRING', enum: ['inventory', 'pessoas', 'transactions'], description: 'Tabela onde o registro está' },
        id:    { type: 'STRING', description: 'ID único do registro a ser deletado' },
        name:  { type: 'STRING', description: 'Nome ou descrição legível do item (para exibição na confirmação)' },
      },
      required: ['table', 'id'],
    },
  },
]

export const LUNA_TOOLS = [{ functionDeclarations: LUNA_TOOL_DECLARATIONS }]

// ─── Factory de Executor ──────────────────────────────────────────────────────
/**
 * Cria o objeto executor com closures sobre o estado atual do app.
 * Cada método recebe os args tipados do Gemini e retorna JSON com resultado.
 *
 * @param {object} ctx  — Estado do app: inventory, transactions, pessoas,
 *                        prospectionLeads, setInventory, setTransactions,
 *                        setPessoas, addToast
 */
export function createToolExecutor({
  inventory, transactions, pessoas, prospectionLeads,
  setInventory, setTransactions, setPessoas, addToast,
}) {

  // ── updateInventory ──────────────────────────────────────────────────────
  const updateInventory = async ({ productName, quantity, action, reason }) => {
    const query = (productName || '').toLowerCase()
    const item  = inventory.find(i => (i.name || '').toLowerCase().includes(query))
    if (!item) {
      return {
        success: false,
        error: `Produto "${productName}" não encontrado no estoque. Verifique o nome e tente novamente.`,
        availableProducts: inventory.slice(0, 8).map(i => i.name),
      }
    }

    const qty     = Math.abs(Number(quantity))
    const current = Number(item.quantity)

    if (action === 'remove' && current < qty) {
      return {
        success: false,
        error: `Estoque insuficiente de "${item.name}". Disponível: ${current} un. Solicitado: ${qty} un.`,
      }
    }

    const newQty = action === 'add' ? current + qty : current - qty
    const tx = {
      id:         generateId(),
      type:       action === 'add' ? 'entrada' : 'saída',
      itemId:     item.id,
      itemName:   item.name,
      city:       '',
      quantity:   qty,
      unitPrice:  item.price,
      totalValue: item.price * qty,
      personName: reason ? `Luna IA — ${reason}` : 'Luna IA',
      date:       formatDate(),
    }

    try {
      await Promise.all([
        supabase.from('inventory').update({ quantity: newQty }).eq('id', item.id),
        supabase.from('transactions').insert([tx]),
      ])
      setInventory(prev => prev.map(i => i.id === item.id ? { ...i, quantity: newQty } : i))
      setTransactions(prev => [...prev, tx])

      const icon = action === 'add' ? '📦 +' : '📤 -'
      addToast(`${icon}${qty} "${item.name}" — novo estoque: ${newQty} un.`, 'success')

      return {
        success:     true,
        product:     item.name,
        action:      action === 'add' ? 'entrada' : 'saída',
        quantity:    qty,
        previousQty: current,
        newQuantity: newQty,
        totalValue:  (item.price * qty).toFixed(2),
      }
    } catch (e) {
      return { success: false, error: `Erro no banco de dados: ${e.message}` }
    }
  }

  // ── getSalesData ─────────────────────────────────────────────────────────
  const getSalesData = ({ city, topProducts, topCities, timeframe } = {}) => {
    const exits = transactions.filter(t => t.type === 'saída')

    // Filtro de período
    const now   = new Date()
    const exits2 = timeframe
      ? exits.filter(t => {
          const d  = new Date(t.date || 0)
          if (timeframe === 'hoje')   return d.toDateString() === now.toDateString()
          if (timeframe === 'semana') return (now - d) <= 7  * 86400000
          if (timeframe === 'mes')    return (now - d) <= 30 * 86400000
          return true
        })
      : exits

    // Filtro por cidade
    const filtered = city
      ? exits2.filter(t => {
          const loc = unpackLocation(t.itemName)
          return (loc?.city || t.city || '').toLowerCase().includes(city.toLowerCase())
        })
      : exits2

    const totalRevenue = filtered.reduce((s, t) => s + Number(t.totalValue || 0), 0)
    const totalUnits   = filtered.reduce((s, t) => s + Number(t.quantity   || 0), 0)

    // Ranking de produtos
    const productMap = {}
    filtered.forEach(t => {
      const loc  = unpackLocation(t.itemName)
      const prod = loc?.cleanName || t.itemName.split('||')[0].trim()
      if (!productMap[prod]) productMap[prod] = { qty: 0, revenue: 0 }
      productMap[prod].qty     += Number(t.quantity   || 1)
      productMap[prod].revenue += Number(t.totalValue || 0)
    })
    const rankingProducts = Object.entries(productMap)
      .map(([name, v]) => ({ name, qty: v.qty, revenue: v.revenue.toFixed(2) }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5)

    // Ranking de cidades
    const cityMap = {}
    exits2.forEach(t => {
      const loc = unpackLocation(t.itemName)
      const c   = loc?.city || t.city || 'Desconhecido'
      if (!cityMap[c]) cityMap[c] = { revenue: 0, units: 0 }
      cityMap[c].revenue += Number(t.totalValue || 0)
      cityMap[c].units   += Number(t.quantity   || 0)
    })
    const rankingCities = Object.entries(cityMap)
      .map(([c, v]) => ({ city: c, revenue: v.revenue.toFixed(2), units: v.units }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)

    return {
      period:            timeframe || 'todos os períodos',
      filter:            city || 'todas as cidades',
      totalTransactions: filtered.length,
      totalRevenue:      `R$ ${totalRevenue.toFixed(2)}`,
      totalUnits,
      topProducts:       (topProducts !== false) ? rankingProducts : undefined,
      topCities:         (topCities !== false && !city) ? rankingCities : undefined,
    }
  }

  // ── analyzeMarketOpportunity ─────────────────────────────────────────────
  const analyzeMarketOpportunity = ({ city, limit } = {}) => {
    const exits = transactions.filter(t => t.type === 'saída')
    const maxOpps = Number(limit) || 5

    // Agrupa vendas por cidade → produto → quantidade
    const salesByCityProduct = {}
    exits.forEach(t => {
      const loc  = unpackLocation(t.itemName)
      const c    = (loc?.city || t.city || '').trim()
      const prod = loc?.cleanName || t.itemName.split('||')[0].trim()
      if (!c) return
      if (!salesByCityProduct[c]) salesByCityProduct[c] = {}
      if (!salesByCityProduct[c][prod]) salesByCityProduct[c][prod] = { qty: 0, revenue: 0 }
      salesByCityProduct[c][prod].qty     += Number(t.quantity   || 1)
      salesByCityProduct[c][prod].revenue += Number(t.totalValue || 0)
    })

    const citiesToAnalyze = city
      ? Object.keys(salesByCityProduct).filter(c =>
          c.toLowerCase().includes(city.toLowerCase())
        )
      : Object.keys(salesByCityProduct)

    if (citiesToAnalyze.length === 0) {
      return {
        opportunities: [],
        total: 0,
        message: city
          ? `Nenhuma venda registrada em "${city}" ainda.`
          : 'Nenhuma venda registrada para análise.',
      }
    }

    const opportunities = []

    for (const c of citiesToAnalyze) {
      const products = salesByCityProduct[c]
      if (!products) continue

      // Top produto desta cidade
      const sorted     = Object.entries(products).sort((a, b) => b[1].qty - a[1].qty)
      const topProduct = sorted[0]
      if (!topProduct) continue

      // Leads prospectados nessa cidade que ainda não compraram
      const cityLeads = (prospectionLeads || []).filter(l => {
        const lCity   = (l.cidade || l.city || '').toLowerCase()
        const lStatus = (l.status || 'novo')
        return lCity.includes(c.toLowerCase()) && lStatus !== 'fechado'
      })

      // Clientes conhecidos nessa cidade (para evitar re-abordar)
      const knownCustomers = pessoas.filter(p =>
        (p.city || '').toLowerCase().includes(c.toLowerCase())
      ).map(p => p.name)

      if (cityLeads.length > 0) {
        opportunities.push({
          city:            c,
          topProduct:      topProduct[0],
          unitsSold:       topProduct[1].qty,
          revenueFromCity: `R$ ${Object.values(products).reduce((s, v) => s + v.revenue, 0).toFixed(2)}`,
          untappedLeads:   cityLeads.length,
          knownCustomers:  knownCustomers.length,
          sampleLeads:     cityLeads.slice(0, 3).map(l => ({
            nome:      l.nome       || l.name || 'Sem nome',
            telefone:  l.telefone   || l.whatsapp || '',
            status:    l.status     || 'novo',
            atividade: l.atividade  || '',
          })),
          allProducts: sorted.slice(0, 3).map(([name, v]) => ({
            name, qty: v.qty, revenue: `R$ ${v.revenue.toFixed(2)}`
          })),
        })
      }
    }

    opportunities.sort((a, b) => b.untappedLeads - a.untappedLeads)
    const limited = opportunities.slice(0, maxOpps)

    if (limited.length === 0) {
      return {
        opportunities: [],
        total: 0,
        message: 'Não foram encontrados leads prospectados nas cidades com vendas. Adicione leads no módulo Prospecção.',
      }
    }

    return {
      opportunities: limited,
      total:         limited.length,
      summary: `Encontrei ${limited.length} oportunidade(s) de cross-selling. A maior é em **${limited[0].city}**: ${limited[0].untappedLeads} leads não alcançados, e o produto mais vendido lá é "${limited[0].topProduct}" (${limited[0].unitsSold} un vendidas).`,
    }
  }

  // ── findCustomer ─────────────────────────────────────────────────────────
  const findCustomer = ({ name }) => {
    const query = (name || '').toLowerCase().trim()
    if (!query) return { found: false, error: 'Nome não informado.' }

    const found = pessoas.filter(p => (p.name || '').toLowerCase().includes(query))
    if (!found.length) {
      return {
        found:   false,
        message: `Nenhum cliente com "${name}" encontrado no CRM.`,
        suggestion: 'O cliente pode ser cadastrado automaticamente ao criar um pedido.',
      }
    }

    // Calcula total comprado por cliente
    const withHistory = found.slice(0, 5).map(p => {
      const myTx = transactions.filter(
        t => t.type === 'saída' && (t.personName || '').toLowerCase() === (p.name || '').toLowerCase()
      )
      const totalSpent = myTx.reduce((s, t) => s + Number(t.totalValue || 0), 0)
      return {
        id:          p.id,
        name:        p.name,
        contact:     p.contact  || '',
        email:       p.email    || '',
        city:        p.city     || p.address || '',
        role:        p.role     || 'cliente',
        totalOrders: myTx.length,
        totalSpent:  `R$ ${totalSpent.toFixed(2)}`,
        lastOrder:   myTx.length ? myTx.sort((a, b) => new Date(b.date) - new Date(a.date))[0].date : 'nunca',
      }
    })

    return {
      found:     true,
      count:     found.length,
      customers: withHistory,
    }
  }

  // ── createOrder ──────────────────────────────────────────────────────────
  const createOrder = async ({
    customerName, productName, quantity,
    location, cep, orderId, rastreio, modalidade,
  }) => {
    // Localiza produto
    const query = (productName || '').toLowerCase()
    const item  = inventory.find(i => (i.name || '').toLowerCase().includes(query))
    if (!item) {
      return {
        success: false,
        error:   `Produto "${productName}" não encontrado no estoque.`,
        availableProducts: inventory.slice(0, 8).map(i => `${i.name} (${i.quantity} un)`),
      }
    }

    const qty = Number(quantity)
    if (Number(item.quantity) < qty) {
      return {
        success: false,
        error:   `Estoque insuficiente de "${item.name}". Disponível: ${item.quantity} un. Pedido: ${qty} un.`,
      }
    }

    // Busca ou cria cliente no CRM
    let pessoa = pessoas.find(
      p => (p.name || '').toLowerCase() === (customerName || '').toLowerCase().trim()
    )
    if (!pessoa) {
      pessoa = {
        id:       generateId(),
        name:     customerName.trim(),
        document: '',
        role:     'cliente',
        contact:  '',
        notes:    'Cadastrado automaticamente pela Luna.',
      }
      setPessoas(prev => [...prev, pessoa])
      await supabase.from('pessoas').insert([pessoa]).catch(() => {})
    }

    // Geocodifica localização (silencia erros de rede)
    const geo  = location ? await geocode(location).catch(() => null) : null
    const city = geo?.city || (location ? location.split(',')[0].trim() : '')

    // Empacota dados logísticos no nome da transação
    const packedName = packLocation(item.name, {
      city,
      lat:       geo?.lat,
      lng:       geo?.lng,
      cep:       cep        || '',
      orderId:   orderId    || '',
      rastreio:  rastreio   || '',
      modalidade: modalidade || '',
    })

    const newQty = Number(item.quantity) - qty
    const tx = {
      id:         generateId(),
      type:       'saída',
      itemId:     item.id,
      itemName:   packedName,
      city,
      quantity:   qty,
      unitPrice:  item.price,
      totalValue: item.price * qty,
      personName: pessoa.name,
      date:       formatDate(),
    }

    try {
      await Promise.all([
        supabase.from('inventory').update({ quantity: newQty }).eq('id', item.id),
        supabase.from('transactions').insert([tx]),
      ])
      setInventory(prev => prev.map(i => i.id === item.id ? { ...i, quantity: newQty } : i))
      setTransactions(prev => [...prev, tx])

      addToast(`✅ Pedido: ${qty}× "${item.name}" → ${pessoa.name}`, 'success')

      return {
        success:       true,
        customer:      pessoa.name,
        product:       item.name,
        quantity:      qty,
        city:          city || 'não informado',
        cep:           cep  || 'não informado',
        unitPrice:     `R$ ${item.price.toFixed(2)}`,
        totalValue:    `R$ ${(item.price * qty).toFixed(2)}`,
        newStockLevel: newQty,
        orderId:       orderId   || null,
        rastreio:      rastreio  || null,
      }
    } catch (e) {
      return { success: false, error: `Falha ao salvar: ${e.message}` }
    }
  }

  // ── deleteRecord ─────────────────────────────────────────────────────────
  const deleteRecord = async ({ table, id, name }) => {
    const label = name || id
    try {
      const { error } = await supabase.from(table).delete().eq('id', id)
      if (error) return { success: false, error: error.message }

      if (table === 'inventory')    setInventory(prev    => prev.filter(i => i.id !== id))
      if (table === 'pessoas')      setPessoas(prev      => prev.filter(p => p.id !== id))
      if (table === 'transactions') setTransactions(prev => prev.filter(t => t.id !== id))

      addToast(`🗑️ "${label}" removido de ${table}.`, 'success')
      return { success: true, deleted: label, table }
    } catch (e) {
      return { success: false, error: e.message }
    }
  }

  return {
    updateInventory,
    getSalesData,
    analyzeMarketOpportunity,
    findCustomer,
    createOrder,
    deleteRecord,
  }
}
