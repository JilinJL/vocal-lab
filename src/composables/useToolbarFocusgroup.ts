import { onBeforeUnmount, onMounted, type Ref } from 'vue'

/**
 * Progressive roving-tabindex fallback for role="toolbar" with focusgroup="toolbar wrap".
 * Only activates when native HTML focusgroup is unsupported.
 */
export function useToolbarFocusgroup(toolbarRef: Ref<HTMLElement | null>) {
  let cleanup: (() => void) | null = null

  onMounted(() => {
    const bar = toolbarRef.value
    if (!bar) return
    if ('focusGroup' in HTMLElement.prototype) return

    const getItems = () =>
      Array.from(bar.querySelectorAll<HTMLElement>('button, [role="button"], select, input'))

    const items = getItems()
    if (items.length === 0) return

    items.forEach((el, idx) => {
      el.tabIndex = idx === 0 ? 0 : -1
    })

    const onFocusIn = (e: FocusEvent) => {
      const currentItems = getItems()
      const target = e.target as HTMLElement | null
      if (!target || !currentItems.includes(target)) return
      currentItems.forEach((el) => {
        el.tabIndex = el === target ? 0 : -1
      })
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const currentItems = getItems()
      const idx = currentItems.indexOf(document.activeElement as HTMLElement)
      if (idx === -1) return

      const vertical = bar.getAttribute('aria-orientation') === 'vertical'
      const rtl = getComputedStyle(bar).direction === 'rtl'
      const steps: Record<string, number> = vertical
        ? { ArrowDown: 1, ArrowUp: -1 }
        : { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }

      let nextIdx: number | null = null
      if (e.key in steps) {
        nextIdx = (idx + steps[e.key]! + currentItems.length) % currentItems.length
      } else if (e.key === 'Home') {
        nextIdx = 0
      } else if (e.key === 'End') {
        nextIdx = currentItems.length - 1
      }

      if (nextIdx !== null) {
        e.preventDefault()
        currentItems.forEach((el, i) => {
          el.tabIndex = i === nextIdx ? 0 : -1
        })
        currentItems[nextIdx]?.focus()
      }
    }

    bar.addEventListener('focusin', onFocusIn)
    bar.addEventListener('keydown', onKeyDown)

    cleanup = () => {
      bar.removeEventListener('focusin', onFocusIn)
      bar.removeEventListener('keydown', onKeyDown)
    }
  })

  onBeforeUnmount(() => {
    cleanup?.()
  })
}
