# Meu Negócio Pro — Guia para IAs

Este arquivo existe para que qualquer IA (Claude, GPT, Gemini, etc.) consiga entender o projeto completo sem precisar explorar cada arquivo do zero. Mantenha-o atualizado após mudanças grandes.

---

## Visão geral

**Meu Negócio Pro** é um sistema de gestão empresarial completo, feito para um negócio de venda de produtos (principalmente vidros, peças e outros itens). Inclui controle de estoque, pedidos, clientes, leads, prospecção, scanner de etiquetas com IA, e uma assistente virtual chamada Luna.

- **Stack:** React 19 + Vite 5, sem TypeScript
- **Banco de dados:** Supabase (PostgreSQL + Realtime)
- **IA:** Google Gemini (via `@google/generative-ai`) + Tesseract.js (OCR local) + jsQR (leitura de QR)
- **Deploy:** Vercel (GitHub: `teixeirarhuan20-boop/Novo-site`, branch `main`)
- **Geocodificação:** Nominatim (OpenStreetMap), gratuito
- **Gráficos:** Recharts

---

## Variáveis de ambiente (.env)

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_GEMINI_API_KEY=...
VITE_GROQ_API_KEY=...   (opcional, não usado ativamente)
```

Se qualquer uma das três primeiras faltar, o app mostra `<ConfigError />` no lugar de tudo.

---

## Estrutura de pastas

```
src/
  App.jsx                    # Componente raiz, estado global, roteamento por aba
  main.jsx                   # Entry point React
  index.css                  # Estilos globais (CSS variables, layout, classes utilitárias)
  App.css                    # Estilos adicionais

  lib/
    supabase.js              # Cliente Supabase (retorna null se não configurado)
    gemini.js                # sendMessageToGemini, analyzeText, analyzeDocument, LUNA_SYSTEM
    lunaTools.js             # Ferramentas (function calling) da Luna + createToolExecutor

  utils/
    formatting.js            # formatCurrency, formatDate, normalizeText, generateId
    location.js              # geocode (Nominatim), packLocation, unpackLocation
    exportReport.js          # Export de relatórios (PDF/CSV)

  hooks/
    useToast.js              # Hook de notificações toast (addToast, toasts, removeToast)

  components/
    Sidebar.jsx              # Navegação lateral com todas as abas
    ToastContainer.jsx       # Exibe notificações flutuantes
    ConfigError.jsx          # Tela de erro quando .env não está configurado
    Dashboard.jsx            # Aba de visão geral com KPIs e gráficos
    InventoryManager.jsx     # CRUD de estoque
    OrdersManager.jsx        # Pedidos + BatchScanner embutido
    BatchScanner.jsx         # Scanner de etiquetas em lote (principal componente de IA)
    StockInManager.jsx       # Entradas de estoque
    PeopleManager.jsx        # CRM de clientes/fornecedores/funcionários
    HistoryManager.jsx       # Histórico de transações
    SalesMap.jsx             # Mapa geográfico de vendas (Leaflet)
    SystemLogManager.jsx     # Log de erros do sistema
    LeadsManager.jsx         # Leads capturados pelo chat da Luna
    OutreachManager.jsx      # Abordagem via Ana (envio de mensagens/propostas)
    QRCodeManager.jsx        # Geração e impressão de QR Codes de produtos
    ProspeccaoManager.jsx    # Pesquisa de leads externos para prospecção
    GlassManager.jsx         # Gestão de vidros (tabela de tipos/medidas)
    PartsManager.jsx         # Gestão de peças
    AnaBatchFlow.jsx         # Fluxo de abordagem em lote (Ana)
    ChatInput.jsx            # Input do chat da Luna (suporta imagem)
    ChatMessage.jsx          # Renderização de mensagem do chat (markdown + cards)
    LabelAssistant.jsx       # Assistente de etiqueta individual (legado)
    ProductLocationInsights.jsx # Insights de produto por localização
    SimpleStockManager.jsx   # Versão simplificada de estoque
