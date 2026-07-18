import { CheckCircle2, CircleX, Clock3, LoaderCircle, ShieldAlert, Wrench } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AIChatMessagePart } from './chatUtils'

type ToolCallPart = Extract<AIChatMessagePart, { type: 'tool_call' }>
type ToolResultPart = Extract<AIChatMessagePart, { type: 'tool_result' }>

type ToolCallCardProps = {
  call: ToolCallPart
  result?: ToolResultPart
}

function StatusIcon({ status }: { status: ToolCallPart['status'] }) {
  if (status === 'completed') return <CheckCircle2 size={14} />
  if (status === 'failed' || status === 'rejected' || status === 'cancelled') return <CircleX size={14} />
  if (status === 'running') return <LoaderCircle className="is-spinning" size={14} />
  if (status === 'waiting_for_approval') return <ShieldAlert size={14} />
  return <Clock3 size={14} />
}

export function ToolCallCard({ call, result }: ToolCallCardProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const displayStatus = result && call.status !== 'failed' && call.status !== 'rejected' ? 'completed' : call.status

  return (
    <section className={`ai-tool-card is-${displayStatus}`} data-tool-call-id={call.toolCallId}>
      <button className="ai-tool-card__summary" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <span className="ai-tool-card__icon"><Wrench size={14} /></span>
        <span className="ai-tool-card__identity">
          <strong>{call.toolName}</strong>
          <small>{call.serverName ?? t('aiChat.tools.mcp_server', { id: call.serverId })}</small>
        </span>
        <span className={`ai-tool-card__risk is-${call.risk ?? 'read'}`}>
          {t(`aiChat.tools.risk_${call.risk ?? 'read'}`)}
        </span>
        <span className="ai-tool-card__status">
          <StatusIcon status={displayStatus} />
          {t(`aiChat.tools.status_${displayStatus}`)}
        </span>
      </button>
      {expanded && (
        <div className="ai-tool-card__details">
          {call.argumentsSummary && (
            <div>
              <span>{t('aiChat.tools.arguments')}</span>
              <pre>{call.argumentsSummary}</pre>
            </div>
          )}
          {result?.summary && (
            <div>
              <span>{t('aiChat.tools.result')}</span>
              <pre>{result.summary}</pre>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
