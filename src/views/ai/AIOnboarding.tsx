import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { ArrowRight, Bot, Database, MessageSquare, Plug, ShieldCheck, Workflow } from 'lucide-react'
import { useTranslation } from 'react-i18next'

gsap.registerPlugin(useGSAP, ScrollTrigger)

type AIOnboardingProps = {
  onConfigureProvider: () => void
  onReviewAgents: () => void
  onOpenMcp: () => void
}

export function AIOnboarding({ onConfigureProvider, onReviewAgents, onOpenMcp }: AIOnboardingProps) {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)

  useGSAP(() => {
    const root = rootRef.current
    if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    gsap.fromTo(
      root.querySelectorAll('.ai-onboarding-hero__copy > *'),
      { y: 30, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.9, stagger: 0.09, ease: 'power3.out' },
    )

    const stackCards = Array.from(root.querySelectorAll<HTMLElement>('.ai-onboarding-stack__card'))
    stackCards.forEach((card, index) => {
      gsap.fromTo(card, { y: 56, scale: 0.92 }, {
        y: index * -14,
        scale: 1 - index * 0.018,
        ease: 'none',
        scrollTrigger: {
          trigger: card,
          scroller: root,
          start: 'top 88%',
          end: 'top 42%',
          scrub: 0.8,
        },
      })
    })

    const aside = root.querySelector('.ai-onboarding-desire__aside')
    const desire = root.querySelector('.ai-onboarding-desire')
    if (aside && desire && root.scrollHeight > root.clientHeight + 160) {
      ScrollTrigger.create({
        trigger: desire,
        scroller: root,
        start: 'top top+=24',
        end: 'bottom bottom-=40',
        pin: aside,
        pinSpacing: false,
      })
    }
  }, { scope: rootRef })

  return (
    <div ref={rootRef} className="ai-onboarding">
      <section className="ai-onboarding-hero">
        <div className="ai-onboarding-hero__copy">
          <h2>
            {t('aiChat.onboarding.hero_before')}
            <span className="ai-onboarding-inline-image" aria-hidden="true" />
            {t('aiChat.onboarding.hero_after')}
          </h2>
          <p>{t('aiChat.onboarding.hero_desc')}</p>
          <div className="ai-onboarding-hero__actions">
            <button className="btn primary" onClick={onConfigureProvider}>
              {t('aiChat.onboarding.primary_action')}
              <ArrowRight size={15} aria-hidden="true" />
            </button>
            <button className="btn" onClick={onReviewAgents}>{t('aiChat.onboarding.secondary_action')}</button>
          </div>
        </div>
        <div className="ai-onboarding-hero__scene" aria-hidden="true">
          <div className="ai-onboarding-hero__orb" />
          <MessageSquare size={42} />
        </div>
      </section>

      <section className="ai-onboarding-interest" aria-label={t('aiChat.onboarding.interest_title')}>
        <div className="ai-onboarding-marquee" aria-hidden="true">
          <div>
            {[0, 1].map((round) => (
              <span key={round}>
                {t('aiChat.onboarding.marquee_models')} · {t('aiChat.onboarding.marquee_agents')} · {t('aiChat.onboarding.marquee_tools')} · {t('aiChat.onboarding.marquee_media')} ·
              </span>
            ))}
          </div>
        </div>

        <div className="ai-onboarding-bento">
          <article className="ai-onboarding-bento__card is-architecture">
            <div>
              <Workflow size={20} aria-hidden="true" />
              <h3>{t('aiChat.onboarding.architecture_title')}</h3>
              <p>{t('aiChat.onboarding.architecture_desc')}</p>
            </div>
            <div className="ai-onboarding-accordion">
              {(['provider', 'agent', 'mcp'] as const).map((key) => (
                <button key={key} onClick={key === 'provider' ? onConfigureProvider : key === 'agent' ? onReviewAgents : onOpenMcp}>
                  <span>{t(`aiChat.onboarding.${key}_title`)}</span>
                  <small>{t(`aiChat.onboarding.${key}_short`)}</small>
                </button>
              ))}
            </div>
          </article>

          <article className="ai-onboarding-bento__card is-boundary">
            <ShieldCheck size={20} aria-hidden="true" />
            <h3>{t('aiChat.onboarding.boundary_title')}</h3>
            <p>{t('aiChat.onboarding.boundary_desc')}</p>
          </article>

          <button className="ai-onboarding-bento__card is-provider" onClick={onConfigureProvider}>
            <Database size={18} aria-hidden="true" />
            <span>{t('aiChat.onboarding.provider_title')}</span>
            <ArrowRight size={14} aria-hidden="true" />
          </button>
          <button className="ai-onboarding-bento__card is-agent" onClick={onReviewAgents}>
            <Bot size={18} aria-hidden="true" />
            <span>{t('aiChat.onboarding.agent_title')}</span>
            <ArrowRight size={14} aria-hidden="true" />
          </button>
          <button className="ai-onboarding-bento__card is-mcp" onClick={onOpenMcp}>
            <Plug size={18} aria-hidden="true" />
            <span>{t('aiChat.onboarding.mcp_title')}</span>
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className="ai-onboarding-desire">
        <aside className="ai-onboarding-desire__aside">
          <h3>{t('aiChat.onboarding.desire_title')}</h3>
          <p>{t('aiChat.onboarding.desire_desc')}</p>
        </aside>
        <div className="ai-onboarding-stack">
          {(['provider', 'agent', 'mcp'] as const).map((key, index) => (
            <article key={key} className="ai-onboarding-stack__card" style={{ zIndex: index + 1 }}>
              <strong>{t(`aiChat.onboarding.stack_${key}_title`)}</strong>
              <p>{t(`aiChat.onboarding.stack_${key}_desc`)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ai-onboarding-action">
        <h3>{t('aiChat.onboarding.action_title')}</h3>
        <p>{t('aiChat.onboarding.action_desc')}</p>
        <button className="btn primary" onClick={onConfigureProvider}>
          {t('aiChat.onboarding.primary_action')}
          <ArrowRight size={15} aria-hidden="true" />
        </button>
        <footer>{t('aiChat.onboarding.footer')}</footer>
      </section>
    </div>
  )
}
