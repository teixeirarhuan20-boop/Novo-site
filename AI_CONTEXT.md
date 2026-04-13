# 🤖 AI_CONTEXT.md — Guia para IAs trabalhando neste projeto

Este arquivo deve ser lido **antes de qualquer alteração** no projeto.
Toda IA que fizer mudanças deve registrar o que fez no final deste arquivo.

---

## 📁 Estrutura do Projeto

```
meu-negocio-pro-v2/
├── src/
│   ├── App.jsx                  # Componente raiz — roteamento entre páginas via sidebar
│   ├── main.jsx                 # Entry point React
│   ├── index.css                # Estilos globais (variáveis CSS, utilitários)
│   ├── components/
│   │   ├── OrdersManager.jsx    # 🛒 Pedidos: formulário + leitura de etiqueta + mapa
│   │   ├── LabelAssistant.jsx   # 📦 Leitor de etiqueta (imagem via OCR/IA ou texto colado)
│   │   ├── HistoryManager.jsx   # 📜 Histórico de transações com filtros e paginação
│   │   ├── InventoryManager.jsx # 📦 Gestão de estoque (CRUD de produtos)
│   │   ├── StockInManager.jsx   # 🔁 Movimentações manuais de entrada/saída
│   │   ├── Dashboard.jsx        # 📊 Dashboard com gráficos e métricas
│   │   ├── PeopleManager.jsx    # 👥 CRM de clientes/fornecedores com curva ABC
│   │   ├── LeadsManager.jsx     # 🎯 Captura e gestão de leads
│   │   ├── SalesMap.jsx         # 🗺️ Mapa de vendas com Leaflet
│   │   ├── OutreachManager.jsx  # 📣 Geração de mensagens de outreach com IA
│   │   ├── SystemLogManager.jsx # 🔍 Log do sistema
│   │   ├── Sidebar.jsx          # Navegação lateral
│   │   ├── ChatInput.jsx        # Input do chat com Luna (IA vendedora)
│   │   ├── ChatMessage.jsx      # Bolha de mensagem do chat
│   │   ├── ConfigError.jsx      # Tela de erro de configuração (sem .env)
│   │   ├── ToastContainer.jsx   # Notificações toast
│   │   └── ProductLocationInsights.jsx  # Insights de localização de produtos
│   ├── lib/
│   │   ├── gemini.js            # ⭐ CENTRAL: toda comunicação com IA (Gemini + Groq)
│   │   └── supabase.js          # Cliente Supabase (banco de dados)
│   ├── hooks/
│   │   └── useToast.js          # Hook de notificações toast
│   └── utils/
│       ├── formatting.js        # formatCurrency, formatDate, normalizeText, generateId
│       └── location.js          # geocode, packLocation, unpackLocation, getProductColor, jitter
├── dist/                        # Build compilado (servir este para produção)
├── AI_CONTEXT.md                # ← Este arquivo
├── .env                         # Chaves de API (não commitado)
├── vite.config.js
└── package.json
```

---

