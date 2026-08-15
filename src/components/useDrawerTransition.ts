import { useCallback, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'

gsap.registerPlugin(useGSAP)

export const DRAWER_MOTION = {
  edgeOffset: 24,
  overlayEnterDuration: 0.36,
  panelEnterDuration: 0.58,
  panelExitDuration: 0.52,
  overlayExitDuration: 0.42,
  overlayExitDelay: 0.06,
  overlayEnterEase: 'power2.out',
  panelEase: 'power2.inOut',
  overlayExitEase: 'power1.inOut',
} as const

type DrawerDirection = 'left' | 'right'

const getHiddenPanelState = (direction: DrawerDirection) => ({
  xPercent: direction === 'right' ? 100 : -100,
  x: direction === 'right' ? DRAWER_MOTION.edgeOffset : -DRAWER_MOTION.edgeOffset,
  opacity: 0,
  transformOrigin: `${direction} center`,
})

const visiblePanelState = { xPercent: 0, x: 0, opacity: 1 }

export function useDrawerTransition(onExitComplete: () => void = () => {}) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isDrawerMounted, setIsDrawerMounted] = useState(false)
  const drawerOverlayRef = useRef<HTMLDivElement | null>(null)
  const drawerPanelRef = useRef<HTMLElement | null>(null)
  const onExitCompleteRef = useRef(onExitComplete)
  onExitCompleteRef.current = onExitComplete

  const openDrawer = useCallback(() => {
    setIsDrawerMounted(true)
    setIsDrawerOpen(true)
  }, [])

  const closeDrawer = useCallback(() => setIsDrawerOpen(false), [])

  useGSAP(
    () => {
      if (!isDrawerMounted) return
      const overlay = drawerOverlayRef.current
      const panel = drawerPanelRef.current
      if (!overlay || !panel) return

      gsap.killTweensOf([overlay, panel])
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (prefersReducedMotion) {
        gsap.set([overlay, panel], { clearProps: 'opacity,transform' })
        if (!isDrawerOpen) {
          setIsDrawerMounted(false)
          onExitCompleteRef.current()
        }
        return
      }

      if (isDrawerOpen) {
        const timeline = gsap.timeline()
        timeline
          .fromTo(
            overlay,
            { opacity: 0 },
            {
              opacity: 1,
              duration: DRAWER_MOTION.overlayEnterDuration,
              ease: DRAWER_MOTION.overlayEnterEase,
            },
          )
          .fromTo(
            panel,
            getHiddenPanelState('right'),
            {
              ...visiblePanelState,
              duration: DRAWER_MOTION.panelEnterDuration,
              ease: DRAWER_MOTION.panelEase,
            },
            0,
          )
        return () => timeline.kill()
      }

      const timeline = gsap.timeline({
        onComplete: () => {
          setIsDrawerMounted(false)
          onExitCompleteRef.current()
        },
      })
      timeline
        .to(panel, {
          ...getHiddenPanelState('right'),
          duration: DRAWER_MOTION.panelExitDuration,
          ease: DRAWER_MOTION.panelEase,
        })
        .to(
          overlay,
          {
            opacity: 0,
            duration: DRAWER_MOTION.overlayExitDuration,
            ease: DRAWER_MOTION.overlayExitEase,
          },
          DRAWER_MOTION.overlayExitDelay,
        )
      return () => timeline.kill()
    },
    { dependencies: [isDrawerOpen, isDrawerMounted] },
  )

  return {
    isDrawerOpen,
    isDrawerMounted,
    openDrawer,
    closeDrawer,
    drawerOverlayRef,
    drawerPanelRef,
  }
}

export function useDrawerPanelTransition(isOpen: boolean, direction: DrawerDirection = 'right') {
  const drawerPanelRef = useRef<HTMLElement | null>(null)
  const hasInitializedRef = useRef(false)

  useGSAP(
    () => {
      const panel = drawerPanelRef.current
      if (!panel) return

      gsap.killTweensOf(panel)
      const hiddenState = getHiddenPanelState(direction)
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (prefersReducedMotion || !hasInitializedRef.current) {
        gsap.set(panel, isOpen ? visiblePanelState : hiddenState)
        hasInitializedRef.current = true
        return
      }

      if (isOpen) {
        const tween = gsap.fromTo(panel, hiddenState, {
          ...visiblePanelState,
          duration: DRAWER_MOTION.panelEnterDuration,
          ease: DRAWER_MOTION.panelEase,
        })
        return () => tween.kill()
      }

      const tween = gsap.to(panel, {
        ...hiddenState,
        duration: DRAWER_MOTION.panelExitDuration,
        ease: DRAWER_MOTION.panelEase,
      })
      return () => tween.kill()
    },
    { dependencies: [direction, isOpen] },
  )

  return drawerPanelRef
}
