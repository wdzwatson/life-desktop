export const DOUYIN_AUTO_LIKE_SCRIPT = String.raw`(() => {
  const CONTROLLER_KEY = '__lifeosDouyinAutoLikeController';
  const BUTTON_ID = '__lifeosDouyinAutoLikeButton';
  const TARGET_SELECTOR = '#LikeLayout > div';
  const START_DELAY_MS = 5000;
  const CLICK_INTERVAL_MS = 400;
  const DOUBLE_CLICK_GAP_MS = 100;

  if (location.hostname !== 'live.douyin.com') {
    return {
      success: false,
      code: 'unsupported_site',
      message: 'This script only supports https://live.douyin.com/.',
      url: location.href,
    };
  }

  const existing = window[CONTROLLER_KEY];
  if (existing?.version === 1 && document.getElementById(BUTTON_ID)) {
    return {
      success: true,
      alreadyInstalled: true,
      running: Boolean(existing.running),
      url: location.href,
    };
  }
  existing?.destroy?.();
  document.getElementById(BUTTON_ID)?.remove();

  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.type = 'button';
  button.textContent = '开始';
  Object.assign(button.style, {
    padding: '10px 18px',
    fontSize: '16px',
    fontWeight: '500',
    cursor: 'pointer',
    position: 'fixed',
    bottom: '100px',
    left: '30px',
    zIndex: '2147483647',
    backgroundColor: '#409EFF',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(64, 158, 255, 0.3)',
    transition: 'all 0.3s ease',
  });

  const controller = {
    version: 1,
    running: false,
    intervalId: null,
    startDelayId: null,
    button,
    destroy: () => {
      if (controller.startDelayId !== null) window.clearTimeout(controller.startDelayId);
      if (controller.intervalId !== null) window.clearInterval(controller.intervalId);
      button.remove();
      if (window[CONTROLLER_KEY] === controller) delete window[CONTROLLER_KEY];
    },
  };

  const updateButton = () => {
    button.textContent = controller.running ? '停止' : '开始';
    button.style.backgroundColor = controller.running ? '#f56c6c' : '#409EFF';
  };

  const createClickEvent = (x, y) => new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: 1,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
  });

  const clickLikeTarget = () => {
    if (!controller.running) return;
    const target = document.querySelector(TARGET_SELECTOR);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const x = Math.round(rect.left + Math.max(1, Math.min(rect.width - 1, rect.width / 2)));
    const y = Math.round(rect.top + Math.max(1, Math.min(rect.height - 1, rect.height / 2)));
    target.dispatchEvent(createClickEvent(x, y));
    window.setTimeout(() => {
      if (controller.running && target.isConnected) target.dispatchEvent(createClickEvent(x + 2, y + 2));
    }, DOUBLE_CLICK_GAP_MS);
  };

  button.addEventListener('mouseenter', () => {
    button.style.backgroundColor = controller.running ? '#dd6161' : '#337ecc';
    button.style.boxShadow = '0 6px 16px rgba(64, 158, 255, 0.4)';
  });
  button.addEventListener('mouseleave', () => {
    button.style.backgroundColor = controller.running ? '#f56c6c' : '#409EFF';
    button.style.boxShadow = '0 4px 12px rgba(64, 158, 255, 0.3)';
  });
  button.addEventListener('click', () => {
    controller.running = !controller.running;
    updateButton();
  });

  controller.startDelayId = window.setTimeout(() => {
    controller.intervalId = window.setInterval(clickLikeTarget, CLICK_INTERVAL_MS);
  }, START_DELAY_MS);
  window[CONTROLLER_KEY] = controller;
  (document.body || document.documentElement).appendChild(button);
  return {
    success: true,
    alreadyInstalled: false,
    running: false,
    url: location.href,
    targetSelector: TARGET_SELECTOR,
    startDelayMs: START_DELAY_MS,
    clickIntervalMs: CLICK_INTERVAL_MS,
    doubleClickGapMs: DOUBLE_CLICK_GAP_MS,
  };
})()`
