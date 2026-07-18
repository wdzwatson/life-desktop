import React from 'react'
import { AlertTriangle } from 'lucide-react'
import { withTranslation, type WithTranslation } from 'react-i18next'

type State = { failed: boolean }

class AIChatBoundaryBase extends React.Component<React.PropsWithChildren<WithTranslation>, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="ai-chat-boundary" role="alert">
          <AlertTriangle size={22} aria-hidden="true" />
          <div>
            <h2>{this.props.t('aiChat.load_error_title')}</h2>
            <p>{this.props.t('aiChat.load_error_desc')}</p>
          </div>
          <button className="btn" onClick={() => this.setState({ failed: false })}>
            {this.props.t('aiChat.retry')}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export const AIChatBoundary = withTranslation()(AIChatBoundaryBase)
