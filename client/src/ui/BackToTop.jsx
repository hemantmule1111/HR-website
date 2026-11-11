import { useEffect, useState } from 'react'
import Icon from './Icon'

// Floating "scroll to top" button; appears once the page is scrolled down.
export default function BackToTop() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 300)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <button type="button" className={`back-to-top ${show ? 'show' : ''}`} aria-label="Back to top" title="Back to top" tabIndex={show ? 0 : -1}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
      <Icon name="arrowup" size={20} />
    </button>
  )
}
