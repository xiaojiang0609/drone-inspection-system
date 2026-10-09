import { useRef } from 'react'

export default function ImageUploader({ onImageLoad }) {
  const inputRef = useRef(null)

  const handleFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => onImageLoad(img, file)
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    handleFile(e.dataTransfer.files[0])
  }

  return (
    <div
      className="border-2 border-dashed border-gray-300 rounded-2xl p-12 text-center
                 cursor-pointer hover:border-purple-400 hover:bg-purple-50/50
                 transition-colors duration-200"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files[0])}
      />
      <div className="text-5xl mb-4 opacity-60">&#128247;</div>
      <p className="text-gray-500 text-lg">点击或拖拽图片到此处上传</p>
      <p className="text-gray-400 text-sm mt-2">支持 JPG / PNG / WebP</p>
    </div>
  )
}
