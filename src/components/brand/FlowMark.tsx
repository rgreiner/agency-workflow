import { cn } from '@/lib/utils'

/**
 * Marca do Flow: o ícone da identidade (quadrado charcoal arredondado, F branco,
 * onda laranja). É a MESMA arte do ícone do app/PWA — gerada por
 * scripts/brand/gerar-assets.mjs a partir de brand/, nunca desenhada à mão aqui.
 *
 * Os cantos já vêm transparentes no PNG, então funciona sobre qualquer fundo
 * (card branco do login, header escuro do portal, dark mode).
 */
export function FlowMark({ size = 48, className }: { size?: number; className?: string }) {
  // 192px cobre até 96px de CSS em tela 2x sem perder nitidez.
  const src = size > 96 ? '/icons/icon-512.png' : '/icons/icon-192.png'
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="Flow"
      width={size}
      height={size}
      draggable={false}
      className={cn('block shrink-0 select-none', className)}
      style={{ width: size, height: size }}
    />
  )
}
