export const decidePdfReaderVirtualization = (metrics) => {
  const frameBudget = Math.max(1, metrics.scrollFrameBudgetMs)
  const heavyStage = Math.max(0.01, metrics.minimumHeavyPageStageMs)
  const outlineJumpFrameShare = metrics.outlineJumpStructureP95Ms / frameBudget
  const outlineJumpHeavyStageShare = metrics.outlineJumpStructureP95Ms / heavyStage
  const resizeFrameShare = metrics.resizeLayoutP95Ms / frameBudget
  const reasons = []

  if (outlineJumpFrameShare >= 0.25) reasons.push('outline-jump-exceeds-quarter-frame')
  if (outlineJumpHeavyStageShare >= 0.2) reasons.push('outline-jump-exceeds-heavy-stage-share')
  if (resizeFrameShare >= 1) reasons.push('resize-layout-exceeds-frame')

  return {
    implementVirtualization: reasons.length > 0,
    outlineJumpFrameShare,
    outlineJumpHeavyStageShare,
    resizeFrameShare,
    reasons,
  }
}
