import { ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AIChatToolApproval } from './chatUtils'

type ToolApprovalDialogProps = {
  approval: AIChatToolApproval
  submitting: boolean
  onDecision: (decision: 'approve_once' | 'approve_session' | 'reject') => void
}

export function ToolApprovalDialog({ approval, submitting, onDecision }: ToolApprovalDialogProps) {
  const { t } = useTranslation()
  return (
    <div className="ai-tool-approval" role="alertdialog" aria-modal="true" aria-labelledby="ai-tool-approval-title">
      <div className="ai-tool-approval__backdrop" />
      <section className="ai-tool-approval__panel">
        <div className="ai-tool-approval__heading">
          <span><ShieldAlert size={18} /></span>
          <div>
            <h2 id="ai-tool-approval-title">{t('aiChat.tools.approval_title')}</h2>
            <p>{t('aiChat.tools.approval_desc')}</p>
          </div>
        </div>
        <dl>
          <div><dt>{t('aiChat.tools.tool')}</dt><dd>{approval.toolName}</dd></div>
          <div><dt>{t('aiChat.tools.server')}</dt><dd>{approval.serverName}</dd></div>
          <div><dt>{t('aiChat.tools.risk')}</dt><dd>{t(`aiChat.tools.risk_${approval.risk}`)}</dd></div>
        </dl>
        <div className="ai-tool-approval__arguments">
          <span>{t('aiChat.tools.arguments')}</span>
          <pre>{approval.argumentsSummary}</pre>
        </div>
        <div className="ai-tool-approval__actions">
          <button className="btn" disabled={submitting} onClick={() => onDecision('reject')}>{t('aiChat.tools.reject')}</button>
          <button className="btn" disabled={submitting} onClick={() => onDecision('approve_session')}>{t('aiChat.tools.approve_session')}</button>
          <button className="btn primary" disabled={submitting} onClick={() => onDecision('approve_once')}>{t('aiChat.tools.approve_once')}</button>
        </div>
      </section>
    </div>
  )
}
