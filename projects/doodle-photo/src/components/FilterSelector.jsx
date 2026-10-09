export default function FilterSelector({ filters, activeId, onSelect, disabled }) {
  return (
    <div className="flex flex-wrap gap-3 justify-center">
      {filters.map((f) => (
        <button
          key={f.id}
          disabled={disabled}
          onClick={() => !disabled && onSelect(f)}
          className={`px-5 py-2 rounded-full text-sm font-medium transition-all duration-200
            ${activeId === f.id
              ? 'bg-purple-500 text-white shadow-md shadow-purple-200'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }
            ${disabled
              ? 'opacity-50 cursor-not-allowed hover:bg-gray-100'
              : 'cursor-pointer'
            }`}
        >
          {f.name}
        </button>
      ))}
    </div>
  )
}
