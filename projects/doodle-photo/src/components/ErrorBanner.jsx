export default function ErrorBanner({ message, onDismiss }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-xl
                    bg-red-50 border border-red-200 text-red-600
                    animate-[fadeIn_0.2s_ease-out]">
      {/* 图标 */}
      <svg className="w-5 h-5 mt-0.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd"
              d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673
                 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485
                 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0
                 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd" />
      </svg>

      {/* 文案 */}
      <div className="flex-1 text-sm leading-relaxed">
        <span className="font-medium">涂鸦标注暂不可用：</span>{' '}
        {message}
      </div>

      {/* 关闭按钮 */}
      <button
        onClick={onDismiss}
        className="shrink-0 mt-0.5 text-red-400 hover:text-red-600 transition-colors"
        aria-label="关闭提示"
      >
        <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1
                   0 111.414 1.414L11.414 10l4.293 4.293a1 1 0
                   01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0
                   01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd" />
        </svg>
      </button>
    </div>
  )
}
