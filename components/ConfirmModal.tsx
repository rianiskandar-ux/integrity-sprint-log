'use client'

interface Props {
  title: string
  description: string
  whatHappens: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({
  title, description, whatHappens,
  confirmLabel = 'Ya, Lanjutkan',
  cancelLabel = 'Batal',
  danger = false,
  onConfirm, onCancel,
}: Props) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 dark:bg-black/70" onClick={onCancel} />
      <div className="relative w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">

        <div className="px-5 py-5">
          <div className="flex items-start gap-3 mb-3">
            <div className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-base ${danger ? 'bg-red-100 dark:bg-red-950' : 'bg-amber-100 dark:bg-amber-950'}`}>
              {danger ? '⚠️' : '❓'}
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{title}</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{description}</p>
            </div>
          </div>

          <div className={`rounded-xl p-3 text-xs leading-relaxed ${danger ? 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-400 border border-red-100 dark:border-red-900' : 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400 border border-blue-100 dark:border-blue-900'}`}>
            <span className="font-semibold block mb-1">Jika kamu klik "{confirmLabel}":</span>
            {whatHappens}
          </div>
        </div>

        <div className="flex gap-2 px-5 pb-5">
          <button onClick={onCancel}
            className="flex-1 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition">
            {cancelLabel}
          </button>
          <button onClick={onConfirm}
            className={`flex-1 py-2 text-xs font-semibold rounded-xl transition text-white ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
