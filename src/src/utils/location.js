// Geocodificação via Nominatim (OpenStreetMap)
export async function geocode(query) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=br&limit=1`,
      { headers: { 'User-Agent': 'MeuNegocioPro/2.0' } }
    )
    const data = await res.json()
    if (data?.length > 0) {
      return {
        lat: Number(data[0].lat),
        lng: Number(data[0].lon),
        displayName: data[0].display_name,
        city: data[0].display_name.split(',')[0].trim(),
      }
    }
  } catch {
    // silencioso
  }
  return null
}

// Empacota dados de localização na string do itemName
// Formato: "NomeProduto ||cidade;lat;lng;pedido;nf;cep;endereco;bairro;rastreio;modalidade||"
export function packLocation(productName, data = {}) {
  const { city = '', lat = null, lng = null, orderId = '', nf = '', cep = '', address = '', bairro = '', rastreio = '', modalidade = '' } = data
  return `${productName} ||${city};${lat};${lng};${orderId};${nf};${cep};${address};${bairro};${rastreio};${modalidade}||`
}

// Desempacota a string do itemName
export function unpackLocation(itemName) {
  if (!itemName || typeof itemName !== 'string') return null

  const match = itemName.match(/\|\|(.+?)\|\|/)
  if (match) {
    const [city, lat, lng, orderId, nf, cep, address, bairro, rastreio, modalidade] = match[1].split(';')
    return {
      cleanName: itemName.replace(/\|\|.*?\|\|/, '').trim(),
      city:      city      || null,
      lat:       lat && lat !== 'null'  ? Number(lat)  : null,
      lng:       lng && lng !== 'null'  ? Number(lng)  : null,
      orderId:   orderId   || null,
      nf:        nf        || null,
      cep:       cep       || null,
      address:   address   || null,
      bairro:    bairro    || null,
      rastreio:  rastreio  || null,
      modalidade: modalidade || null,
    }
  }

  // Fallback para formato legado [Cidade]
  const legacy = itemName.match(/\[(.*?)\]/)
  if (legacy) {
    return { cleanName: itemName.replace(/\[.*?\]/, '').trim(), city: legacy[1], lat: null, lng: null }
  }

  return null
}

export const COLOR_PALETTE = [
  '#2563eb', '#16a34a', '#d97706', '#dc2626',
  '#7c3aed', '#0891b2', '#db2777', '#4b5563',
  '#059669', '#b45309', '#4338ca', '#84cc16',
]

export function getProductColor(name, inventory = []) {
  const found = inventory.find(i =>
    (i.name || '').toLowerCase().trim() === (name || '').toLowerCase().trim()
  )
  if (found?.color) return found.color

  let hash = 0
  for (let i = 0; i < (name || '').length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length]
}

export function jitter(coord) {
  return coord + (Math.random() - 0.5) * 0.008
}
