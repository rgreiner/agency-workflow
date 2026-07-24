'use client'

import { useState, useEffect } from 'react'
import type { BoardElement, NoteElement, TextElement } from '@/types/board'
import { NOTE_COLORS, TEXT_COLORS, FONT_MIN, FONT_MAX, FONT_STEP, TEXT_SIZE_PX, effectiveFontSize } from '@/types/board'
import {
  Bold, Italic, Underline, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, Minus, Plus,
} from 'lucide-react'

interface Props {
  el: BoardElement
  onUpdate: (updates: Partial<BoardElement>) => void
}

const SIZE_PRESETS = [
  { value: 'h1',   label: 'H1' },
  { value: 'h2',   label: 'H2' },
  { value: 'body', label: 'Aa' },
] as const

const ALIGN_OPTIONS = [
  { value: 'left',   Icon: AlignLeft },
  { value: 'center', Icon: AlignCenter },
  { value: 'right',  Icon: AlignRight },
] as const

const clamp = (n: number) => Math.min(FONT_MAX, Math.max(FONT_MIN, n))

// Formatação inline atua sobre a seleção do editor em foco (execCommand).
// onMouseDown→preventDefault preserva foco+seleção; o comando roda no onClick.
function exec(cmd: string, value?: string) {
  document.execCommand(cmd, false, value)
}

/**
 * Painel lateral de customização do bloco selecionado (nota / texto).
 * De bloco: cor de fundo (nota), tamanho, alinhamento. Inline (por seleção):
 * negrito, itálico, sublinhado, tachado e cor do texto.
 */