## 🔑 Variáveis de Ambiente (`.env`)

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_GEMINI_API_KEY=...       # Gemini Vision + Text
VITE_GROQ_API_KEY=...         # Groq (fallback mais rápido)
```

---

## 🧠 Como funciona a leitura de etiquetas

**Fluxo completo:**

1. Usuário sobe imagem ou cola texto no `LabelAssistant`
2. Para imagem: tenta **Gemini Vision** → fallback **Groq Vision** → fallback **Tesseract OCR** + IA texto
3. Para texto: tenta **Groq texto** → fallback **Gemini texto**
4. A IA retorna JSON com os campos extraídos
5. `extractJson()` em `gemini.js` limpa e parseia o JSON
6. `handleLabelData()` em `OrdersManager.jsx` preenche os campos do formulário

**Campos extraídos da etiqueta:**
```js
{
  customerName,  // Nome do destinatário
  address,       // Rua + número + complemento (SEM cidade/estado)
  bairro,        // Bairro do destinatário
  cep,           // CEP com traço (ex: "04521-000")
  location,      // Apenas nome da cidade
  orderId,       // Código do pedido
  nf,            // Número da nota fiscal
  rastreio,      // Código de rastreio (BR..., JT..., LB...)
  modalidade,    // Tipo de envio (SEDEX, PAC, etc.)
  productName,   // Produto identificado no inventário
  quantity,      // Quantidade (padrão 1)
}
```

**Formato de armazenamento de transações (`itemName`):**
```
"NomeProduto ||cidade;lat;lng;pedido;nf;cep;endereco;bairro;rastreio;modalidade||"
```
Use `packLocation()` para criar e `unpackLocation()` para ler.

---

## 🗄️ Banco de Dados (Supabase)

**Tabelas:**
- `inventory` — produtos: `id, name, category, quantity, price, color`
- `transactions` — movimentações: `id, type (entrada|saída), itemId, itemName, city, quantity, unitPrice, totalValue, personName, date`
- `pessoas` — clientes/fornecedores: `id, name, document, role, contact, email, address, cep, city`

---

## ⚙️ Como fazer build

```bash
npm run build -- --outDir /caminho/fora/do/dist
# Depois copiar manualmente para dist/ (o dist/ original pode ter permissão restrita)
```

**Atenção:** A pasta `dist/` pode ter permissão somente leitura. Se `npm run build` falhar com `EPERM`, faça o build em outro diretório e copie.

---

## 📝 Histórico de Alterações

---

### [2026-04-13] — Correção de leitura de etiquetas e filtragem de dados

**Problema reportado:** Leitura de etiquetas não estava filtrando/extraindo dados corretamente.

**Causa raiz descoberta:** Praticamente todos os arquivos fonte (`src/`) estavam **truncados** (cortados no meio), o que impedia qualquer rebuild. O app rodava apenas pelo `dist/` antigo.

**Arquivos corrigidos (reconstruídos):**
- `src/App.jsx` — faltava fechar o painel de chat e o componente
- `src/main.jsx` — faltava `</React.StrictMode>` e `)`
- `src/vite.config.js` — faltava fechar o objeto `defineConfig`
- `src/package.json` — faltava `vite` nas devDependencies e fechamento do JSON
- `src/utils/formatting.js` — `generateId` truncada
- `src/utils/location.js` — função `jitter` ausente
- `src/lib/supabase.js` — `isSupabaseConfigured` truncado
- `src/hooks/useToast.js` — retorno do hook truncado
- Todos os componentes em `src/components/` — fechamentos JSX ausentes

**Bugs de lógica corrigidos:**

1. **`extractJson` em `gemini.js`** — Regex `(?<!\\)'` + `(\w+)'(\w+)` corrompía JSON com apóstrofos em nomes próprios. **Fix:** 3 tentativas em cascata: parse direto → normalização segura de aspas simples → extração regex campo a campo como fallback.

2. **`analyzeDocument` em `gemini.js`** — Descartava resultado se `customerName` fosse null, perdendo rastreio, CEP, pedido etc. **Fix:** Verifica se **qualquer** campo útil está presente antes de descartar.

3. **`LabelAssistant.jsx`** — Sem feedback visual após leitura. **Fix:** Adicionado estado `extractedData` + painel resumindo todos os campos extraídos com botão para fechar.

4. **`OrdersManager.jsx`** — Arquivo truncado antes de fechar a tabela "Últimas Vendas". **Fix:** Completado com `</tr>`, `</tbody>`, `</table>`, linha vazia e `<OrdersMap>`.

**Dependência externa corrigida:**
- `recharts/es6/util/getEveryNthWithCondition.js` estava vazio, causando erro de build. Implementada a função manualmente.

**Build:** ✅ `1102 modules transformed` com sucesso.

---

### [2026-04-13] — Correção de dependências Linux no package.json

**Problema:** `npm install` falhava no Windows com erro `EBADPLATFORM` para `@esbuild/linux-x64` e `@rollup/rollup-linux-x64-gnu`.

**Causa:** Durante o processo de build no sandbox Linux, foram instaladas manualmente dependências específicas de plataforma Linux (`@esbuild/linux-x64` e `@rollup/rollup-linux-x64-gnu`) que acabaram sendo salvas como dependências diretas no `package.json`. Essas dependências só existem no Linux e não podem ser instaladas no Windows.

**Fix:** Removidas as duas entradas do bloco `dependencies` no `package.json`. O `npm install` no Windows vai instalar automaticamente as versões corretas para Windows (`@esbuild/win32-x64`, etc.) como dependências opcionais internas do Vite.

**Arquivos alterados:** `package.json`

**⚠️ Atenção para IAs futuras:** Nunca adicione pacotes `@esbuild/linux-*` ou `@rollup/rollup-linux-*` como dependências diretas no `package.json`. Eles são instalados automaticamente pelo npm como `optionalDependencies` de acordo com a plataforma do usuário.
