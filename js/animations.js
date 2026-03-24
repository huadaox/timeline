/**
 * animations.js - IntersectionObserver card entrance + tooltip
 */
const Animations = (() => {
  let observer = null;
  let tooltipEl, tooltipCover, tooltipTitle, tooltipTier, tooltipPlatform, tooltipDate;

  function ensureDOM() {
    if (tooltipEl) return;
    tooltipEl = document.getElementById('tooltip');
    tooltipCover = document.getElementById('tooltip-cover');
    tooltipTitle = document.getElementById('tooltip-title');
    tooltipTier = document.getElementById('tooltip-tier');
    tooltipPlatform = document.getElementById('tooltip-platform');
    tooltipDate = document.getElementById('tooltip-date');
  }

  function initObserver() {
    if (observer) observer.disconnect();

    // Queue for staggering animations
    let animQueue = [];
    let animFrame = null;

    function flushQueue() {
      animFrame = null;
      const batch = animQueue.splice(0, animQueue.length);
      batch.forEach((card, i) => {
        // Stagger each card by 50ms
        setTimeout(() => {
          if (card.classList.contains('card-hidden')) {
            card.classList.remove('card-hidden');
            card.classList.add('card-enter');
            card.addEventListener('animationend', () => {
              card.classList.remove('card-enter');
            }, { once: true });
          }
        }, i * 50);
      });
    }

    observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animQueue.push(entry.target);
          observer.unobserve(entry.target);
        }
      });
      if (animQueue.length > 0 && !animFrame) {
        animFrame = requestAnimationFrame(flushQueue);
      }
    }, {
      root: document.getElementById('timeline-scroll'),
      rootMargin: '0px 150px 0px 150px',
      threshold: 0
    });

    return observer;
  }

  function observeCard(card) {
    if (!observer) initObserver();
    card.classList.add('card-hidden');
    observer.observe(card);
  }

  function showTooltip(card, gameData, event) {
    ensureDOM();
    tooltipCover.src = gameData.cover || '';
    tooltipCover.onerror = () => { tooltipCover.style.display = 'none'; };
    tooltipCover.onload = () => { tooltipCover.style.display = ''; };
    tooltipTitle.textContent = gameData.title;

    tooltipTier.textContent = gameData.tier;
    tooltipTier.className = 'tooltip-tier ' + gameData.tier;

    tooltipPlatform.textContent = gameData.platform;

    const isRemoved = card.classList.contains('removed');
    if (isRemoved) {
      tooltipDate.textContent = `出库: ${formatDate(gameData.removedDate)}`;
    } else {
      tooltipDate.textContent = `入库: ${formatDate(gameData.addedDate)}`;
      if (gameData.removedDate) {
        tooltipDate.textContent += ` → 出库: ${formatDate(gameData.removedDate)}`;
      }
    }

    if (gameData.isEssentialClaim) {
      tooltipDate.textContent += ' (领取后永久)';
    }

    tooltipEl.hidden = false;
    positionTooltip(event);
  }

  function positionTooltip(event) {
    const x = event.clientX + 16;
    const y = event.clientY + 16;
    const rect = tooltipEl.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 10;
    const maxY = window.innerHeight - rect.height - 10;

    tooltipEl.style.left = Math.min(x, maxX) + 'px';
    tooltipEl.style.top = Math.min(y, maxY) + 'px';
  }

  function moveTooltip(event) {
    ensureDOM();
    if (!tooltipEl.hidden) {
      positionTooltip(event);
    }
  }

  function hideTooltip() {
    ensureDOM();
    tooltipEl.hidden = true;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '未知';
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getFullYear()}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getDate().toString().padStart(2,'0')}`;
  }

  function reset() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  return { initObserver, observeCard, showTooltip, moveTooltip, hideTooltip, reset };
})();
