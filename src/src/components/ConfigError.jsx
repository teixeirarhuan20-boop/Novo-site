import React from 'react'

export function ConfigError() {
  const hasSupabase = Boolean(
    import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
  )
  const hasGemini = Boolean(import.meta.env.VITE_GEMINI_API_KEY)

  return (
    <div className="config-error">
      <div className="config-error-box">
        <h1>⚠️ Configuração Pendente</h1>
        <p>
          As chaves de API necessárias não foram encontradas.
          Configure as variáveis de ambiente no painel da Vercel ou no arquivo <code>.env</code> local.
        </p>
        <div className="config-error-vars">
          {!hasSupabase && (
            <>
              <div>❌ VITE_SUPABASE_URL</div>
              <div>❌ VITE_SUPABASE_ANON_KEY</div>
            </>
          )}
          {!hasGemini && <div>❌ VITE_GEMINI_API_KEY</div>}
        </div>
        <p style={{ marginTop: '1rem', fontSize: '0.8rem' }}>
          Consulte o arquivo <code>.env.example</code> para referência.
        </p>
      </div>
    </div>
  )
}
