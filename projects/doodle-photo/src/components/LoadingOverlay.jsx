export default function LoadingOverlay() {
  return (
    <div className="absolute inset-0 bg-white/70 backdrop-blur-sm rounded-xl
                    flex flex-col items-center justify-center z-10">
      {/* 三层同心旋转圆环 */}
      <div className="relative w-16 h-16 mb-4">
        <div className="absolute inset-0 rounded-full border-[3px] border-purple-200
                        border-t-purple-500 animate-spin" />
        <div className="absolute inset-2 rounded-full border-[3px] border-pink-200
                        border-b-pink-400 animate-[spin_1.5s_linear_infinite_reverse]" />
        <div className="absolute inset-4 rounded-full border-[3px] border-blue-200
                        border-l-blue-400 animate-[spin_2s_linear_infinite]" />
      </div>
      <p className="text-gray-500 text-sm font-medium tracking-wide animate-pulse">
        AI 正在观察你的照片 ...
      </p>
    </div>
  )
}
