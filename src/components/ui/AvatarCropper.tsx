'use client'

import { Cropper } from './Cropper'

/** Recorte quadrado/circular (avatar / logo). WebP 512×512. */
export function AvatarCropper({ file, onCancel, onConfirm }: {
  file: File
  onCancel: () => void
  onConfirm: (result: File) => void
}) {
  return (
    <Cropper
      file={file}
      onCancel={onCancel}
      onConfirm={onConfirm}
      frameW={280}
      frameH={280}
      outW={512}
      outH={512}
      quality={0.85}
      round
      title="Ajustar foto"
      confirmLabel="Usar foto"
      fileName="avatar.webp"
    />
  )
}
