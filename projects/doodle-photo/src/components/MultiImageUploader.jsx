import { useRef, useState } from 'react'
import { validateUploadBatch } from '../utils/collage-files.js'
import { MAX_COLLAGE_SOURCES } from '../utils/collage-config.js'

export default function MultiImageUploader({ count = 0, busy = false, onFiles }) {
  const inputRef = useRef(null), validatingRef = useRef(false)
  const [validating, setValidating] = useState(false), [errors, setErrors] = useState([])
  const disabled = busy || validating || count >= MAX_COLLAGE_SOURCES
  async function acceptFiles(candidates) {
    if (busy || validatingRef.current || count >= MAX_COLLAGE_SOURCES) return
    validatingRef.current = true; setValidating(true)
    try {
      const result = await validateUploadBatch(Array.from(candidates), count)
      setErrors(result.errors.map(({ file, reason }) => `${file.name}：${reason}`))
      if (result.files.length) await onFiles(result.files)
    } catch (error) { setErrors([error.message || '添加图片失败，请重试']) }
    finally { validatingRef.current = false; setValidating(false) }
  }
  return (
    <div className="rounded-2xl border-2 border-dashed border-gray-300 p-6 text-center"
      onDragOver={event => event.preventDefault()}
      onDrop={event => { event.preventDefault(); void acceptFiles(event.dataTransfer.files) }}>
      <input ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" disabled={disabled}
        onChange={event => { const files = Array.from(event.target.files); event.target.value = ''; void acceptFiles(files) }} />
      <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()}
        className="rounded-xl px-6 py-3 text-gray-600 hover:bg-purple-50 disabled:opacity-50">
        {validating ? '正在检查图片…' : '点击添加照片，或拖拽多张图片到这里'}
      </button>
      <p className="mt-2 text-sm text-gray-400">JPG / PNG / WebP · 每张最多 20 MiB · {count} / {MAX_COLLAGE_SOURCES} 张</p>
      {errors.length > 0 && <ul role="alert" className="mt-3 text-left text-sm text-red-600">
        {errors.map((error, index) => <li key={index}>{error}</li>)}
      </ul>}
    </div>
  )
}
