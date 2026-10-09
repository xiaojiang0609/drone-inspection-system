import { useState, useRef } from 'react'
import ImageUploader from './components/ImageUploader'
import CanvasEditor from './components/CanvasEditor'
import FilterSelector from './components/FilterSelector'
import LoadingOverlay from './components/LoadingOverlay'
import ErrorBanner from './components/ErrorBanner'
import SubjectCorrection from './components/SubjectCorrection'
import SubjectInventory from './components/SubjectInventory'
import CollageStudio from './components/CollageStudio'
import { FILTERS } from './utils/filters'
import { ensureFontLoaded } from './utils/doodle'
import { createJournalElements, drawJournal, JOURNAL_STYLE } from './utils/journal'
import { mergeCorrectedDetection } from './utils/correction-result'
import { retainSubjectCaptions } from './utils/subject-inventory'

ensureFontLoaded()

const API_URL = '/api/analyze'
const API_TIMEOUT = 150000

function App() {
  const [mode, setMode] = useState('single')
  const [collageMounted, setCollageMounted] = useState(false)
  const [image, setImage] = useState(null)
  const [activeFilter, setActiveFilter] = useState(FILTERS[0])
  const [detections, setDetections] = useState([])
  const [layoutMeta, setLayoutMeta] = useState({ theme: '其他', emotion: '治愈', safeZone: null, decorationZones: [], decorations: [] })
  const [loading, setLoading] = useState(false)
  const [correctionBusy, setCorrectionBusy] = useState(false)
  const [error, setError] = useState(null)
  const [generated, setGenerated] = useState(false)
  const canvasRef = useRef(null)
  const [elements, setElements] = useState([])
  const [showOutline, setShowOutline] = useState(true)
  const requestRef = useRef({ sequence: 0, controller: null, file: null, correcting: false })

  const handleImageLoad = async (img, file) => {
    requestRef.current.controller?.abort()
    const sequence = ++requestRef.current.sequence
    requestRef.current.file = file
    requestRef.current.correcting = false
    setCorrectionBusy(false)
    setImage(img)
    setElements([])
    setDetections([])
    setLayoutMeta({ theme: '其他', emotion: '治愈', safeZone: null, decorationZones: [], decorations: [] })
    setError(null)
    setLoading(true)
    setGenerated(false)

    const controller = new AbortController()
    requestRef.current.controller = controller
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch(API_URL, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })

      const json = await res.json()
      if (sequence !== requestRef.current.sequence) return
      if (!res.ok) throw new Error(json.detail || json.message || `照片分析失败 (${res.status})`)

      if (json.status === 'success' && Array.isArray(json.data)) {
        await ensureFontLoaded()
        if (sequence !== requestRef.current.sequence) return
        setDetections(json.data)
        const meta = {
          theme: json.theme || '其他',
          emotion: json.emotion || '治愈',
          safeZone: json.safeZone || null,
          decorationZones: Array.isArray(json.decorationZones) ? json.decorationZones : [],
          decorations: Array.isArray(json.decorations) ? json.decorations : [],
          headline: json.headline || null,
          ambientCaptions: Array.isArray(json.ambientCaptions) ? json.ambientCaptions : [],
          recognitionSummary: json.recognition_summary || null,
        }
        setLayoutMeta(meta)
        setElements(createJournalElements(json.data, meta, img.naturalWidth, img.naturalHeight))
      } else if (json.status === 'error') {
        setDetections([])
        setError(json.message || '涂鸦标注暂时不可用，但你仍可换滤镜和导出原图')
      } else {
        setDetections([])
        setError('返回数据格式异常，涂鸦标注不可用')
      }
    } catch (err) {
      if (sequence !== requestRef.current.sequence) return
      if (err.name === 'AbortError') {
        setError('AI 分析超时，请检查后端服务是否正常运行')
      } else if (err instanceof TypeError) {
        setError('无法连接到照片分析服务，请确认后端已启动')
      } else {
        setError(err.message || '未知错误')
      }
    } finally {
      clearTimeout(timer)
      if (sequence === requestRef.current.sequence) setLoading(false)
    }
  }

  const handleSubjectCorrection = async (endpoint, index, geometry, regionIndex) => {
    const file = requestRef.current.file
    if (!file || !detections[index] || requestRef.current.correcting || loading) {
      throw new Error('当前暂时无法纠正主体，请等待照片分析完成')
    }
    requestRef.current.controller?.abort()
    const sequence = ++requestRef.current.sequence
    const controller = new AbortController()
    requestRef.current.controller = controller
    requestRef.current.correcting = true
    setCorrectionBusy(true)
    const timer = setTimeout(() => controller.abort(), 120000)
    try {
      const previous = detections[index]
      const formData = new FormData()
      formData.append('file', file)
      formData.append('subject', JSON.stringify({
        label: previous.label, caption: previous.caption, textPlacement: previous.textPlacement,
        layout: previous.layout, ...geometry,
      }))
      formData.append('region_index', String(regionIndex))
      const response = await fetch(endpoint, { method: 'POST', body: formData, signal: controller.signal })
      const json = await response.json()
      if (sequence !== requestRef.current.sequence) throw new Error('照片已切换，本次纠错结果已忽略')
      if (!response.ok || json.status !== 'success' || !json.data?.box_2d || !json.data?.shape_contours?.length) {
        throw new Error(json.detail || json.message || '本次纠错没有可靠轮廓，已保留原结果')
      }
      const updated = mergeCorrectedDetection(previous, json.data, regionIndex)
      setDetections(current => current.map((detection, position) => position === index ? updated : detection))
      // Captions and manually edited elements stay in place; arrows read the new subject geometry.
      return updated
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('主体纠错超时，已保留原结果，请稍后重试', { cause: err })
      if (err instanceof TypeError) throw new Error('无法连接主体纠错服务，已保留原结果', { cause: err })
      throw err
    } finally {
      clearTimeout(timer)
      if (sequence === requestRef.current.sequence) {
        requestRef.current.correcting = false
        requestRef.current.controller = null
        setCorrectionBusy(false)
      }
    }
  }

  const handleGenerate = () => setGenerated(true)
  const handleBackToEdit = () => setGenerated(false)

  const handleExport = async () => {
    if (!image) return

    await ensureFontLoaded()

    const imgW = image.naturalWidth || image.width
    const imgH = image.naturalHeight || image.height

    // 创建导出用全尺寸 canvas
    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = imgW
    exportCanvas.height = imgH
    const ctx = exportCanvas.getContext('2d')

    // 1) 绘制原图 + 滤镜
    ctx.drawImage(image, 0, 0, imgW, imgH)
    if (activeFilter?.apply) {
      const imageData = ctx.getImageData(0, 0, imgW, imgH)
      const filtered = activeFilter.apply(imageData)
      ctx.putImageData(filtered, 0, 0)
    }

    // The same renderer and element state are used for preview and full-size export.
    drawJournal(ctx, imgW, imgH, detections, elements, showOutline)

    // 导出
    const link = document.createElement('a')
    link.download = `doodle-photo-${activeFilter.id}.png`
    const blob = await new Promise(resolve => exportCanvas.toBlob(resolve, 'image/png'))
    if (!blob) { setError('图片导出失败，请重试'); return }
    const url = URL.createObjectURL(blob)
    link.href = url
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }

  const handleReset = () => {
    requestRef.current.controller?.abort()
    requestRef.current.sequence++
    requestRef.current.correcting = false
    requestRef.current.file = null
    setCorrectionBusy(false)
    setLoading(false)
    setElements([])
    setImage(null)
    setDetections([])
    setLayoutMeta({ theme: '其他', emotion: '治愈', safeZone: null, decorationZones: [], decorations: [] })
    setError(null)
    setGenerated(false)
    setActiveFilter(FILTERS[0])
  }

  const handleDismissError = () => setError(null)

  const handleElementsChange = next => {
    setElements(next)
    setDetections(current => retainSubjectCaptions(current, next))
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 via-white to-amber-50">
      <nav className="mode-switch" aria-label="创作模式">
        <button className="journal-button" data-testid="mode-single" aria-pressed={mode === 'single'} onClick={() => setMode('single')}>单图手账</button>
        <button className="journal-button" data-testid="mode-collage" aria-pressed={mode === 'collage'} onClick={() => { setCollageMounted(true); setMode('collage') }}>贴纸拼贴</button>
      </nav>
      {collageMounted && <div hidden={mode !== 'collage'}><CollageStudio active={mode === 'collage'} /></div>}
      <div hidden={mode !== 'single'} className="max-w-3xl mx-auto px-6 py-10">
        <header className="text-center mb-10">
          <h1 className="text-4xl font-bold text-gray-800 tracking-tight">
            Doodle Photo
          </h1>
          <p className="text-stone-500 mt-2">{JOURNAL_STYLE.name} · 把日常的小美好，收藏成一页</p>
        </header>

        {!image ? (
          <ImageUploader onImageLoad={handleImageLoad} />
        ) : (
          <div className="space-y-6">
            <div className="relative">
              <CanvasEditor
                key={image.src}
                image={image}
                activeFilter={activeFilter}
                canvasRef={canvasRef}
                detections={detections}
                elements={elements}
                onElementsChange={handleElementsChange}
                editable={!loading && !correctionBusy && !generated}
                showOutline={showOutline}
              />
              {loading && <LoadingOverlay />}
              {generated && (
                <div className="absolute top-3 right-3 px-3 py-1 rounded-full
                                bg-black/40 backdrop-blur-sm text-white text-xs font-medium">
                  已生成
                </div>
              )}
            </div>

            {error && (
              <div className="space-y-2">
                <ErrorBanner message={error} onDismiss={handleDismissError} />
                <button className="journal-button" disabled={loading || correctionBusy} onClick={() => handleImageLoad(image, requestRef.current.file)}>重新分析</button>
              </div>
            )}

            {detections.length > 0 && <div className="flex flex-wrap justify-center items-center gap-3 text-xs text-stone-500">
              <span>已识别：{detections.map(d => d.label).join('、')} · {layoutMeta.theme}</span>
              <label className="flex items-center gap-1"><input type="checkbox" checked={showOutline} disabled={generated || correctionBusy}
                onChange={e => setShowOutline(e.target.checked)} />主体描边</label>
              <SubjectCorrection
                key={image.src}
                image={image}
                detections={detections}
                busy={correctionBusy}
                disabled={loading || generated}
                onSegment={(index, geometry, regionIndex) => handleSubjectCorrection('/api/segment', index, geometry, regionIndex)}
                onRefine={(index, geometry, regionIndex) => handleSubjectCorrection('/api/refine', index, geometry, regionIndex)}
              />
              {!detections.some(d => d.shape_points?.length) && <span>轮廓暂不可用，仍可编辑手账装饰</span>}
              {detections.some(d => ['uncertain', 'partial'].includes(d.outline_status)) && <span>部分主体轮廓不可靠，已跳过描边</span>}
              {!elements.length && <span>背景空间较少，可手动添加纸框</span>}
            </div>}

            {detections.length > 0 && <SubjectInventory detections={detections} elements={elements}
              summary={layoutMeta.recognitionSummary} />}

            <FilterSelector
              filters={FILTERS}
              activeId={activeFilter.id}
              onSelect={setActiveFilter}
              disabled={generated || loading || correctionBusy}
            />

            <div className="flex justify-center gap-4">
              {!generated ? (
                <>
                  <button
                    onClick={handleGenerate}
                    disabled={loading || correctionBusy}
                    className="px-6 py-2.5 bg-purple-500 text-white rounded-full
                               font-medium shadow-md shadow-purple-200
                               hover:bg-purple-600 active:scale-95 transition-all"
                  >
                    生成图片
                  </button>
                  <button
                    onClick={handleReset}
                    className="px-6 py-2.5 bg-gray-100 text-gray-600 rounded-full
                               font-medium hover:bg-gray-200 active:scale-95 transition-all"
                  >
                    换一张
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={handleExport}
                    disabled={correctionBusy}
                    className="px-6 py-2.5 bg-green-500 text-white rounded-full
                               font-medium shadow-md shadow-green-200
                               hover:bg-green-600 active:scale-95 transition-all"
                  >
                    导出图片
                  </button>
                  <button
                    onClick={handleBackToEdit}
                    className="px-6 py-2.5 bg-gray-100 text-gray-600 rounded-full
                               font-medium hover:bg-gray-200 active:scale-95 transition-all"
                  >
                    返回编辑
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
