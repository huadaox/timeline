/**
 * timeline.js - Timeline rendering, layout, drag scroll, zoom
 *
 * Layout: each date-group is a grid of max ROWS rows; extra cards
 * spill into additional columns.  Month widths stretch to fit.
 */
const Timeline = (() => {
  let container, scroll, content, addedEl, removedEl, axisEl, zoomLevelEl;

  function ensureDOM() {
    if (container) return;
    container = document.getElementById('timeline-container');
    scroll = document.getElementById('timeline-scroll');
    content = document.getElementById('timeline-content');
    addedEl = document.getElementById('timeline-added');
    removedEl = document.getElementById('timeline-removed');
    axisEl = document.getElementById('timeline-axis');
    zoomLevelEl = document.getElementById('zoom-level');
  }

  const START_DATE = new Date(2022, 5, 1); // June 2022
  let endDate = new Date();
  endDate.setMonth(endDate.getMonth() + 1);

  const BASE_MONTH_WIDTH = 120; // minimum month width before zoom
  let zoomLevel = 1;
  const ZOOM_MIN = 0.4;
  const ZOOM_MAX = 3;
  const CARD_SIZE = 56;
  const CARD_GAP = 4;
  const ROWS = 4;          // max rows per side (above / below axis)
  const DATE_GAP = 12;     // horizontal gap between date groups within a month
  const PADDING = 60;

  // Drag state
  let isDragging = false;
  let startX = 0;
  let scrollLeftStart = 0;
  let velocity = 0;
  let lastX = 0;
  let lastTime = 0;
  let momentumId = null;

  let cardElements = new Map();

  // ── Layout data computed per render ──
  // monthOffsets[i] = pixel x where month i starts (after PADDING)
  let monthOffsets = [];
  let totalWidth = 0;

  function getMonthCount() {
    return Math.max(
      (endDate.getFullYear() - START_DATE.getFullYear()) * 12
        + (endDate.getMonth() - START_DATE.getMonth()),
      1
    );
  }

  /** How many card-columns a date-group needs */
  function columnsFor(count) {
    return Math.max(1, Math.ceil(count / ROWS));
  }

  /** Pixel width one card-column occupies */
  function colWidth() {
    return (CARD_SIZE + CARD_GAP) * zoomLevel;
  }

  /**
   * Build monthOffsets[] so each month is wide enough for its content.
   * Returns {addedGroups, removedGroups} used later by renderCards.
   */
  function computeLayout(addedGroups, removedGroups) {
    const months = getMonthCount();
    const cw = colWidth();
    const minMonth = BASE_MONTH_WIDTH * zoomLevel;

    monthOffsets = new Array(months + 1);
    let x = PADDING;

    for (let i = 0; i < months; i++) {
      monthOffsets[i] = x;

      // Collect date groups that fall in this month
      const monthKey = monthIndexToKey(i);
      let maxCols = 0; // total columns needed for this month (added + removed)

      // Sum columns across all date-groups in this month
      let addedCols = 0;
      let removedCols = 0;
      for (const dk in addedGroups) {
        if (dk.slice(0, 7) === monthKey) {
          addedCols += columnsFor(addedGroups[dk].length) + 0.5; // +gap
        }
      }
      for (const dk in removedGroups) {
        if (dk.slice(0, 7) === monthKey) {
          removedCols += columnsFor(removedGroups[dk].length) + 0.5;
        }
      }
      maxCols = Math.max(addedCols, removedCols);

      const contentWidth = maxCols * cw + DATE_GAP;
      x += Math.max(minMonth, contentWidth);
    }

    monthOffsets[months] = x;
    totalWidth = x + PADDING;
  }

  function monthIndexToKey(i) {
    const d = new Date(START_DATE.getFullYear(), START_DATE.getMonth() + i, 1);
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${yy}-${mm}`;
  }

  /** Get the month-index for a date string "YYYY-MM-DD" */
  function dateToMonthIndex(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return (d.getFullYear() - START_DATE.getFullYear()) * 12
      + (d.getMonth() - START_DATE.getMonth());
  }

  /** Approximate x for a date (for today-marker / search scroll) */
  function dateToX(dateStr) {
    const mi = dateToMonthIndex(dateStr);
    if (mi < 0 || mi >= monthOffsets.length - 1) return PADDING;
    const mStart = monthOffsets[mi];
    const mEnd = monthOffsets[mi + 1];
    const d = new Date(dateStr + 'T00:00:00');
    const dayFrac = (d.getDate() - 1) / 30;
    return mStart + (mEnd - mStart) * dayFrac;
  }

  // ── Render ──

  function renderAxis() {
    ensureDOM();
    axisEl.innerHTML = '';
    content.style.width = totalWidth + 'px';

    const months = getMonthCount();
    const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

    for (let i = 0; i <= months; i++) {
      const date = new Date(START_DATE.getFullYear(), START_DATE.getMonth() + i, 1);
      const x = (i < monthOffsets.length) ? monthOffsets[i] : totalWidth - PADDING;

      const marker = document.createElement('div');
      marker.className = 'month-marker';
      marker.style.left = x + 'px';

      const isYearStart = date.getMonth() === 0;
      marker.innerHTML = `
        <div class="month-tick"></div>
        <div class="month-label${isYearStart ? ' year-start' : ''}">
          ${isYearStart ? date.getFullYear() + '年 ' : ''}${monthNames[date.getMonth()]}
        </div>
      `;
      axisEl.appendChild(marker);
    }

    // Today marker
    const today = new Date();
    if (today >= START_DATE && today <= endDate) {
      const todayStr = today.toISOString().slice(0, 10);
      const x = dateToX(todayStr);
      const tm = document.createElement('div');
      tm.className = 'today-marker';
      tm.style.left = x + 'px';
      tm.innerHTML = `
        <div class="today-dot"></div>
        <div class="today-label">今天</div>
        <div class="today-line"></div>
      `;
      axisEl.appendChild(tm);
    }
  }

  function renderCards(games, filters) {
    ensureDOM();
    addedEl.innerHTML = '';
    removedEl.innerHTML = '';
    cardElements.clear();
    Animations.reset();

    const filteredGames = games.filter(g => {
      if (filters.tier !== 'all' && g.tier !== filters.tier) return false;
      if (filters.platform !== 'all' && !g.platform.includes(filters.platform)) return false;
      if (filters.search && !g.title.toLowerCase().includes(filters.search.toLowerCase())) return false;
      return true;
    });

    // Group by date
    const addedGroups = {};
    const removedGroups = {};

    filteredGames.forEach(game => {
      const ak = game.addedDate;
      if (!addedGroups[ak]) addedGroups[ak] = [];
      addedGroups[ak].push({ game, type: 'added' });

      if (game.removedDate && !game.isEssentialClaim) {
        const rk = game.removedDate;
        if (!removedGroups[rk]) removedGroups[rk] = [];
        removedGroups[rk].push({ game, type: 'removed' });
      }
    });

    // Compute layout (sets monthOffsets, totalWidth)
    computeLayout(addedGroups, removedGroups);

    // Render axis with computed widths
    renderAxis();

    const halfH = scroll.clientHeight / 2;
    addedEl.style.height = halfH + 'px';
    removedEl.style.height = halfH + 'px';

    placeGroups(addedGroups, addedEl, 'added');
    placeGroups(removedGroups, removedEl, 'removed');
  }

  /**
   * Place all date-groups for one side (added / removed).
   * Within each month, date-groups are laid out left→right.
   */
  function placeGroups(groups, parentEl, type) {
    // Organise groups by month
    const byMonth = {}; // monthIndex → [ {dateKey, items} ]
    for (const dk in groups) {
      const mi = dateToMonthIndex(dk);
      if (!byMonth[mi]) byMonth[mi] = [];
      byMonth[mi].push({ dateKey: dk, items: groups[dk] });
    }

    const cw = colWidth();

    for (const mi in byMonth) {
      const dateGroups = byMonth[mi];
      dateGroups.sort((a, b) => a.dateKey.localeCompare(b.dateKey));

      const mStart = monthOffsets[mi];
      const mEnd = monthOffsets[+mi + 1] || totalWidth - PADDING;
      // Centre the date groups within the month
      let totalCols = 0;
      dateGroups.forEach(dg => {
        totalCols += columnsFor(dg.items.length);
      });
      const totalGap = (dateGroups.length - 1) * DATE_GAP;
      const contentW = totalCols * cw + totalGap;
      let cursorX = mStart + ((mEnd - mStart) - contentW) / 2;

      dateGroups.forEach(dg => {
        const cols = columnsFor(dg.items.length);

        dg.items.forEach((item, idx) => {
          const col = Math.floor(idx / ROWS);
          const row = idx % ROWS;

          const card = createCard(item.game, type);
          const cx = cursorX + col * cw;

          card.style.left = cx + 'px';

          if (type === 'added') {
            card.style.bottom = (8 + row * (CARD_SIZE + CARD_GAP)) + 'px';
          } else {
            card.style.top = (8 + row * (CARD_SIZE + CARD_GAP)) + 'px';
          }

          card.dataset.dateGroup = dg.dateKey;
          parentEl.appendChild(card);
          cardElements.set(item.game.id + '-' + type, card);
          Animations.observeCard(card);
        });

        cursorX += cols * cw + DATE_GAP;
      });
    }
  }

  function createCard(game, type) {
    const card = document.createElement('div');
    card.className = `game-card ${type}`;
    card.dataset.gameId = game.id;

    const placeholder = document.createElement('div');
    placeholder.className = 'game-card-placeholder';
    placeholder.textContent = game.title.length > 20 ? game.title.slice(0, 18) + '…' : game.title;
    card.appendChild(placeholder);

    if (game.cover) {
      const img = document.createElement('img');
      img.className = 'game-card-cover';
      img.loading = 'lazy';
      img.alt = game.title;
      // Request thumbnail size from PS CDN (much smaller download)
      img.src = game.cover + '?w=128';
      img.onload = () => {
        placeholder.style.display = 'none';
        img.style.opacity = '1';
      };
      img.onerror = () => img.remove();
      img.style.opacity = '0';
      img.style.transition = 'opacity 0.3s ease';
      img.style.position = 'absolute';
      img.style.inset = '0';
      card.appendChild(img);
    }

    const badge = document.createElement('div');
    badge.className = `tier-badge ${game.tier}`;
    badge.textContent = game.tier[0].toUpperCase();
    card.appendChild(badge);

    if (game.isEssentialClaim) {
      const star = document.createElement('span');
      star.className = 'essential-star';
      star.textContent = '★';
      card.appendChild(star);
    }

    card.addEventListener('mouseenter', e => Animations.showTooltip(card, game, e));
    card.addEventListener('mousemove', e => Animations.moveTooltip(e));
    card.addEventListener('mouseleave', () => Animations.hideTooltip());
    card.addEventListener('click', () => {
      if (game.psStoreUrl) window.open(game.psStoreUrl, '_blank', 'noopener');
    });

    return card;
  }

  // ── Drag / Touch / Wheel ──

  function initDragScroll() {
    ensureDOM();
    scroll.addEventListener('mousedown', onDragStart);
    scroll.addEventListener('mousemove', onDragMove);
    scroll.addEventListener('mouseup', onDragEnd);
    scroll.addEventListener('mouseleave', onDragEnd);
    scroll.addEventListener('touchstart', onTouchStart, { passive: true });
    scroll.addEventListener('touchmove', onTouchMove, { passive: false });
    scroll.addEventListener('touchend', onTouchEnd);
    scroll.addEventListener('wheel', onWheel, { passive: false });
  }

  function onDragStart(e) {
    if (e.button !== 0) return;
    cancelMomentum();
    isDragging = true;
    startX = e.pageX;
    scrollLeftStart = scroll.scrollLeft;
    lastX = e.pageX;
    lastTime = Date.now();
    velocity = 0;
    container.classList.add('dragging');
    e.preventDefault();
  }
  function onDragMove(e) {
    if (!isDragging) return;
    scroll.scrollLeft = scrollLeftStart - (e.pageX - startX);
    const now = Date.now(), dt = now - lastTime;
    if (dt > 0) { velocity = (e.pageX - lastX) / dt; lastX = e.pageX; lastTime = now; }
  }
  function onDragEnd() {
    if (!isDragging) return;
    isDragging = false;
    container.classList.remove('dragging');
    if (Math.abs(velocity) > 0.1) startMomentum();
  }
  function startMomentum() {
    const friction = 0.95;
    (function step() {
      velocity *= friction;
      if (Math.abs(velocity) < 0.01) { cancelMomentum(); return; }
      scroll.scrollLeft -= velocity * 16;
      momentumId = requestAnimationFrame(step);
    })();
  }
  function cancelMomentum() { if (momentumId) { cancelAnimationFrame(momentumId); momentumId = null; } }

  function onTouchStart(e) {
    cancelMomentum(); isDragging = true;
    startX = e.touches[0].pageX; scrollLeftStart = scroll.scrollLeft;
    lastX = startX; lastTime = Date.now(); velocity = 0;
  }
  function onTouchMove(e) {
    if (!isDragging) return;
    const x = e.touches[0].pageX;
    scroll.scrollLeft = scrollLeftStart - (x - startX);
    const now = Date.now(), dt = now - lastTime;
    if (dt > 0) { velocity = (x - lastX) / dt; lastX = x; lastTime = now; }
    e.preventDefault();
  }
  function onTouchEnd() { isDragging = false; if (Math.abs(velocity) > 0.1) startMomentum(); }

  function onWheel(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom(zoomLevel + (e.deltaY > 0 ? -0.1 : 0.1), e.clientX);
    } else {
      e.preventDefault();
      scroll.scrollLeft += (e.deltaY !== 0 ? e.deltaY : e.deltaX) * 1.5;
    }
  }

  function setZoom(level) {
    ensureDOM();
    zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, level));
    zoomLevelEl.textContent = Math.round(zoomLevel * 100) + '%';
    if (typeof App !== 'undefined') App.render();
  }

  function scrollToDate(dateStr) {
    ensureDOM();
    scroll.scrollTo({ left: dateToX(dateStr) - scroll.clientWidth / 2, behavior: 'smooth' });
  }
  function scrollToToday() { scrollToDate(new Date().toISOString().slice(0, 10)); }

  function highlightCard(gameId) {
    document.querySelectorAll('.search-highlight').forEach(el => el.classList.remove('search-highlight'));
    const card = cardElements.get(gameId + '-added');
    if (card) {
      card.classList.add('search-highlight');
      scroll.scrollTo({ left: card.offsetLeft - scroll.clientWidth / 2, behavior: 'smooth' });
      return true;
    }
    return false;
  }

  function getZoom() { return zoomLevel; }

  return { renderAxis, renderCards, initDragScroll, scrollToDate, scrollToToday, highlightCard, setZoom, getZoom, dateToX };
})();