export function InspectorPanel({ el, onUpdate }: Props) {
  // Estado ativo dos botões inline reflete a seleção atual do editor.
  const [fmt, setFmt] = useState({ bold: false, italic: false, underline: false, strike: false })

  useEffect(() => {
    function sync() {
      try {
        setFmt({
          bold:      document.queryCommandState('bold'),
          italic:    document.queryCommandState('italic'),
          underline: document.queryCommandState('underline'),
          strike:    document.queryCommandState('strikeThrough'),
        })
      } catch { /* queryCommandState indisponível */ }
    }
    document.addEventListener('selectionchange', sync)
    sync()
    return () => document.removeEventListener('selectionchange', sync)
  }, [])

  if (el.type !== 'note' && el.type !== 'text') return null

  const size = effectiveFontSize(el as NoteElement | TextElement)
  const setSize = (n: number) => onUpdate({ fontSize: clamp(n) } as Partial<BoardElement>)

  return (
    <div
      onPointerDown={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        width: 220,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        padding: '16px 16px 18px',
        backgroundColor: '#ffffff',
        border: '1px solid #eceef1',
        borderRadius: 16,
        boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 32px rgba(15,23,42,0.13)',
        zIndex: 400,
        animation: 'inspector-in 0.16s cubic-bezier(0.22,1,0.36,1)',
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: '#9aa2af' }}>
        {el.type === 'note' ? 'Nota' : 'Texto'}
      </span>

      {/* ── Cor de fundo (só nota) ── */}
      {el.type === 'note' && (
        <Field label="Cor de fundo">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6 }}>
            {NOTE_COLORS.map(({ bg, border, label }) => (
              <Swatch key={bg} title={label} color={bg} border={border}
                active={(el as NoteElement).color === bg}
                onClick={() => onUpdate({ color: bg } as Partial<BoardElement>)} />
            ))}
          </div>
        </Field>
      )}

      {/* ── Tamanho da fonte ── */}
      <Field label="Tamanho">
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn onClick={() => setSize(size - FONT_STEP)} title="Diminuir (⌘⇧,)"><Minus size={14} /></Btn>
          <div style={{
            flex: 1, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 9, backgroundColor: '#f3f4f6', color: '#111827',
            fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
          }}>
            {size}px
          </div>
          <Btn onClick={() => setSize(size + FONT_STEP)} title="Aumentar (⌘⇧.)"><Plus size={14} /></Btn>
        </div>
        {el.type === 'text' && (
          <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
            {SIZE_PRESETS.map(s => (
              <Btn key={s.value} grow
                active={(el as TextElement).size === s.value && el.fontSize == null}
                onClick={() => onUpdate({ size: s.value, fontSize: TEXT_SIZE_PX[s.value] } as Partial<BoardElement>)}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{s.label}</span>
              </Btn>
            ))}
          </div>
        )}
      </Field>

      {/* ── Estilo (inline, por seleção) ── */}
      <Field label="Estilo">
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn grow inline active={fmt.bold}      title="Negrito (⌘B)"    onClick={() => exec('bold')}><Bold size={14} /></Btn>
          <Btn grow inline active={fmt.italic}    title="Itálico (⌘I)"    onClick={() => exec('italic')}><Italic size={14} /></Btn>
          <Btn grow inline active={fmt.underline} title="Sublinhado (⌘U)" onClick={() => exec('underline')}><Underline size={14} /></Btn>
          <Btn grow inline active={fmt.strike}    title="Tachado"         onClick={() => exec('strikeThrough')}><Strikethrough size={14} /></Btn>
        </div>
      </Field>

      {/* ── Alinhamento (de bloco) ── */}
      <Field label="Alinhamento">
        <div style={{ display: 'flex', gap: 6 }}>
          {ALIGN_OPTIONS.map(({ value, Icon }) => (
            <Btn key={value} grow title={value} active={(el.align ?? 'left') === value}
              onClick={() => onUpdate({ align: value } as Partial<BoardElement>)}><Icon size={14} /></Btn>
          ))}
        </div>
      </Field>

      {/* ── Cor do texto (inline, por seleção) ── */}
      <Field label="Cor do texto">
        <div style={{ display: 'flex', gap: 6 }}>
          {TEXT_COLORS.map(({ hex, label }) => (
            <Swatch key={hex} title={label} color={hex} border="rgba(15,23,42,0.15)" inline
              onClick={() => exec('foreColor', hex)} />
          ))}
        </div>
      </Field>

      <style>{`
        @keyframes inspector-in { from { opacity: 0; transform: translateX(-8px) scale(0.98); } to { opacity: 1; transform: translateX(0) scale(1); } }
        .insp-btn { transition: background-color .12s, color .12s, transform .08s; }
        .insp-btn:hover:not(.is-active) { background-color: #e9ebee; }
        .insp-btn:active { transform: scale(0.94); }
        .insp-swatch { transition: transform .1s, box-shadow .12s; }
        .insp-swatch:hover { transform: scale(1.12); }
        .insp-swatch:active { transform: scale(0.96); }
      `}</style>
    </div>
  )
}

// ── Subcomponentes ───────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#6b7280' }}>{label}</span>
      {children}
    </div>
  )
}

function Btn({
  active, onClick, children, grow, title, inline,
}: {
  active?: boolean
  onClick: () => void
  children: React.ReactNode
  grow?: boolean
  title?: string
  inline?: boolean   // formatação por seleção: mantém foco no editor
}) {
  return (
    <button
      className={`insp-btn${active ? ' is-active' : ''}`}
      title={title}
      // Mantém o cursor/seleção no editor: sem isso, o clique tira o foco.
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      style={{
        flex: grow ? 1 : undefined,
        width: grow ? undefined : 32,
        height: 32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 9,
        border: 'none',
        cursor: 'pointer',
        backgroundColor: active ? '#f97316' : '#f3f4f6',
        color: active ? '#ffffff' : '#4b5563',
      }}
      data-inline={inline ? '' : undefined}
    >
      {children}
    </button>
  )
}

function Swatch({
  color, border, active, onClick, title, inline,
}: {
  color: string
  border: string
  active?: boolean
  onClick: () => void
  title: string
  inline?: boolean
}) {
  return (
    <button
      className="insp-swatch"
      title={title}
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      style={{
        width: inline ? 22 : 18,
        height: inline ? 22 : 18,
        flex: inline ? 1 : undefined,
        backgroundColor: color,
        border: active ? '2px solid #f97316' : `1.5px solid ${border}`,
        borderRadius: inline ? 7 : 6,
        cursor: 'pointer',
        padding: 0,
      }}
    />
  )
}
