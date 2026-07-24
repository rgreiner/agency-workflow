'use client'

import type { BoardElement, NoteElement, TextElement } from '@/types/board'
import { NOTE_COLORS } from '@/types/board'
import { Bold, Italic, AlignLeft, AlignCenter, AlignRight } from 'lucide-react'

interface Props {
  el: BoardElement
  onUpdate: (updates: Partial<BoardElement>) => void
}

const SIZE_OPTIONS = [
  { value: 'h1',   label: 'H1' },
  { value: 'h2',   label: 'H2' },
  { value: 'body', label: 'Aa' },
] as const

const ALIGN_OPTIONS = [
  { value: 'left',   Icon: AlignLeft },
  { value: 'center', Icon: AlignCenter },
  { value: 'right',  Icon: AlignRight },
] as const

/**
 * Painel lateral de customização do bloco selecionado (nota / texto).
 * Fica ancorado à esquerda do canvas e substitui as toolbars flutuantes:
 * cor de fundo (nota) + formato do texto (tamanho, negrito, itálico, alinhamento).
 */
export function InspectorPanel({ el, onUpdate }: Props) {
  if (el.type !== 'note' && el.type !== 'text') return null

  return (
    <div
      onPointerDown={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        width: 208,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        padding: 16,
        backgroundColor: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: 16,
        boxShadow: '0 8px 30px rgba(15,23,42,0.12)',
        zIndex: 400,
        animation: 'inspector-in 0.16s ease-out',
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: '#9ca3af' }}>
        {el.type === 'note' ? 'Nota' : 'Texto'}
      </span>

      {/* ── Cor de fundo (só nota) ── */}
      {el.type === 'note' && (
        <Field label="Cor de fundo">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6 }}>
            {NOTE_COLORS.map(({ bg, border, label }) => {
              const active = (el as NoteElement).color === bg
              return (
                <button
                  key={bg}
                  title={label}
                  onClick={() => onUpdate({ color: bg } as Partial<BoardElement>)}
                  style={{
                    width: 18,
                    height: 18,
                    backgroundColor: bg,
                    border: active ? '2px solid #f97316' : `1.5px solid ${border}`,
                    borderRadius: 6,
                    cursor: 'pointer',
                    padding: 0,
                    transition: 'transform 0.1s',
                  }}
                />
              )
            })}
          </div>
        </Field>
      )}

      {/* ── Tamanho (só texto) ── */}
      {el.type === 'text' && (
        <Field label="Tamanho">
          <div style={{ display: 'flex', gap: 6 }}>
            {SIZE_OPTIONS.map(s => {
              const active = (el as TextElement).size === s.value
              return (
                <SegBtn key={s.value} active={active} onClick={() => onUpdate({ size: s.value } as Partial<BoardElement>)} grow>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{s.label}</span>
                </SegBtn>
              )
            })}
          </div>
        </Field>
      )}

      {/* ── Estilo (nota + texto) ── */}
      <Field label="Estilo">
        <div style={{ display: 'flex', gap: 6 }}>
          <SegBtn active={!!el.bold} onClick={() => onUpdate({ bold: !el.bold } as Partial<BoardElement>)} grow title="Negrito">
            <Bold size={14} />
          </SegBtn>
          <SegBtn active={!!el.italic} onClick={() => onUpdate({ italic: !el.italic } as Partial<BoardElement>)} grow title="Itálico">
            <Italic size={14} />
          </SegBtn>
        </div>
      </Field>

      {/* ── Alinhamento (nota + texto) ── */}
      <Field label="Alinhamento">
        <div style={{ display: 'flex', gap: 6 }}>
          {ALIGN_OPTIONS.map(({ value, Icon }) => (
            <SegBtn
              key={value}
              active={(el.align ?? 'left') === value}
              onClick={() => onUpdate({ align: value } as Partial<BoardElement>)}
              grow
              title={value}
            >
              <Icon size={14} />
            </SegBtn>
          ))}
        </div>
      </Field>

      <style>{`
        @keyframes inspector-in { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: translateX(0); } }
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

function SegBtn({
  active, onClick, children, grow, title,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  grow?: boolean
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        flex: grow ? 1 : undefined,
        height: 32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 9,
        border: 'none',
        cursor: 'pointer',
        backgroundColor: active ? '#f97316' : '#f3f4f6',
        color: active ? '#ffffff' : '#4b5563',
        transition: 'background-color 0.12s, color 0.12s',
      }}
    >
      {children}
    </button>
  )
}
