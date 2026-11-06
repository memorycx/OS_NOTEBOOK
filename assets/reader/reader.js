/* ==========================================================================
   画板阅读器
   - 将 Excalidraw 画板渲染为 SVG（矩形 / 文本 / 箭头 / 线条）
   - 以章节框为线索自动切分 4:3 镜头，像 PPT 一样翻页
   - 支持概览、自由缩放、拖拽、键盘与深链接
   ========================================================================== */
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const root = document.getElementById('reader');
  if (!root) return;

  const stage = document.getElementById('stage');
  const svg = document.getElementById('board');
  const loading = document.getElementById('board-loading');
  const errorBox = document.getElementById('board-error');
  const chapterNum = document.getElementById('chapter-num');
  const chapterTitle = document.getElementById('chapter-title');
  const timeline = document.getElementById('timeline');
  const pagerCount = document.getElementById('pager-count');
  const hint = document.getElementById('hint');
  const overviewButton = document.querySelector('[data-action="overview"]');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = {
    deck: null,
    view: { x: 0, y: 0, w: 100, h: 100 },
    slide: 0,
    mode: 'slide', // slide | overview | free
    raf: 0,
    drag: null,
    pinch: null,
    pointers: new Map(),
    hoverSection: null,
    canvases: null,
    canvasSegs: [],
  };

  let paper;
  let clipRect;
  let overlay;
  let contentGroup;
  let badgeLayer;
  let badges = [];

  /* ------------------------------------------------------------------ */
  /* SVG helpers                                                        */
  /* ------------------------------------------------------------------ */

  function svgEl(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined || value === null) continue;
        node.setAttribute(key, String(value));
      }
    }
    return node;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function hideHint() {
    if (hint) hint.classList.add('is-hidden');
    const touchHint = document.getElementById('touch-hint');
    if (touchHint) touchHint.classList.remove('is-visible');
  }

  /* ------------------------------------------------------------------ */
  /* Scene rendering                                                    */
  /* ------------------------------------------------------------------ */

  function renderScene() {
    const deck = state.deck;
    svg.textContent = '';

    const defs = svgEl('defs');

    const clip = svgEl('clipPath', { id: 'board-clip', clipPathUnits: 'userSpaceOnUse' });
    clipRect = svgEl('rect', { x: -1000, y: -1000, width: 2000, height: 2000 });
    clip.appendChild(clipRect);
    defs.appendChild(clip);

    paper = svgEl('rect', {
      class: 'paper',
      x: -1000,
      y: -1000,
      width: 2000,
      height: 2000,
      fill: deck.background && deck.background !== 'transparent' ? deck.background : '#ffffff',
    });

    const layerRect = svgEl('g', { class: 'layer layer-rect' });
    const layerArrow = svgEl('g', { class: 'layer layer-arrow' });
    const layerText = svgEl('g', { class: 'layer layer-text' });
    overlay = svgEl('g', { class: 'overlay-layer' });

    for (const el of deck.elements) {
      if (el.type === 'rectangle') {
        const node = drawRect(el);
        if (node) layerRect.appendChild(node);
      } else if (el.type === 'arrow' || el.type === 'line') {
        const node = drawLinear(el);
        if (node) layerArrow.appendChild(node);
      } else if (el.type === 'text') {
        const node = drawText(el);
        if (node) layerText.appendChild(node);
      }
    }

    badgeLayer = svgEl('g', { class: 'section-badges' });
    badges = deck.sections.map((section) => {
      const group = svgEl('g', { class: 'section-badge' });
      const pill = svgEl('rect', { class: 'badge-pill', x: 0, y: 0, rx: 0, ry: 0 });
      const label = svgEl('text', {
        class: 'badge-label',
        x: 0,
        y: 0,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
      });
      label.textContent = `§${section.index + 1}`;
      group.appendChild(pill);
      group.appendChild(label);
      badgeLayer.appendChild(group);
      return { section, group, pill, label };
    });

    for (const section of deck.sections) {
      const hit = svgEl('rect', {
        class: 'sec-hit',
        x: section.x,
        y: section.y,
        width: section.w,
        height: section.h,
        tabindex: 0,
        role: 'button',
        'aria-label': `第 ${section.index + 1} 章：${section.title}`,
      });
      hit.addEventListener('click', () => {
        setSlide(section.slideStart);
      });
      hit.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setSlide(section.slideStart);
        }
      });
      hit.addEventListener('pointerenter', () => {
        if (state.mode !== 'overview') return;
        state.hoverSection = section;
        showSectionLabel(section);
      });
      hit.addEventListener('pointerleave', () => {
        if (state.mode !== 'overview') return;
        if (state.hoverSection === section) {
          state.hoverSection = null;
          showSectionLabel(null);
        }
      });
      hit.addEventListener('focus', () => {
        if (state.mode === 'overview') showSectionLabel(section);
      });
      hit.addEventListener('blur', () => {
        if (state.mode === 'overview') showSectionLabel(null);
      });
      overlay.appendChild(hit);
    }

    contentGroup = svgEl('g', { 'clip-path': 'url(#board-clip)' });
    contentGroup.appendChild(layerRect);
    contentGroup.appendChild(layerArrow);
    contentGroup.appendChild(layerText);
    contentGroup.appendChild(badgeLayer);
    contentGroup.appendChild(overlay);

    svg.appendChild(defs);
    svg.appendChild(paper);
    svg.appendChild(contentGroup);
  }

  function drawRect(el) {
    if (!Number.isFinite(el.w) || !Number.isFinite(el.h)) return null;
    const attrs = {
      x: el.x,
      y: el.y,
      width: el.w,
      height: el.h,
      fill: el.bg && el.bg !== 'transparent' ? el.bg : 'none',
      stroke: el.color || '#1e1e1e',
      'stroke-width': el.strokeWidth || 1,
      'stroke-linejoin': 'round',
    };
    if (el.round) {
      const radius = Math.min(32, Math.min(el.w, el.h) * 0.25);
      attrs.rx = radius;
      attrs.ry = radius;
    }
    if (el.strokeStyle === 'dashed') {
      attrs['stroke-dasharray'] = `${Math.max(4, (el.strokeWidth || 1) * 4)} ${Math.max(
        3,
        (el.strokeWidth || 1) * 3
      )}`;
    } else if (el.strokeStyle === 'dotted') {
      attrs['stroke-dasharray'] = `${Math.max(1, (el.strokeWidth || 1) * 1.5)} ${Math.max(
        2,
        (el.strokeWidth || 1) * 3
      )}`;
      attrs['stroke-linecap'] = 'round';
    }
    return svgEl('rect', attrs);
  }

  function drawText(el) {
    if (!el.text) return null;
    const fo = svgEl('foreignObject', {
      x: el.x,
      y: el.y,
      width: Math.max(1, el.w),
      height: Math.max(1, el.h),
    });
    const div = document.createElement('div');
    div.className = 'ex-text';
    div.style.width = Math.max(1, el.w) + 'px';
    div.style.height = Math.max(1, el.h) + 'px';
    div.style.fontSize = el.size + 'px';
    div.style.lineHeight = String(el.lineHeight || 1.25);
    div.style.color = el.color || '#1e1e1e';
    div.style.textAlign = el.align || 'left';
    if (el.valign === 'middle') {
      div.style.display = 'flex';
      div.style.flexDirection = 'column';
      div.style.justifyContent = 'center';
    }
    div.textContent = el.text;
    fo.appendChild(div);
    return fo;
  }

  function drawLinear(el) {
    if (!Array.isArray(el.points) || el.points.length < 2) return null;
    const points = el.points.map(([px, py]) => [el.x + px, el.y + py]);
    const group = svgEl('g');
    const d = points
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${round(x)} ${round(y)}`)
      .join(' ');

    const pathAttrs = {
      d,
      fill: 'none',
      stroke: el.color || '#1e1e1e',
      'stroke-width': el.strokeWidth || 1,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    };
    if (el.strokeStyle === 'dashed') {
      pathAttrs['stroke-dasharray'] = `${Math.max(4, (el.strokeWidth || 1) * 4)} ${Math.max(
        3,
        (el.strokeWidth || 1) * 3
      )}`;
    }
    group.appendChild(svgEl('path', pathAttrs));

    if (el.endArrowhead) {
      group.appendChild(
        arrowHead(
          points[points.length - 2],
          points[points.length - 1],
          el.color || '#1e1e1e',
          el.strokeWidth || 1
        )
      );
    }
    if (el.startArrowhead) {
      group.appendChild(
        arrowHead(points[1], points[0], el.color || '#1e1e1e', el.strokeWidth || 1)
      );
    }
    return group;
  }

  function arrowHead(from, to, color, strokeWidth) {
    const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
    const length = 8 + strokeWidth * 2.2;
    const spread = 0.48;
    const a = [
      to[0] - length * Math.cos(angle - spread),
      to[1] - length * Math.sin(angle - spread),
    ];
    const b = [
      to[0] - length * Math.cos(angle + spread),
      to[1] - length * Math.sin(angle + spread),
    ];
    return svgEl('path', {
      d: `M${round(a[0])} ${round(a[1])} L${round(to[0])} ${round(to[1])} L${round(
        b[0]
      )} ${round(b[1])}`,
      fill: 'none',
      stroke: color,
      'stroke-width': strokeWidth,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    });
  }

  function round(n) {
    return Math.round(n * 100) / 100;
  }

  function showSectionLabel(section) {
    if (section) {
      chapterNum.textContent = `§${section.index + 1}`;
      chapterTitle.textContent = `${section.title} · 点击进入`;
    } else {
      chapterNum.textContent = '§';
      chapterTitle.textContent = '画板概览 · 点击章节进入';
    }
  }

  /* ------------------------------------------------------------------ */
  /* Camera                                                             */
  /* ------------------------------------------------------------------ */

  function applyView() {
    const v = state.view;
    svg.setAttribute('viewBox', `${round(v.x)} ${round(v.y)} ${round(v.w)} ${round(v.h)}`);
    if (paper) {
      paper.setAttribute('x', v.x);
      paper.setAttribute('y', v.y);
      paper.setAttribute('width', v.w);
      paper.setAttribute('height', v.h);
    }
    if (clipRect) {
      clipRect.setAttribute('x', v.x);
      clipRect.setAttribute('y', v.y);
      clipRect.setAttribute('width', v.w);
      clipRect.setAttribute('height', v.h);
    }
    if (badges.length) updateBadges();
  }

  function updateBadges() {
    const view = state.view;
    const size = clamp(view.h * 0.019, 26, 120);
    const height = size * 1.5;
    const width = size * 2.35;
    const radius = height / 2;
    const inset = size * 0.5;

    for (const badge of badges) {
      const { section, group, pill, label } = badge;
      group.setAttribute(
        'transform',
        `translate(${round(section.x + section.w - width - inset)}, ${round(
          section.y + inset
        )})`
      );
      pill.setAttribute('width', round(width));
      pill.setAttribute('height', round(height));
      pill.setAttribute('rx', round(radius));
      pill.setAttribute('ry', round(radius));
      label.setAttribute('x', round(width / 2));
      label.setAttribute('y', round(height / 2));
      label.setAttribute('font-size', round(size * 0.78));
    }
  }

  function animateTo(target, duration) {
    cancelAnimationFrame(state.raf);
    if (!target) return;
    if (duration <= 0 || reduceMotion) {
      state.view = { ...target };
      applyView();
      return;
    }
    const from = { ...state.view };
    const start = performance.now();
    const ease = (t) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    const step = (now) => {
      const t = clamp((now - start) / duration, 0, 1);
      const k = ease(t);
      state.view = {
        x: from.x + (target.x - from.x) * k,
        y: from.y + (target.y - from.y) * k,
        w: from.w + (target.w - from.w) * k,
        h: from.h + (target.h - from.h) * k,
      };
      applyView();
      if (t < 1) state.raf = requestAnimationFrame(step);
    };
    state.raf = requestAnimationFrame(step);
  }

  function overviewTarget() {
    const b = state.deck.bounds;
    const margin = 0.06;
    return {
      x: b.x - b.w * margin,
      y: b.y - b.h * margin,
      w: b.w * (1 + margin * 2),
      h: b.h * (1 + margin * 2),
    };
  }

  /**
   * Expand a camera view to the stage aspect ratio.
   * The limiting dimension (and therefore the content scale) stays the same,
   * so the board fills the stage without cropping anything. Extra room is
   * revealed to the right/below, keeping the slide's top-left anchored.
   */
  function fillStage(view) {
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return view;
    const stageAspect = rect.width / rect.height;
    const viewAspect = view.w / view.h;
    if (!Number.isFinite(stageAspect) || Math.abs(stageAspect - viewAspect) < 0.001) {
      return view;
    }
    if (stageAspect > viewAspect) {
      const w = view.h * stageAspect;
      return { x: view.x + view.w / 2 - w / 2, y: view.y, w, h: view.h };
    }
    return { x: view.x, y: view.y, w: view.w, h: view.w / stageAspect };
  }

  let resizeFrame = 0;

  function fitToStage() {
    if (!state.deck) return;
    cancelAnimationFrame(resizeFrame);
    cancelAnimationFrame(state.raf);
    resizeFrame = requestAnimationFrame(() => {
      if (state.mode === 'slide') {
        const slide = state.deck.slides[state.slide];
        state.view = fillStage({ x: slide.x, y: slide.y, w: slide.w, h: slide.h });
      } else if (state.mode === 'overview') {
        state.view = fillStage(overviewTarget());
      } else {
        state.view = fillStage(state.view);
      }
      applyView();
    });
  }

  /** Rendered position of the paper (viewBox) inside the SVG element. */
  function paperBox(view) {
    const rect = svg.getBoundingClientRect();
    const aspect = view.w / view.h;
    let width = rect.width;
    let height = rect.height;
    let left = rect.left;
    let top = rect.top;
    if (width / height > aspect) {
      width = height * aspect;
      left += (rect.width - width) / 2;
    } else {
      height = width / aspect;
      top += (rect.height - height) / 2;
    }
    return { left, top, width, height };
  }

  function clientToBoard(clientX, clientY, view) {
    const box = paperBox(view);
    return {
      x: view.x + ((clientX - box.left) / box.width) * view.w,
      y: view.y + ((clientY - box.top) / box.height) * view.h,
      u: (clientX - box.left) / box.width,
      v: (clientY - box.top) / box.height,
    };
  }

  function markFree() {
    hideHint();
    const wasOverview = state.mode === 'overview';
    state.mode = 'free';
    if (wasOverview) {
      root.classList.remove('is-overview');
      if (overviewButton) overviewButton.classList.remove('is-active');
      state.hoverSection = null;
      syncSlideUI();
      writeHash();
    }
  }

  function zoomAt(clientX, clientY, factor) {
    cancelAnimationFrame(state.raf);
    const view = { ...state.view };
    const point = clientToBoard(clientX, clientY, view);
    const u = clamp(point.u, 0, 1);
    const v = clamp(point.v, 0, 1);

    const minWidth = Math.max(320, state.deck.bounds.w * 0.075);
    const maxWidth = Math.max(state.deck.bounds.w * 1.9, 2400);
    const newWidth = clamp(view.w * factor, minWidth, maxWidth);
    const ratio = newWidth / view.w;
    const newHeight = view.h * ratio;

    state.view = {
      x: point.x - u * newWidth,
      y: point.y - v * newHeight,
      w: newWidth,
      h: newHeight,
    };
    applyView();
    markFree();
  }

  /* ------------------------------------------------------------------ */
  /* Slide navigation                                                   */
  /* ------------------------------------------------------------------ */

  function setSlide(index, options = {}) {
    if (!state.deck) return;
    const { animate = true, updateHash = true } = options;
    const slides = state.deck.slides;
    state.slide = clamp(index, 0, slides.length - 1);
    state.mode = 'slide';
    state.hoverSection = null;
    root.classList.remove('is-overview');
    if (overviewButton) overviewButton.classList.remove('is-active');

    const slide = slides[state.slide];
    animateTo(
      fillStage({ x: slide.x, y: slide.y, w: slide.w, h: slide.h }),
      animate ? 640 : 0
    );
    syncSlideUI();
    svg.setAttribute('aria-label', `${slide.sectionTitle} · ${slide.title}`);
    if (updateHash) writeHash();
  }

  function setOverview(options = {}) {
    if (!state.deck) return;
    const { animate = true, updateHash = true } = options;
    state.mode = 'overview';
    state.hoverSection = null;
    root.classList.add('is-overview');
    if (overviewButton) overviewButton.classList.add('is-active');
    animateTo(fillStage(overviewTarget()), animate ? 720 : 0);
    syncOverviewUI();
    showSectionLabel(null);
    svg.setAttribute('aria-label', `${state.deck.title} · 画板概览`);
    if (updateHash) writeHash();
  }

  function step(delta) {
    if (!state.deck) return;
    if (state.mode === 'overview') {
      setSlide(state.slide);
      return;
    }
    setSlide(state.slide + delta);
  }

  function syncSlideUI() {
    if (!state.deck) return;
    const slide = state.deck.slides[state.slide];
    chapterNum.textContent = `§${slide.section + 1}`;
    setChapterTitle(slide.title);
    pagerCount.textContent = `${state.slide + 1} / ${state.deck.slides.length}`;
    updateCanvasProgress();
    syncPagerButtons();
  }

  function syncOverviewUI() {
    if (!state.deck) return;
    chapterNum.textContent = '§';
    setChapterTitle('画板概览 · 点击章节进入');
    pagerCount.textContent = '概览';
    updateCanvasProgress();
    syncPagerButtons();
  }

  function setChapterTitle(text) {
    if (chapterTitle.textContent === text) return;
    chapterTitle.textContent = text;
    chapterTitle.classList.remove('is-changing');
    // Force a reflow so the animation can replay.
    void chapterTitle.offsetWidth;
    chapterTitle.classList.add('is-changing');
  }

  function updateCanvasProgress() {
    if (!state.canvasSegs.length) return;
    const progress = state.deck
      ? ((state.slide + 1) / state.deck.slides.length) * 100
      : 0;
    state.canvasSegs.forEach((seg) => {
      if (seg.classList.contains('is-active')) {
        seg.style.setProperty('--progress', `${progress}%`);
      }
    });
  }

  function syncPagerButtons() {
    const prevDisabled = state.slide <= 0;
    const nextDisabled = state.slide >= state.deck.slides.length - 1;
    document.querySelectorAll('[data-action="prev"]').forEach((btn) => {
      btn.disabled = prevDisabled;
    });
    document.querySelectorAll('[data-action="next"]').forEach((btn) => {
      btn.disabled = nextDisabled;
    });
  }

  function buildCanvasAxis() {
    timeline.textContent = '';
    state.canvasSegs = [];
    const currentKey = root.dataset.key;
    const canvases =
      Array.isArray(state.canvases) && state.canvases.length
        ? state.canvases
        : [
            {
              key: currentKey,
              title: state.deck.title,
              lecture: state.deck.lecture,
              slides: state.deck.slides.length,
            },
          ];

    canvases.forEach((canvas, index) => {
      const seg = document.createElement('a');
      seg.className = 'canvas-seg';
      seg.href = canvas.href || `../${encodeURIComponent(canvas.key)}/`;
      seg.title = `${canvas.lecture || `第 ${index + 1} 讲`} · ${canvas.title}（${
        canvas.slides
      } 页）`;
      seg.setAttribute('aria-label', seg.title);

      const lecture = document.createElement('span');
      lecture.className = 'canvas-seg-lecture';
      lecture.textContent = canvas.lecture || `第 ${index + 1} 讲`;

      const title = document.createElement('span');
      title.className = 'canvas-seg-title';
      title.textContent = canvas.title || canvas.key;

      seg.append(lecture, title);

      if (canvas.key === currentKey) {
        seg.classList.add('is-active');
        seg.setAttribute('aria-current', 'page');
        seg.addEventListener('click', (event) => {
          event.preventDefault();
          setSlide(0);
        });
      }

      timeline.appendChild(seg);
      state.canvasSegs.push(seg);
    });

    updateCanvasProgress();
  }

  /* ------------------------------------------------------------------ */
  /* URL hash                                                           */
  /* ------------------------------------------------------------------ */

  function writeHash() {
    const hash = state.mode === 'overview' ? '#overview' : `#p${state.slide + 1}`;
    if (window.location.hash !== hash) {
      history.replaceState(null, '', hash);
    }
  }

  function readHash() {
    const raw = window.location.hash.replace(/^#/, '');
    if (raw === 'overview') return { mode: 'overview' };
    const match = raw.match(/^p(\d+)$/);
    if (match) return { mode: 'slide', index: Number(match[1]) - 1 };
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Interactions                                                       */
  /* ------------------------------------------------------------------ */

  function onWheel(event) {
    if (!state.deck) return;
    event.preventDefault();
    const factor = Math.exp(clamp(event.deltaY, -120, 120) * 0.0016);
    zoomAt(event.clientX, event.clientY, factor);
  }

  function onPointerDown(event) {
    if (!state.deck) return;
    if (event.target.closest('button, a')) return;
    if (state.mode === 'overview') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    state.pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      type: event.pointerType,
    });

    if (event.pointerType === 'touch' && state.pointers.size === 2) {
      startPinch();
      return;
    }
    if (state.pointers.size > 1) return;

    cancelAnimationFrame(state.raf);
    state.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      view: { ...state.view },
      moved: false,
    };
    stage.setPointerCapture(event.pointerId);
    svg.classList.add('is-dragging');
  }

  function onPointerMove(event) {
    if (!state.pointers.has(event.pointerId)) return;
    state.pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      type: event.pointerType,
    });

    if (state.pinch) {
      updatePinch();
      return;
    }
    const drag = state.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    drag.moved = true;

    const box = paperBox(drag.view);
    const boardDx = (dx * drag.view.w) / box.width;
    const boardDy = (dy * drag.view.h) / box.height;
    state.view = {
      x: drag.view.x - boardDx,
      y: drag.view.y - boardDy,
      w: drag.view.w,
      h: drag.view.h,
    };
    applyView();
    markFree();
  }

  function onPointerUp(event) {
    state.pointers.delete(event.pointerId);
    if (state.pinch) {
      if (state.pointers.size < 2) state.pinch = null;
      return;
    }
    if (state.drag && state.drag.pointerId === event.pointerId) {
      state.drag = null;
      svg.classList.remove('is-dragging');
      if (stage.hasPointerCapture(event.pointerId)) {
        stage.releasePointerCapture(event.pointerId);
      }
    }
  }

  function startPinch() {
    const points = [...state.pointers.values()].slice(0, 2);
    if (points.length < 2) return;
    state.drag = null;
    svg.classList.remove('is-dragging');
    const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    const midX = (points[0].x + points[1].x) / 2;
    const midY = (points[0].y + points[1].y) / 2;
    cancelAnimationFrame(state.raf);
    state.pinch = {
      distance: Math.max(1, distance),
      midX,
      midY,
      view: { ...state.view },
      anchor: clientToBoard(midX, midY, state.view),
    };
  }

  function updatePinch() {
    const points = [...state.pointers.values()].slice(0, 2);
    if (points.length < 2) return;
    const pinch = state.pinch;
    const distance = Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y));
    const scale = distance / pinch.distance;
    const minWidth = Math.max(320, state.deck.bounds.w * 0.075);
    const maxWidth = Math.max(state.deck.bounds.w * 1.9, 2400);
    const newWidth = clamp(pinch.view.w / scale, minWidth, maxWidth);
    const ratio = newWidth / pinch.view.w;
    const newHeight = pinch.view.h * ratio;
    const u = clamp(pinch.anchor.u, 0, 1);
    const v = clamp(pinch.anchor.v, 0, 1);
    state.view = {
      x: pinch.anchor.x - u * newWidth,
      y: pinch.anchor.y - v * newHeight,
      w: newWidth,
      h: newHeight,
    };
    applyView();
    markFree();
  }

  function onKeyDown(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (
      target &&
      (target.isContentEditable ||
        target.closest('button, a') ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
    ) {
      return;
    }
    if (!state.deck) return;

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
      case ' ':
        event.preventDefault();
        step(1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        event.preventDefault();
        step(-1);
        break;
      case 'Home':
        event.preventDefault();
        setSlide(0);
        break;
      case 'End':
        event.preventDefault();
        setSlide(state.deck.slides.length - 1);
        break;
      case 'Escape':
      case 'g':
      case 'G':
        event.preventDefault();
        if (state.mode === 'overview') setSlide(state.slide);
        else setOverview();
        break;
      case 'f':
      case 'F':
        event.preventDefault();
        toggleFullscreen();
        break;
      default:
        break;
    }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  function onFullscreenChange() {
    const btn = document.querySelector('[data-action="fullscreen"]');
    if (btn) btn.classList.toggle('is-active', !!document.fullscreenElement);
  }

  function bindEvents() {
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', onPointerUp);
    stage.addEventListener('pointercancel', onPointerUp);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('fullscreenchange', onFullscreenChange);

    const hideOnInteraction = () => hideHint();
    document.addEventListener('pointerdown', hideOnInteraction, {
      once: true,
      capture: true,
    });
    document.addEventListener('keydown', hideOnInteraction, {
      once: true,
      capture: true,
    });
    document.addEventListener(
      'wheel',
      hideOnInteraction,
      { once: true, capture: true, passive: true }
    );
    window.setTimeout(hideHint, 15000);

    document.querySelectorAll('[data-action]').forEach((element) => {
      if (element.tagName !== 'BUTTON') return;
      element.addEventListener('click', () => {
        const action = element.dataset.action;
        if (action === 'prev') step(-1);
        else if (action === 'next') step(1);
        else if (action === 'overview') {
          if (state.mode === 'overview') setSlide(state.slide);
          else setOverview();
        } else if (action === 'fullscreen') toggleFullscreen();
      });
    });

    window.addEventListener('resize', fitToStage);

    window.addEventListener('hashchange', () => {
      if (!state.deck) return;
      const parsed = readHash();
      if (!parsed) return;
      if (parsed.mode === 'overview' && state.mode !== 'overview') {
        setOverview({ updateHash: false });
      } else if (
        parsed.mode === 'slide' &&
        clamp(parsed.index, 0, state.deck.slides.length - 1) !== state.slide
      ) {
        setSlide(parsed.index, { updateHash: false });
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                               */
  /* ------------------------------------------------------------------ */

  function applyNoteLinks() {
    const note = root.dataset.note;
    if (!note) {
      document.querySelectorAll('[data-note-link]').forEach((link) => {
        const row = link.closest('.tool');
        if (row) row.style.display = 'none';
        else link.style.display = 'none';
      });
      return;
    }
    document.querySelectorAll('[data-note-link]').forEach((link) => {
      link.setAttribute('href', note);
    });
    const home = root.dataset.home;
    if (home) {
      document.querySelectorAll('.brand').forEach((link) => {
        link.setAttribute('href', home);
      });
    }
  }

  function showError(error) {
    console.error(error);
    if (loading) loading.classList.add('is-hidden');
    if (errorBox) errorBox.hidden = false;
    svg.classList.add('is-loading');
  }

  async function loadCanvasManifest() {
    const url = root.dataset.manifest;
    if (!url) return null;
    try {
      const response = await fetch(url, { cache: 'no-cache' });
      if (!response.ok) return null;
      const manifest = await response.json();
      return Array.isArray(manifest.decks) ? manifest.decks : null;
    } catch (error) {
      console.warn('画布列表加载失败', error);
      return null;
    }
  }

  async function boot() {
    applyNoteLinks();
    try {
      const [response, canvases] = await Promise.all([
        fetch(root.dataset.src, { cache: 'no-cache' }),
        loadCanvasManifest(),
      ]);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const deck = await response.json();
      if (!Array.isArray(deck.slides) || !deck.slides.length) {
        throw new Error('画板数据为空');
      }
      state.deck = deck;
      state.canvases = canvases;
      document.title = deck.title;
      renderScene();
      buildCanvasAxis();

      const initial = readHash();
      if (initial && initial.mode === 'overview') {
        applyView();
        setOverview({ animate: false, updateHash: false });
      } else {
        const index = initial && initial.mode === 'slide' ? initial.index : 0;
        applyView();
        setSlide(clamp(index, 0, deck.slides.length - 1), {
          animate: false,
          updateHash: false,
        });
        const slide = deck.slides[clamp(index, 0, deck.slides.length - 1)];
        svg.setAttribute('aria-label', `${slide.sectionTitle} · ${slide.title}`);
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          svg.classList.remove('is-loading');
          loading.classList.add('is-hidden');
        });
      });

      if (window.matchMedia('(pointer: coarse)').matches) {
        const touchHint = document.getElementById('touch-hint');
        if (touchHint) {
          window.setTimeout(() => touchHint.classList.add('is-visible'), 900);
          window.setTimeout(() => touchHint.classList.remove('is-visible'), 8000);
        }
      }
    } catch (error) {
      showError(error);
    }
  }

  bindEvents();
  boot();
})();