```

> **Atenção:** existe um diretório duplicado `src/src/` com arquivos antigos. Ignorar — o código real está diretamente em `src/`.

---

## Roteamento (sem React Router)

O roteamento é feito por estado `activeTab` em `App.jsx`. A `Sidebar` emite `onTabChange(id)` e o `renderTab()` retorna o componente correto.

**Abas disponíveis:**
| id | Componente | Descrição |
|---|---|---|
| `dashboard` | Dashboard | KPIs, gráficos de vendas |
| `mapa` | SalesMap | Mapa geográfico de vendas |
| `pedidos` | OrdersManager | Pedidos com BatchScanner |
| `qrcodes` | QRCodeManager | Gerar QR Codes |
| `entrada` | StockInManager | Entrada de estoque |
| `estoque` | InventoryManager | CRUD de estoque |
| `vidros` | GlassManager | Tabela de vidros |
| `pecas` | PartsManager | Tabela de peças |
| `pessoas` | PeopleManager | CRM |
| `historico` | HistoryManager | Transações |
| `logs` | SystemLogManager | Erros |
| `leads` | LeadsManager | Leads do chat |
| `abordagem` | OutreachManager | Ana — abordagem |
| `prospeccao` | ProspeccaoManager | Prospecção de leads |

---

## Estado global (App.jsx)

Todos os dados vivem em `App.jsx` e são passados como props:

```js
inventory        // array — produtos do estoque
transactions     // array — histórico de vendas/entradas
pessoas          // array — clientes, fornecedores, funcionários
leads            // array — leads capturados pelo chat
outreachLeads    // array — leads enviados para a Ana
prospectionLeads // array — leads da prospecção externa
vidros           // array — tabela de vidros
pecas            // array — tabela de peças
```

Realtime do Supabase atualiza `inventory`, `pessoas`, `transactions`, `vidros`, `pecas` automaticamente.

---

## Banco de dados (Supabase)

**Projeto:** "Estoque TXR" — ID: `genlixicbdicppgznapw`

**Tabelas principais:**

| Tabela | Campos relevantes |
|---|---|
| `inventory` | `id, name, quantity, price, category` |
| `transactions` | `id, type (entrada/saída), itemId, itemName, quantity, unitPrice, totalValue, personName, city, date` |
| `pessoas` | `id, name, document, role (cliente/fornecedor/funcionário), contact` |
| `vidros` | `id, nome, ...` |
| `pecas` | `id, nome, ...` |

**itemName especial:** O campo `itemName` em `transactions` carrega dados de localização empacotados:
```
"Nome do Produto ||cidade;lat;lng;orderId;nf;cep;endereço;bairro;rastreio;modalidade||"
```
Use `packLocation()` para criar e `unpackLocation()` para ler.

---

## BatchScanner — componente principal de IA

Arquivo: `src/components/BatchScanner.jsx`

É o componente mais complexo do sistema. Funcionalidades:

1. **Câmera** — captura foto de etiqueta, processa com Tesseract.js (OCR) e Gemini Vision
2. **Drag & drop** — arrastar múltiplas imagens de etiquetas, processadas **sequencialmente** em fila
3. **Fila de processamento** — implementada com `useRef` + `while` loop para evitar stale closure:
   ```js
   const queueRef = useRef([])
   const isProcessingRef = useRef(false)
   const processLabelImgRef = useRef(null)  // sempre aponta para versão atual
   const startQueue = useRef(async () => { while(...) { ... } }).current
   ```
4. **ProductSearch** — input de busca de produto com dropdown, usado tanto nos cards individuais quanto no seletor em lote
5. **Seleção em lote** — checkbox em cada card + barra de atribuição em lote com `ProductSearch`
6. **Toolbar sticky** — `position: sticky; top: 0; zIndex: 10` para ficar visível ao rolar

**Sub-componentes internos:**
- `QrScannerModal` — câmera para ler QR Code em tempo real (jsQR)
- `CameraModal` — câmera para capturar foto de etiqueta
- `ProductSearch({ inventory, onSelect, placeholder })` — busca digitável com dropdown
- `OrderCard` — card de um pedido na fila

---

## Luna — Assistente Virtual

Arquivo: `src/lib/gemini.js` + `src/lib/lunaTools.js`

- Usa Google Gemini com **function calling** (ferramentas)
- Ferramentas disponíveis: buscar estoque, registrar venda, cadastrar cliente, etc.
- O histórico de mensagens é mantido em `App.jsx` como array `messages`
- Suporta envio de imagem (base64) junto com a mensagem

---

## Padrões de código

- **IDs:** gerados com `generateId()` = `Date.now() + random`
- **Datas:** `formatDate()` retorna string `"DD/MM/YYYY às HH:MM:SS"`
- **Moeda:** `formatCurrency(value)` formata em BRL
- **CSS:** sem Tailwind — usa classes globais (`btn`, `btn-primary`, `btn-secondary`, `btn-sm`, `card`) definidas em `index.css` + CSS variables (`--bg`, `--bg-card`, `--border`, `--text`, `--text-muted`, `--success`)
- **Estilo inline:** padrão React inline styles para componentes
- **Sem TypeScript** — apenas JSX puro
- **Hooks:** `useState`, `useEffect`, `useCallback`, `useRef` — sem bibliotecas de estado externas

---

## Erros comuns e soluções

| Problema | Solução |
|---|---|
| `\!==` em vez de `!==` | Python heredoc escapa `!`. Usar ferramenta `Edit` para corrigir |
| Arquivo truncado ao usar Python append | Nunca usar Python para escrever arquivos grandes — usar ferramenta `Write` ou `Edit` diretamente |
| `.git/index.lock` impede `git restore` | Usar `git show HEAD:<arquivo>` para ler e reescrever |
| Stale closure em callback recursivo | Usar `useRef` com `while` loop em vez de `useCallback` recursivo |
| `src/src/` com arquivos antigos | Ignorar — código real está em `src/` (raiz) |

---

## Como rodar localmente

```bash
cd <pasta do projeto>
npm install
npm run dev     # http://localhost:5173
```

Precisa de `.env` com as 3 variáveis (SUPABASE_URL, SUPABASE_ANON_KEY, GEMINI_API_KEY).

---

## Deploy

Push para `main` no GitHub → Vercel faz build automático.
Build command: `npm run build` | Output: `dist/`
