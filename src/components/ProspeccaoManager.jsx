import React, { useState, useRef, useEffect } from 'react'
import { generateProspectionOutreach } from '../lib/gemini'

// ─── Constantes ───────────────────────────────────────────────────────────────
const ESTADOS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
  'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
]

const SEGMENTOS = [
  'loja de decoração',
  'casa e decoração',
  'presentes e decoração',
  'loja de móveis e decoração',
  'artesanato e decoração',
  'bazar e decoração',
  'loja de flores e decoração',
  'loja de utensílios domésticos',
  'loja de festas e decoração',
  'design de interiores',
  'papelaria e presentes',
  'loja de enxoval e decoração',
  'home decor',
  'gift shop',
]

const STATUS_OPTS = [
  { value: 'novo',        label: '🆕 Novo',        color: '#3b82f6' },
  { value: 'em_contato',  label: '📞 Em Contato',  color: '#f59e0b' },
  { value: 'respondeu',   label: '💬 Respondeu',   color: '#8b5cf6' },
  { value: 'fechado',     label: '✅ Fechado',      color: '#10b981' },
  { value: 'sem_retorno', label: '❌ Sem Retorno', color: '#6b7280' },
]

const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_PLACES_API_KEY || ''

// ─── Helpers ──────────────────────────────────────────────────────────────────
function cnpjMask(v = '') {
  return v.replace(/\D/g, '').slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

function whatsappUrl(phone) {
  const d = (phone || '').replace(/\D/g, '')
  const num = d.startsWith('55') ? d : `55${d}`
  return `https://wa.me/${num}`
}

function mapsUrl(name, address) {
  return `https://www.google.com/maps/search/${encodeURIComponent(`${name} ${address}`)}`
}

function igSearchUrl(name) {
  const slug = name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
  return `https://www.instagram.com/${slug}/`
}

// ─── Mapeamento segmento → tags OSM ──────────────────────────────────────────
const OSM_SHOP_TAGS = {
  'loja de decoração':          ['interior_decoration','gift','furniture','craft','houseware'],
  'casa e decoração':           ['interior_decoration','furniture','houseware','homeware'],
  'presentes e decoração':      ['gift','interior_decoration','craft'],
  'loja de móveis e decoração': ['furniture','interior_decoration'],
  'artesanato e decoração':     ['craft','interior_decoration','gift'],
  'bazar e decoração':          ['variety_store','gift','interior_decoration','second_hand'],
  'loja de flores e decoração': ['florist','interior_decoration'],
  'loja de utensílios domésticos': ['houseware','hardware','kitchen'],
  'loja de festas e decoração': ['party','gift','interior_decoration'],
  'design de interiores':       ['interior_decoration'],
  'papelaria e presentes':      ['stationery','gift'],
  'loja de enxoval e decoração':['interior_decoration','furniture','houseware'],
  'home decor':                 ['interior_decoration','furniture','houseware'],
  'gift shop':                  ['gift','interior_decoration'],
}

// Palavras-chave PT para busca por nome no OSM
const OSM_NAME_KEYWORDS = {
  'loja de decoração':          'decor|decoraç',
  'presentes e decoração':      'presente|gift|decor',
  'artesanato e decoração':     'artesanat|decor',
  'loja de flores e decoração': 'flor|decor',
  'loja de festas e decoração': 'fest|balão|decor',
  'design de interiores':       'interior|decor|design',
  'papelaria e presentes':      'papelaria|presente',
}

function osmToLead(el, estado, cidade) {
  const t = el.tags || {}
  const phone = t.phone || t['contact:phone'] || t['contact:mobile'] || ''
  const phoneFmt = phone.replace(/[^\d+\s()-]/g, '').trim()
  const addr = [
    t['addr:street'] && `${t['addr:street']}${t['addr:housenumber'] ? ', '+t['addr:housenumber'] : ''}`,
    t['addr:suburb'] || t['addr:neighbourhood'],
  ].filter(Boolean).join(' — ')

  return {
    id: `osm_${el.type}_${el.id}`,
    nome: t.name || t['name:pt'] || 'Sem nome',
    endereco: addr,
    cidade: t['addr:city'] || cidade || '',
    estado: t['addr:state'] || estado,
    cep: t['addr:postcode'] || '',
    telefone: phoneFmt,
    whatsapp: phoneFmt,
    email: t.email || t['contact:email'] || '',
    site: t.website || t['contact:website'] || t.url || '',
    instagram: t['contact:instagram'] || t.instagram || '',
    cnpj: '',
    cpf: '',
    rating: null,
    ratingCount: 0,
    tipo_busca: 'openstreetmap',
    status: 'novo',
    addedAt: new Date().toISOString(),
    atividade: t.shop || t.amenity || t.craft || '',
    situacao: '',
    notes: '',
    _lat: el.lat || el.center?.lat,
    _lon: el.lon || el.center?.lon,
  }
}

// ─── Endpoints Overpass com fallback automático ───────────────────────────────
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

async function fetchOverpass(query, timeoutMs = 20000) {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (res.ok) return await res.json()
    } catch {
      // tenta próximo endpoint
    }
  }
  throw new Error('Todos os servidores OpenStreetMap estão ocupados. Tente novamente em alguns segundos.')
}

