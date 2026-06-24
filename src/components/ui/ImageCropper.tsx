'use client'

import { Cropper } from './Cropper'

/** Recorte retangular (4:3) de imagem de referência. WebP 800×600. */
export function ImageCropper({ file, onCancel, onConfirm }: {
  file: File
  onCancel: () => void
  onConfirm: (result: File) => void
}) {
  return (
    <Cropper
      file={file}
      onCancel={onCancel}
      onConfirm={onConfirm}
      frameW={360}
      frameH={270}
      outW={800}
      outH={600}
      quality={0.82}
      title="Ajustar imagem de referência"
      confirmLabel="Usar imagem"
      fileName="ref.webp"
    />
  )
}
