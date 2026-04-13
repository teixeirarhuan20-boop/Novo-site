import React, { useState, useRef, useCallback } from 'react'
import Tesseract from 'tesseract.js'
import { analyzeDocument, analyzeText, formatLabelText } from '../lib/gemini'

export function LabelAssistant({ inventory, pessoas, addToast, onDataExtracted }) {
  const [status,    setStatus]    = useState('')
  const [dragging,  setDragging]  = useState(false)
  const [textInput, setTextInput] = useState('')
  const [formatted, setFormatted] = useState('')
  const [tab,       setTab]       = useState('image') // 'image' | 'text'
  const inputRef = useRef(null)

  const processFile = useCallback(async (file) => {
    if (!file) return
    setStatus('🔍 Lendo imagem com OCR...')
    setFormatted('')

    try {
      let data = null

      // Tenta IA direto (Gemini/Groq vision)
      if (file.type.startsWith('image/')) {
        const b64 = await new Promise((res, rej) => {
          const reader = new FileReader()
          reader.onload  = e => res(e.target.result)
          reader.onerror = rej
          reader.readAsDataURL(file)
        })

        setStatus('🤖 Analisando com IA...')
        try {
          data = await analyzeDocument(b64, inventory, pessoas)
        } catch {
          setStatus('📝 Usando OCR local...')
        }

        // Fallback para OCR local
        if (!data) {
          const result = await Tesseract.recognize(file, 'por+eng')
          const text   = result.data.text
          setStatus('🤖 Refinando com IA...')
          data = await analyzeText(text, inventory, pessoas)
        }
      }

      if (data) {
        onDataExtracted(data)
        addToast('Etiqueta lida com sucesso!', 'success')
        setStatus('✅ Dados extraídos!')
      } else {
        addToast('Não foi possível extrair dados.', 'warning')
        setStatus('⚠️ Extração incompleta')
      }
    } catch (err) {
      addToast(`Erro: ${err.message}`, 'error')
      setStatus(`❌ ${err.message}`)
    }
  }, [inventory, pessoas, addToast, onDataExtracted])

  const processText = useCallback(async () => {
    if (!textInput.trim()) return
    setStatus('🤖 Analisando texto...')
    try {
      const data = await analyzeText(textInput, inventory, pessoas)
      if (data) {
        onDataExtracted(data)
        addToast('Dados extraídos do texto!', 'success')
        setStatus('✅ Pronto!')
      } else {
        addToast('Não consegui identificar dados.', 'warning')
        setStatus('⚠️ Nenhum dado identificado')
      }
    } catch (err) {
      addToast(`Erro: ${err.message}`, 'error')
      setStatus(`❌ ${err.message}`)
    }
  }, [textInput, inventory, pessoas, addToast, onDataExtracted])

  const formatText = useCallback(async () => {
    if (!textInput.trim()) return
    setStatus('📋 Formatando...')
    try {
      const result = await formatLabelText(textInput)
      setFormatted(result)
      setStatus('✅ Formatado!')
    } catch (err) {
      setStatus(`❌ ${err.message}`)
    }
  }, [textInput])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [processFile])

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div className="flex gap-1 mb-2">
        <button className={`btn btn-sm ${tab === 'image' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('image')}>
          🖼️ Imagem / Foto
        </button>
        <button className={`btn btn-sm ${tab === 'text' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('text')}>
          📝 Colar Texto
        </button>
      </div>

      {tab === 'image' && (
        <div
          className={`drop-zone ${dragging ? 'dragging' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <span className="drop-zone-icon">📦</span>
          <span className="drop-zone-title">Clique ou arraste a foto da etiqueta</span>
          <span className="drop-zone-sub">PNG, JPG, WEBP — IA vai extrair os dados automaticamente</span>
          <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => processFile(e.target.files[0])} />
        </div>
      )}

      {tab === 'text' && (
        <div>
          <textarea
            value={textInput}
            onChange={e => setTextInput(e.target.value)}
            placeholder="Cole aqui o texto da etiqueta ou pedido..."
            rows={5}
            style={{ marginBottom: '0.5rem', resize: 'vertical' }}
          />
          <div className="flex gap-1">
            <button className="btn btn-primary btn-sm" onClick={processText} disabled={!textInput.trim()}>
              🤖 Extrair Dados
            </button>
            <button className="btn btn-secondary btn-sm" onClick={formatText} disabled={!textInput.trim()}>
              📋 Só Formatar
            </button>
          </div>
          {formatted && (
            <pre style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', whiteSpace: 'pre-wrap', border: '1px solid var(--border)' }}>
              {formatted}
            </pre>
          )}
        </div>
      )}

      {status && (
        <p style={{ marginTop: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 500 }}>
          {status}
        </p>
      )}
    </div>
  )
}
