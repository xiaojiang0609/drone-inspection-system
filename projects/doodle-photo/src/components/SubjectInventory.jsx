import { buildSubjectInventory } from '../utils/subject-inventory.js'

export default function SubjectInventory({ detections = [], elements = [], summary = null }) {
  const inventory = buildSubjectInventory(detections, elements, summary)
  if (!inventory.groupCount && !inventory.warnings.length) return null

  return <section aria-label="主体清单" data-testid="subject-inventory"
    className="rounded-xl border border-stone-200 bg-white/80 px-4 py-3 text-stone-600">
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid="subject-inventory-counts">
      <span>{inventory.groupCount}组主体</span>
      <span>已放置文字{inventory.placedTextCount}组</span>
      <span>已有描边{inventory.outlinedCount}组</span>
    </p>
    {inventory.warnings.length > 0 && <p className="mt-2 text-xs leading-relaxed text-stone-500">
      {inventory.warnings.join('；')}
    </p>}
    <details className="mt-2">
      <summary className="cursor-pointer rounded py-1 text-sm font-medium text-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500">
        查看全部主体（{inventory.groupCount}组）
      </summary>
      <p className="mt-2 text-xs leading-relaxed text-stone-500">
        识别到但无安全留白的文案仍可在清单查看；未描边不代表未识别。
      </p>
      <ol className="mt-3 divide-y divide-stone-100">
        {inventory.rows.map(row => <li key={row.subjectIndex} className="py-3 first:pt-0 last:pb-0"
          data-testid={`subject-inventory-row-${row.subjectIndex}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <span className="min-w-0 break-words text-sm font-medium text-stone-700">
              {row.subjectIndex + 1}. {row.label}
            </span>
            <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500">
              <span>{row.textStatus}</span>
              <span>{row.outlineStatus}</span>
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">
            {row.caption || '暂无文案'}
          </p>
        </li>)}
      </ol>
    </details>
  </section>
}