// ─── Busca via OpenStreetMap (Overpass) — sem chave ───────────────────────────
async function searchOverpass(keyword, estado, cidade) {
  // 1) Geocodificar com Nominatim
  const locationQuery = cidade ? `${cidade}, ${estado}, Brazil` : `${estado}, Brazil`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  let nomData = []
  try {
    const nomRes = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationQuery)}&format=json&limit=1&accept-language=pt`,
      { headers: { 'User-Agent': 'MeuNegocioPro/1.0' }, signal: controller.signal }
    )
    nomData = await nomRes.json()
  } catch {
    throw new Error(`Não foi possível localizar "${locationQuery}". Verifique a cidade e tente novamente.`)
  } finally {
    clearTimeout(timer)
  }

  if (!nomData.length) throw new Error(`Local "${locationQuery}" não encontrado. Tente outro nome de cidade.`)

  const bb   = nomData[0].boundingbox           // [south, north, west, east]
  const s    = parseFloat(bb[0])
  const n    = parseFloat(bb[1])
  const w    = parseFloat(bb[2])
  const e    = parseFloat(bb[3])

  // 2) Reduz bounding box se muito grande (ex.: estado inteiro → limita a ~100km²)
  const latSpan = n - s
  const lonSpan = e - w
  const maxSpan = 1.2  // ~130 km
  const midLat  = (s + n) / 2
  const midLon  = (w + e) / 2
  const clampedS = latSpan > maxSpan ? midLat - maxSpan / 2 : s
  const clampedN = latSpan > maxSpan ? midLat + maxSpan / 2 : n
  const clampedW = lonSpan > maxSpan ? midLon - maxSpan / 2 : w
  const clampedE = lonSpan > maxSpan ? midLon + maxSpan / 2 : e
  const bbox = `${clampedS},${clampedW},${clampedN},${clampedE}`

  // 3) Query enxuta — apenas nodes e ways (sem relations) para ser mais rápida
  const shopTags = (OSM_SHOP_TAGS[keyword] || []).join('|') || 'interior_decoration|gift|furniture|craft'

  const query = `[out:json][timeout:25];
(
  node["shop"~"${shopTags}",i](${bbox});
  way["shop"~"${shopTags}",i](${bbox});
);
out center 30;`

  // 4) Chamar Overpass com fallback entre endpoints
  const ovData = await fetchOverpass(query, 25000)

  // 5) Converter e deduplicar por nome
  const seen = new Set()
  return (ovData.elements || [])
    .map(el => osmToLead(el, estado, cidade))
    .filter(l => l.nome !== 'Sem nome')
    .filter(l => {
      const key = l.nome.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

// ─── Google Places API ────────────────────────────────────────────────────────
async function searchGooglePlaces(query, estado, cidade) {
  const textQuery = cidade
    ? `${query} em ${cidade}, ${estado}, Brasil`
    : `${query} em ${estado}, Brasil`

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.nationalPhoneNumber',
        'places.websiteUri',
        'places.rating',
        'places.userRatingCount',
        'places.businessStatus',
        'places.types',
      ].join(','),
    },
    body: JSON.stringify({
      textQuery,
      languageCode: 'pt-BR',
      regionCode: 'BR',
      maxResultCount: 20,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Erro ${res.status}`)
  }

  const data = await res.json()
  return (data.places || []).map(p => ({
    id: p.id || crypto.randomUUID(),
    nome: p.displayName?.text || 'Sem nome',
    endereco: p.formattedAddress || '',
    cidade: (p.formattedAddress || '').split(',').slice(-3, -2)[0]?.trim() || '',
    estado,
    telefone: p.nationalPhoneNumber || '',
    whatsapp: p.nationalPhoneNumber || '',
    site: p.websiteUri || '',
    rating: p.rating || null,
    ratingCount: p.userRatingCount || 0,
    tipo_busca: 'google_places',
    status: 'novo',
    addedAt: new Date().toISOString(),
    instagram: '',
    email: '',
    cnpj: '',
    cpf: '',
    cep: '',
    atividade: '',
    situacao: '',
    notes: '',
  }))
}

