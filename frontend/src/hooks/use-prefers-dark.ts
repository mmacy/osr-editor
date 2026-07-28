// The OS color-scheme preference, live: the map surfaces pick their canvas
// theme from it (the DOM UI restyles itself through CSS media queries, but a
// canvas has to be told).
import { useEffect, useState } from 'react'

export function usePrefersDark(): boolean {
  const [dark, setDark] = useState(
    () =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setDark(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return dark
}
