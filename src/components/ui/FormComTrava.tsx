'use client'

/**
 * Formulário que aceita UM envio por vez — clique, Enter ou os dois juntos.
 *
 * O `SubmitButton` sozinho não fecha a porta: ele desabilita o botão, mas o Enter
 * dentro de um campo dispara o envio implícito e a rajada continua. Foi assim que o
 * log de login registrou seis falhas no MESMO segundo (07/08/2026) — seis tentativas
 * queimadas do limite de 8 em 15 minutos, e o bloqueio seguinte recusando até a senha
 * certa.
 *
 * Duas camadas, porque uma só deixa brecha:
 *  1. `fieldset disabled` enquanto a ação corre — desliga campos E botão, então o
 *     Enter não tem o que submeter. `display: contents` mantém o layout do <form>
 *     (o espaçamento do formulário conta com os filhos diretos).
 *  2. Guarda no `onSubmit` por ref, que pega o envio disparado no mesmo tique, antes
 *     de o React marcar `pending`.
 *
 * A trava se solta sozinha depois de 15s: toda ação daqui redireciona (acerto ou
 * erro), então o normal é a página trocar antes disso — mas se alguma falhar sem
 * navegar, ninguém fica com o formulário morto na tela.
 */
import { useRef } from 'react'
import { useFormStatus } from 'react-dom'

function Travavel({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus()
  return (
    <fieldset disabled={pending} aria-busy={pending} className="contents">
      {children}
    </fieldset>
  )
}

export function FormComTrava({
  action, className, children,
}: {
  action: (formData: FormData) => void | Promise<void>
  className?: string
  children: React.ReactNode
}) {
  const emVoo = useRef(false)

  return (
    <form
      action={action}
      className={className}
      onSubmit={e => {
        if (emVoo.current) { e.preventDefault(); return }
        emVoo.current = true
        setTimeout(() => { emVoo.current = false }, 15_000)
      }}
    >
      <Travavel>{children}</Travavel>
    </form>
  )
}
