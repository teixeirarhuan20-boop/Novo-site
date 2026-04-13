-- ============================================================
--  Meu Negócio Pro 2.0 — Supabase Setup
--  Execute este script no SQL Editor do Supabase
--  (Database > SQL Editor > New Query > Cole e clique em Run)
-- ============================================================

-- ─── 1. INVENTORY ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT '',
  quantity    NUMERIC NOT NULL DEFAULT 0,
  price       NUMERIC NOT NULL DEFAULT 0,
  cost        NUMERIC NOT NULL DEFAULT 0,
  color       TEXT NOT NULL DEFAULT '#6366f1',
  description TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 2. PESSOAS (Clientes / Fornecedores / Equipe) ───────────
CREATE TABLE IF NOT EXISTS pessoas (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  document TEXT NOT NULL DEFAULT '',        -- CPF / CNPJ
  role     TEXT NOT NULL DEFAULT 'cliente', -- cliente | fornecedor | equipe
  contact  TEXT NOT NULL DEFAULT '',
  notes    TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 3. TRANSACTIONS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,               -- 'entrada' | 'saída'
  item_id     TEXT REFERENCES inventory(id) ON DELETE SET NULL,
  -- itemName uses "smart string" format: "Name ||city;lat;lng;orderId;nf;...||"
  item_name   TEXT NOT NULL DEFAULT '',
  city        TEXT NOT NULL DEFAULT '',
  quantity    NUMERIC NOT NULL DEFAULT 0,
  unit_price  NUMERIC NOT NULL DEFAULT 0,
  total_value NUMERIC NOT NULL DEFAULT 0,
  person_name TEXT NOT NULL DEFAULT '',
  date        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 4. ROW LEVEL SECURITY ───────────────────────────────────
-- Habilita RLS em todas as tabelas
ALTER TABLE inventory    ENABLE ROW LEVEL SECURITY;
ALTER TABLE pessoas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Políticas abertas (sem autenticação) — ideal para MVP
-- Se você adicionar auth, troque estas políticas por políticas baseadas em usuário

CREATE POLICY "Allow all inventory"    ON inventory    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all pessoas"      ON pessoas      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all transactions" ON transactions FOR ALL USING (true) WITH CHECK (true);

-- ─── 5. REALTIME ─────────────────────────────────────────────
-- Habilita publicação realtime nas 3 tabelas
ALTER PUBLICATION supabase_realtime ADD TABLE inventory;
ALTER PUBLICATION supabase_realtime ADD TABLE pessoas;
ALTER PUBLICATION supabase_realtime ADD TABLE transactions;

-- ─── 6. ÍNDICES OPCIONAIS (performance) ──────────────────────
CREATE INDEX IF NOT EXISTS idx_transactions_type       ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_item_id    ON transactions(item_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_name          ON inventory(name);
CREATE INDEX IF NOT EXISTS idx_pessoas_role            ON pessoas(role);

-- ─── PRONTO! ─────────────────────────────────────────────────
-- Após executar este script:
-- 1. Copie a URL do projeto e a "Chave publicável" (anon key) do painel
--    Supabase > Project Settings > API
-- 2. Configure as variáveis de ambiente no Vercel:
--    VITE_SUPABASE_URL       = https://xxxx.supabase.co
--    VITE_SUPABASE_ANON_KEY  = sb_publishable_xxxxxxxxxxxx
--    VITE_GEMINI_API_KEY     = AIzaSy...
--    VITE_GROQ_API_KEY       = gsk_... (opcional, usado como fallback)