// ─── BrasilAPI CNPJ ───────────────────────────────────────────────────────────
async function searchCNPJ(cnpjRaw) {
  const digits = cnpjRaw.replace(/\D/g, '')
  if (digits.length !== 14) throw new Error('CNPJ deve ter 14 dígitos')
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`)
  if (!res.ok) throw new Error('CNPJ não encontrado na Receita Federal')
  const d = await res.json()
  const fmt = (ddd = '') => {
    const s = ddd.replace(/\D/g, '')
    if (s.length >= 10) return `(${s.slice(0,2)}) ${s.slice(2,6)}-${s.slice(6)}`
    return ddd
  }
  const tel = fmt(d.ddd_telefone_1) || fmt(d.ddd_telefone_2) || ''
  const addr = [d.logradouro, d.numero, d.complemento, d.bairro].filter(Boolean).join(', ')
  return {
    id: crypto.randomUUID(),
    nome: d.razao_social || d.nome_fantasia || 'Sem nome',
    cnpj: cnpjMask(digits),
    email: d.email || '',
    telefone: tel,
    whatsapp: tel,
    endereco: addr,
    cidade: d.municipio || '',
    estado: d.uf || '',
    cep: d.cep || '',
    site: '',
    instagram: '',
    cpf: '',
    rating: null,
    ratingCount: 0,
    tipo_busca: 'cnpj',
    status: 'novo',
    addedAt: new Date().toISOString(),
    atividade: d.cnae_fiscal_descricao || '',
    situacao: d.descricao_situacao_cadastral || '',
    notes: '',
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// CARD DE LEAD — sempre expandido, edição inline de notas
// ═════════════════════════════════════════════════════════════════════════════
function LeadCard({ lead, saved, onSave, onRemove, onAI, onSendToAna, onStatusChange, onNoteChange }) {
  const phone = lead.telefone || lead.whatsapp || ''
  const statusInfo = STATUS_OPTS.find(s => s.value === (lead.status || 'novo')) || STATUS_OPTS[0]

  const ContactBtn = ({ href, icon, label, color }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3rem',
        padding: '0.35rem 0.65rem',
        borderRadius: '6px',
        fontSize: '0.78rem',
        fontWeight: 600,
        textDecoration: 'none',
        background: color || 'var(--surface-3)',
        color: color ? '#fff' : 'var(--text)',
        border: '1px solid transparent',
        whiteSpace: 'nowrap',
      }}
    >
      {icon} {label}
    </a>
  )

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderLeft: `4px solid ${statusInfo.color}`,
      borderRadius: 'var(--radius)',
      padding: '1rem 1.1rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.75rem',
    }}>
      {/* ── Linha 1: Nome + badges ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: '1rem' }}>{lead.nome}</span>
            {lead.rating && (
              <span style={{ fontSize: '0.75rem', color: '#f59e0b', fontWeight: 600 }}>
                ⭐ {lead.rating.toFixed(1)}{lead.ratingCount ? ` (${lead.ratingCount})` : ''}
              </span>
            )}
            <span style={{
              fontSize: '0.68rem', background: 'var(--surface-2)', padding: '0.1rem 0.45rem',
              borderRadius: '999px', color: 'var(--text-faint)', border: '1px solid var(--border)',
            }}>
              {lead.tipo_busca === 'google_places' ? '🗺️ Google' : lead.tipo_busca === 'openstreetmap' ? '🗺️ OpenStreetMap' : lead.tipo_busca === 'cnpj' ? '🏢 CNPJ' : '✍️ Manual'}
            </span>
            {lead.situacao && lead.situacao !== 'ATIVA' && (
              <span style={{ fontSize: '0.68rem', color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '0.1rem 0.45rem', borderRadius: '999px' }}>
                ⚠️ {lead.situacao}
              </span>
            )}
          </div>

          {/* Atividade / segmento */}
          {lead.atividade && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              🏷️ {lead.atividade}
            </div>
          )}
        </div>

        {/* Status selector */}
        {onStatusChange && (
          <select
            value={lead.status || 'novo'}
            onChange={e => onStatusChange(e.target.value)}
            style={{
              fontSize: '0.75rem', padding: '0.25rem 0.5rem', borderRadius: '6px',
              border: `1px solid ${statusInfo.color}`, background: 'var(--surface-2)',
              color: statusInfo.color, cursor: 'pointer', fontWeight: 600, flexShrink: 0,
            }}
          >
            {STATUS_OPTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        )}
      </div>

      {/* ── Linha 2: Endereço e dados ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: '0.4rem 1rem',
        fontSize: '0.82rem',
        color: 'var(--text-muted)',
      }}>
        {lead.endereco && (
          <div><span style={{ color: 'var(--text-faint)' }}>📍</span> {lead.endereco}</div>
        )}
        {(lead.cidade || lead.estado) && (
          <div><span style={{ color: 'var(--text-faint)' }}>🏙️</span> {[lead.cidade, lead.estado].filter(Boolean).join(' — ')}</div>
        )}
        {lead.cep && (
          <div><span style={{ color: 'var(--text-faint)' }}>📮</span> CEP {lead.cep}</div>
        )}
        {lead.cnpj && (
          <div><span style={{ color: 'var(--text-faint)' }}>🏢</span> {lead.cnpj}</div>
        )}
        {lead.cpf && (
          <div><span style={{ color: 'var(--text-faint)' }}>🪪</span> {lead.cpf}</div>
        )}
        {lead.email && (
          <div><span style={{ color: 'var(--text-faint)' }}>📧</span> {lead.email}</div>
        )}
        {phone && (
          <div><span style={{ color: 'var(--text-faint)' }}>📞</span> {phone}</div>
        )}
        {lead.site && (
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ color: 'var(--text-faint)' }}>🌐</span>{' '}
            <a href={lead.site.startsWith('http') ? lead.site : `https://${lead.site}`} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>
              {lead.site.replace(/^https?:\/\//, '').replace(/\/$/, '')}
            </a>
          </div>
        )}
        {lead.instagram && (
          <div>
            <span style={{ color: 'var(--text-faint)' }}>📷</span>{' '}
            <a
              href={lead.instagram.startsWith('http') ? lead.instagram : `https://instagram.com/${lead.instagram.replace('@', '')}`}
              target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}
            >
              {lead.instagram.startsWith('@') ? lead.instagram : `@${lead.instagram}`}
            </a>
          </div>
        )}
      </div>

      {/* ── Linha 3: Botões de contato ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
        {phone && (
          <>
            <ContactBtn href={`tel:${phone.replace(/\D/g,'')}`} icon="📞" label="Ligar" />
            <ContactBtn href={whatsappUrl(phone)} icon="💬" label="WhatsApp" color="#25d366" />
          </>
        )}
        {lead.email && (
          <ContactBtn href={`mailto:${lead.email}`} icon="📧" label="E-mail" />
        )}
        {lead.site && (
          <ContactBtn
            href={lead.site.startsWith('http') ? lead.site : `https://${lead.site}`}
            icon="🌐" label="Site"
          />
        )}
        {lead.instagram ? (
          <ContactBtn
            href={lead.instagram.startsWith('http') ? lead.instagram : `https://instagram.com/${lead.instagram.replace('@','')}`}
            icon="📷" label="Instagram" color="#e1306c"
          />
        ) : (
          <ContactBtn href={igSearchUrl(lead.nome)} icon="📷" label="Buscar no Instagram" />
        )}
        <ContactBtn href={mapsUrl(lead.nome, lead.endereco)} icon="🗺️" label="Ver no Maps" />
        {lead.cnpj && (
          <ContactBtn
            href={`https://www.google.com/search?q=cnpj+${lead.cnpj.replace(/\D/g,'')}`}
            icon="🏢" label="Pesquisar CNPJ"
          />
        )}
      </div>

      {/* ── Linha 4: Observações editáveis ── */}
      <div>
        <label style={{ fontSize: '0.75rem', color: 'var(--text-faint)', display: 'block', marginBottom: '0.3rem' }}>
          📝 Observações
        </label>
        <textarea
          placeholder="Anote informações sobre este lead: interesse, histórico de contato, produto sugerido..."
          value={lead.notes || ''}
          onChange={e => onNoteChange?.(e.target.value)}
          rows={2}
          style={{
            width: '100%',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            padding: '0.5rem 0.65rem',
            fontSize: '0.82rem',
            color: 'var(--text)',
            resize: 'vertical',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* ── Linha 5: Ações ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', paddingTop: '0.1rem', borderTop: '1px solid var(--border)' }}>
        <button className="btn btn-primary btn-sm" onClick={onAI}>
          🤖 Gerar Abordagem IA
        </button>
        {!saved && onSave && (
          <button className="btn btn-secondary btn-sm" onClick={onSave}>
            💾 Salvar Lead
          </button>
        )}
        {saved && onSendToAna && (
          <button className="btn btn-success btn-sm" onClick={onSendToAna}>
            📤 Enviar p/ Ana (Abordagem)
          </button>
        )}
        {saved && onRemove && (
          <button className="btn btn-danger btn-sm" style={{ marginLeft: 'auto' }} onClick={onRemove}>
            🗑️ Remover
          </button>
        )}
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═════════════════════════════════════════════════════════════════════════════
export function ProspeccaoManager({ addToast, onSendToAna, inventory, leads = [], setLeads = () => {} }) {
  const [mode,      setMode]      = useState('places')
  const [segmento,  setSegmento]  = useState('loja de decoração')
  const [segCustom, setSegCustom] = useState('')
  const [estado,    setEstado]    = useState('SP')
  const [cidade,    setCidade]    = useState('')
  const [cnpjInput, setCnpjInput] = useState('')
  const [manual,    setManual]    = useState({
    nome:'', telefone:'', whatsapp:'', email:'', instagram:'', site:'',
    cnpj:'', cpf:'', endereco:'', cidade:'', estado:'SP', cep:'', notes:''
  })

  const [loading,   setLoading]   = useState(false)
  const [results,     setResults]     = useState([])   // resultados da busca atual
  const [resultNotes, setResultNotes] = useState({})   // notas temporárias dos resultados
  const [tab,         setTab]         = useState('busca')

  // ── Chat IA ──────────────────────────────────────────────────────────────
  const [selectedLead, setSelectedLead] = useState(null)
  const [chatHistory,  setChatHistory]  = useState([
    { role:'bot', text:'Olá! Sou a **Ana**, especialista em prospecção de decoração. 🎨\n\nPosso gerar mensagens personalizadas para WhatsApp, Instagram, e-mail, ou te dar dicas de como abordar cada tipo de cliente.\n\nEscolha um lead e clique em "Gerar Abordagem IA", ou me faça uma pergunta!' }
  ])
  const [chatInput,    setChatInput]    = useState('')
  const [chatLoading,  setChatLoading]  = useState(false)
  const chatEndRef = useRef(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory])

  // ── Busca principal (Google Places com fallback automático para OpenStreetMap) ──
  const handlePlacesSearch = async () => {
    const keyword = segCustom.trim() || segmento
    setLoading(true)
    setResults([])
    setResultNotes({})
    try {
      let data

      // Tenta Google Places se tiver chave; se falhar cai no Overpass
      if (GOOGLE_KEY) {
        try {
          data = await searchGooglePlaces(keyword, estado, cidade)
        } catch {
          addToast('Google Places indisponível — usando OpenStreetMap.', 'warning')
          data = await searchOverpass(keyword, estado, cidade)
        }
      } else {
        data = await searchOverpass(keyword, estado, cidade)
      }

      setResults(data)
      if (data.length === 0) addToast('Nenhum resultado. Tente outra cidade ou segmento.', 'warning')
      else addToast(`✅ ${data.length} leads encontrados!`, 'success')
    } catch (e) {
      addToast('Erro na busca: ' + e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // ── Busca CNPJ ───────────────────────────────────────────────────────────
  const handleCnpjSearch = async () => {
    setLoading(true)
    setResults([])
    setResultNotes({})
    try {
      const lead = await searchCNPJ(cnpjInput)
      setResults([lead])
      addToast('Empresa encontrada!', 'success')
    } catch (e) {
      addToast('Erro: ' + e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // ── Adicionar manual ─────────────────────────────────────────────────────
  const handleManualAdd = () => {
    if (!manual.nome.trim()) { addToast('Informe o nome do lead.', 'warning'); return }
    const lead = { ...manual, id: crypto.randomUUID(), tipo_busca: 'manual', status: 'novo', addedAt: new Date().toISOString() }
    setLeads(prev => [lead, ...prev])
    setManual({ nome:'', telefone:'', whatsapp:'', email:'', instagram:'', site:'', cnpj:'', cpf:'', endereco:'', cidade:'', estado:'SP', cep:'', notes:'' })
    addToast('Lead adicionado!', 'success')
    setTab('leads')
  }

  // ── Salvar resultado como lead ────────────────────────────────────────────
  const saveResult = (r) => {
    if (leads.find(l => l.id === r.id)) { addToast('Lead já salvo.', 'warning'); return }
    const withNotes = { ...r, notes: resultNotes[r.id] || r.notes || '' }
    setLeads(prev => [withNotes, ...prev])
    addToast(`"${r.nome}" salvo!`, 'success')
  }

  const saveAll = () => {
    const novos = results.filter(r => !leads.find(l => l.id === r.id))
    novos.forEach(r => {
      setLeads(prev => [{ ...r, notes: resultNotes[r.id] || '' }, ...prev])
    })
    addToast(`${novos.length} leads salvos!`, 'success')
    setTab('leads')
  }

  // ── Ações nos leads salvos ────────────────────────────────────────────────
  const removeLead      = (id) => setLeads(prev => prev.filter(l => l.id !== id))
  const updateStatus    = (id, status) => setLeads(prev => prev.map(l => l.id === id ? { ...l, status } : l))
  const updateNote      = (id, notes)  => setLeads(prev => prev.map(l => l.id === id ? { ...l, notes } : l))
  const updateResultNote = (id, notes) => setResultNotes(prev => ({ ...prev, [id]: notes }))

  const sendToAna = (lead) => {
    onSendToAna?.(lead)
    updateStatus(lead.id, 'em_contato')
    addToast(`"${lead.nome}" enviado para Abordagem!`, 'success')
  }

  // ── IA Chat ───────────────────────────────────────────────────────────────
  const quickAI = (lead) => {
    setSelectedLead(lead)
    setTab('ia')
    const msg = `Gere uma mensagem de WhatsApp para abordar a empresa "${lead.nome}"${lead.atividade ? `, que atua em ${lead.atividade}` : ''}${lead.cidade ? `, em ${lead.cidade}/${lead.estado}` : ''}. Quero oferecer meus itens de decoração.`
    setChatInput(msg)
  }

  const sendChat = async () => {
    const msg = chatInput.trim()
    if (!msg || chatLoading) return
    const userMsg = { role: 'user', text: msg }
    const history = [...chatHistory, userMsg]
    setChatHistory(history)
    setChatInput('')
    setChatLoading(true)
    try {
      const ctx = selectedLead
        ? `Lead ativo: ${selectedLead.nome} | Atividade: ${selectedLead.atividade || '—'} | Cidade: ${selectedLead.cidade} ${selectedLead.estado} | Tel: ${selectedLead.telefone} | Site: ${selectedLead.site}`
        : 'Nenhum lead selecionado.'
      const histForApi = history.map(m => ({
        role: m.role === 'bot' ? 'model' : 'user',
        parts: [{ text: m.text }],
      }))
      const reply = await generateProspectionOutreach(histForApi, msg, ctx, inventory)
      setChatHistory(prev => [...prev, { role: 'bot', text: reply }])
    } catch {
      setChatHistory(prev => [...prev, { role: 'bot', text: '❌ Erro ao gerar resposta.' }])
    } finally {
      setChatLoading(false)
    }
  }

  // ── Render: Busca ─────────────────────────────────────────────────────────
  const renderBusca = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* Seletor de modo */}
      <div className="card" style={{ padding: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {[
            { id: 'places', icon: '🗺️', label: 'Google Maps / Places' },
            { id: 'cnpj',   icon: '🏢', label: 'Buscar por CNPJ' },
            { id: 'manual', icon: '✍️', label: 'Adicionar Manual' },
          ].map(m => (
            <button
              key={m.id}
              className={`btn ${mode === m.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setMode(m.id); setResults([]); setResultNotes({}) }}
            >
              {m.icon} {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Google Places ── */}
      {mode === 'places' && (
        <div className="card" style={{ padding: '1.25rem' }}>
          <h3 style={{ marginBottom: '0.85rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            🗺️ Buscar negócios no Google Maps
          </h3>

          {!GOOGLE_KEY && (
            <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '6px', padding: '0.65rem 0.85rem', marginBottom: '0.85rem', fontSize: '0.8rem', color: '#10b981' }}>
              🗺️ Usando <strong>OpenStreetMap (Overpass)</strong> — gratuito, sem necessidade de chave. Resultados vêm do mapa colaborativo, podendo variar por cidade.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.7rem' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>Segmento</label>
              <select className="search-input" value={segmento} onChange={e => { setSegmento(e.target.value); setSegCustom('') }}>
                {SEGMENTOS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>
                Ou digite livremente
              </label>
              <input
                className="search-input"
                type="text"
                placeholder="Ex: loja de presentes, decoração nordestina..."
                value={segCustom}
                onChange={e => setSegCustom(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handlePlacesSearch()}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>Estado</label>
              <select className="search-input" value={estado} onChange={e => setEstado(e.target.value)}>
                {ESTADOS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem' }}>Cidade (opcional)</label>
              <input
                className="search-input"
                type="text"
                placeholder="Ex: Recife, Campinas..."
                value={cidade}
                onChange={e => setCidade(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handlePlacesSearch()}
              />
            </div>
          </div>

          <button
            className="btn btn-primary"
            onClick={handlePlacesSearch}
            disabled={loading}
            style={{ width: '100%', marginTop: '0.85rem', fontSize: '0.9rem', padding: '0.6rem' }}
          >
            {loading ? '⏳ Buscando leads...' : GOOGLE_KEY ? '🔍 Buscar via Google Places' : '🗺️ Buscar via OpenStreetMap (grátis)'}
          </button>

          {/* Links alternativos */}
          <div style={{ marginTop: '0.85rem', paddingTop: '0.85rem', borderTop: '1px solid var(--border)' }}>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginBottom: '0.4rem' }}>Buscar também em:</p>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {[
                { label: '📍 Google Maps', url: `https://www.google.com/maps/search/${encodeURIComponent((segCustom||segmento)+' '+(cidade||estado)+' Brasil')}` },
                { label: '📷 Instagram',   url: `https://www.instagram.com/explore/tags/${encodeURIComponent((segCustom||segmento).replace(/\s+/g,''))}` },
                { label: '📘 Facebook',    url: `https://www.facebook.com/search/pages/?q=${encodeURIComponent((segCustom||segmento)+' '+(cidade||estado))}` },
                { label: '🔍 Google',      url: `https://www.google.com/search?q=${encodeURIComponent((segCustom||segmento)+' '+(cidade||estado)+' contato whatsapp site')}` },
              ].map(l => (
                <a key={l.label} href={l.url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none', fontSize: '0.73rem' }}>
                  {l.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── CNPJ ── */}
      {mode === 'cnpj' && (
        <div className="card" style={{ padding: '1.25rem' }}>
          <h3 style={{ marginBottom: '0.65rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>🏢 Consultar CNPJ</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-faint)', marginBottom: '0.85rem' }}>
            Consulta gratuita via BrasilAPI. Retorna nome, endereço, telefone, e-mail, atividade e situação cadastral.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              className="search-input"
              type="text"
              placeholder="00.000.000/0000-00"
              value={cnpjInput}
              onChange={e => setCnpjInput(cnpjMask(e.target.value))}
              onKeyDown={e => e.key === 'Enter' && handleCnpjSearch()}
              style={{ flex: 1 }}
              maxLength={18}
            />
            <button
              className="btn btn-primary"
              onClick={handleCnpjSearch}
              disabled={loading || cnpjInput.replace(/\D/g,'').length < 14}
            >
              {loading ? '⏳' : '🔍 Buscar'}
            </button>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: '0.6rem' }}>
            💡 Encontre CNPJs no{' '}
            <a href="https://www.empresometro.com.br" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>Empresômetro</a>
            {' '}ou{' '}
            <a href="https://cnpj.biz" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>CNPJ.biz</a>
          </p>
        </div>
      )}

      {/* ── Manual ── */}
      {mode === 'manual' && (
        <div className="card" style={{ padding: '1.25rem' }}>
          <h3 style={{ marginBottom: '0.85rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>✍️ Adicionar Lead Manualmente</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.6rem' }}>
            {[
              { f: 'nome',      l: '🏷️ Nome / Empresa *', p: 'Ex: Loja da Maria' },
              { f: 'telefone',  l: '📞 Telefone',          p: '(11) 9xxxx-xxxx' },
              { f: 'whatsapp',  l: '💬 WhatsApp',          p: '(11) 9xxxx-xxxx' },
              { f: 'email',     l: '📧 E-mail',            p: 'contato@empresa.com' },
              { f: 'instagram', l: '📷 Instagram',         p: '@perfil ou URL' },
              { f: 'site',      l: '🌐 Site',              p: 'www.empresa.com.br' },
              { f: 'cnpj',      l: '🏢 CNPJ',             p: '00.000.000/0001-00' },
              { f: 'cpf',       l: '🪪 CPF',              p: '000.000.000-00' },
              { f: 'endereco',  l: '📍 Endereço',          p: 'Rua, número, bairro' },
              { f: 'cidade',    l: '🏙️ Cidade',           p: 'São Paulo' },
              { f: 'cep',       l: '📮 CEP',              p: '00000-000' },
            ].map(({ f, l, p }) => (
              <div key={f}>
                <label style={{ fontSize: '0.76rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>{l}</label>
                <input className="search-input" type="text" placeholder={p} value={manual[f]} onChange={e => setManual(s => ({ ...s, [f]: e.target.value }))} style={{ fontSize: '0.84rem' }} />
              </div>
            ))}
            <div>
              <label style={{ fontSize: '0.76rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>🗺️ Estado</label>
              <select className="search-input" value={manual.estado} onChange={e => setManual(s => ({ ...s, estado: e.target.value }))} style={{ fontSize: '0.84rem' }}>
                {ESTADOS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '0.76rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>📝 Observações</label>
              <textarea className="search-input" placeholder="Notas sobre o lead..." value={manual.notes} onChange={e => setManual(s => ({ ...s, notes: e.target.value }))} rows={2} style={{ fontSize: '0.84rem', resize: 'vertical' }} />
            </div>
          </div>
          <button className="btn btn-primary" onClick={handleManualAdd} style={{ marginTop: '0.75rem', width: '100%' }}>
            ➕ Salvar Lead
          </button>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          RESULTADOS DA BUSCA — aparecem logo abaixo
      ════════════════════════════════════════════════════════════════════ */}
      {loading && (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          ⏳ Buscando leads... aguarde
        </div>
      )}

      {!loading && results.length > 0 && (
        <div>
          {/* Cabeçalho dos resultados */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: '0.75rem', padding: '0.75rem 1rem',
            background: 'var(--surface-2)', borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
          }}>
            <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>
              🎯 {results.length} lead{results.length > 1 ? 's' : ''} encontrado{results.length > 1 ? 's' : ''}
            </span>
            <button className="btn btn-primary btn-sm" onClick={saveAll}>
              💾 Salvar todos os {results.length}
            </button>
          </div>

          {/* Cards dos resultados */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {results.map(r => (
              <LeadCard
                key={r.id}
                lead={{ ...r, notes: resultNotes[r.id] ?? r.notes }}
                saved={leads.some(l => l.id === r.id)}
                onSave={() => saveResult(r)}
                onAI={() => quickAI(r)}
                onNoteChange={v => updateResultNote(r.id, v)}
              />
            ))}
          </div>
        </div>
      )}

      {!loading && results.length === 0 && mode !== 'manual' && (
        <div className="card" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-faint)', fontSize: '0.85rem', borderStyle: 'dashed' }}>
          Os leads encontrados aparecerão aqui logo abaixo após a busca.
        </div>
      )}
    </div>
  )

  // ── Render: Meus Leads ────────────────────────────────────────────────────
  const renderLeads = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {leads.length === 0 ? (
        <div className="card">
          <div className="empty-state" style={{ padding: '3rem' }}>
            Nenhum lead salvo ainda.<br />
            <span className="text-small">Faça uma busca e clique em <strong>💾 Salvar Lead</strong>.</span>
          </div>
        </div>
      ) : (
        leads.map(lead => (
          <LeadCard
            key={lead.id}
            lead={lead}
            saved
            onRemove={() => removeLead(lead.id)}
            onAI={() => quickAI(lead)}
            onSendToAna={() => sendToAna(lead)}
            onStatusChange={s => updateStatus(lead.id, s)}
            onNoteChange={v => updateNote(lead.id, v)}
          />
        ))
      )}
    </div>
  )

  // ── Render: IA ────────────────────────────────────────────────────────────
  const renderIA = () => (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 230px)', minHeight: '420px' }}>
      {selectedLead && (
        <div style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '8px', padding: '0.6rem 0.9rem', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--primary)' }}>
            🎯 Lead ativo: <strong>{selectedLead.nome}</strong>{selectedLead.cidade ? ` — ${selectedLead.cidade}` : ''}
          </span>
          <button className="btn btn-secondary btn-sm" onClick={() => setSelectedLead(null)}>✕</button>
        </div>
      )}

      {chatHistory.length <= 1 && (
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          {[
            'Crie uma mensagem de WhatsApp para uma loja de decoração que não me conhece',
            'Como abordar um decorador de interiores oferecendo meus produtos?',
            'Gere um script para Instagram DM vendendo itens de decoração',
            'Quais argumentos usar para convencer uma loja a comprar decoração no atacado?',
          ].map(s => (
            <button key={s} className="btn btn-secondary btn-sm" onClick={() => setChatInput(s)} style={{ fontSize: '0.74rem' }}>
              {s.slice(0, 50)}…
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.65rem', paddingRight: '0.2rem', marginBottom: '0.75rem' }}>
        {chatHistory.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '82%',
              background: m.role === 'user' ? 'var(--primary)' : 'var(--surface-2)',
              color: m.role === 'user' ? '#fff' : 'var(--text)',
              borderRadius: m.role === 'user' ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
              padding: '0.7rem 0.9rem',
              fontSize: '0.855rem',
              lineHeight: 1.65,
              whiteSpace: 'pre-wrap',
              border: m.role === 'bot' ? '1px solid var(--border)' : 'none',
            }}>
              {m.role === 'bot' && (
                <span style={{ fontSize: '0.7rem', color: 'var(--primary)', fontWeight: 700, display: 'block', marginBottom: '0.35rem' }}>
                  🤖 Ana — IA de Prospecção
                </span>
              )}
              {m.text.replace(/\*\*/g, '')}
              {m.role === 'bot' && (
                <button
                  onClick={() => { navigator.clipboard.writeText(m.text.replace(/\*\*/g,'')); addToast('Copiado!', 'success') }}
                  style={{ display: 'block', marginTop: '0.4rem', background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: '0.72rem' }}
                >
                  📋 Copiar mensagem
                </button>
              )}
            </div>
          </div>
        ))}
        {chatLoading && (
          <div style={{ display: 'flex' }}>
            <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '14px 14px 14px 2px', padding: '0.7rem 0.9rem', fontSize: '0.85rem', color: 'var(--text-faint)' }}>
              ⏳ Gerando mensagem...
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <textarea
          className="search-input"
          placeholder="Ex: Gere uma mensagem de WhatsApp para a Loja Bella Decor oferecendo quadros decorativos..."
          value={chatInput}
          onChange={e => setChatInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() } }}
          rows={2}
          style={{ flex: 1, resize: 'none', fontSize: '0.875rem' }}
        />
        <button className="btn btn-primary" onClick={sendChat} disabled={chatLoading || !chatInput.trim()} style={{ alignSelf: 'flex-end', padding: '0.6rem 0.9rem' }}>
          {chatLoading ? '⏳' : '📤'}
        </button>
      </div>
    </div>
  )

  // ── Layout principal ──────────────────────────────────────────────────────
  return (
    <div className="page">
      <div className="page-header">
        <h1>🔎 Prospecção de Leads</h1>
        <p>Encontre clientes em todo o Brasil e aborde com IA — decoração, presentes e muito mais</p>
      </div>

      {/* Stats */}
      <div className="stat-grid mb-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
        {[
          { l: 'Total Leads',  v: leads.length,                                          c: '#3b82f6' },
          { l: 'Em Contato',   v: leads.filter(l => l.status==='em_contato').length,     c: '#f59e0b' },
          { l: 'Responderam',  v: leads.filter(l => l.status==='respondeu').length,      c: '#8b5cf6' },
          { l: 'Fechados',     v: leads.filter(l => l.status==='fechado').length,        c: '#10b981' },
        ].map(s => (
          <div key={s.l} className="stat-card" style={{ borderLeft: `4px solid ${s.c}` }}>
            <span className="stat-label">{s.l}</span>
            <span className="stat-value" style={{ color: s.c }}>{s.v}</span>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
        {[
          { id: 'busca', icon: '🔍', label: 'Buscar Leads' },
          { id: 'leads', icon: '📋', label: `Meus Leads (${leads.length})` },
          { id: 'ia',    icon: '🤖', label: 'IA de Abordagem' },
        ].map(t => (
          <button key={t.id} className={`btn ${tab===t.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'busca' && renderBusca()}
      {tab === 'leads' && renderLeads()}
      {tab === 'ia'    && renderIA()}
    </div>
  )
}
