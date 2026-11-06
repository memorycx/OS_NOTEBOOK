#!/usr/bin/env node
/**
 * Build slide data for the Excalidraw board reader.
 *
 * Usage:
 *   node tools/build-slides.mjs
 *
 * For every directory containing a *.excalidraw.md file this script:
 *   1. decompresses the Obsidian Excalidraw `compressed-json` payload;
 *   2. detects the large section boxes drawn on the board;
 *   3. slices tall sections into 4:3 camera views (with overlap);
 *   4. writes assets/slides/<folder>.json and <folder>/index.html.
 *
 * The generated files are committed to the repository so that GitHub Pages
 * (which only serves static files) can load them without any build step.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const LZString = require('./vendor/lz-string.min.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SLIDE_ASPECT = 4 / 3;
const SECTION_PAD = 34;
const OVERLAP_RATIO = 0.2;
const SKIP_DIRS = new Set(['.git', '.github', 'node_modules', 'assets', 'tools']);

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[kv[1]] = value;
  }
  return out;
}

function chineseNumber(n) {
  const digits = '零一二三四五六七八九';
  if (n < 10) return digits[n];
  if (n < 20) return '十' + (n % 10 ? digits[n % 10] : '');
  if (n < 100) return digits[Math.floor(n / 10)] + '十' + (n % 10 ? digits[n % 10] : '');
  return String(n);
}

function lectureLabel(raw) {
  if (!raw) return '';
  const m = String(raw).match(/(\d+)/);
  if (!m) return String(raw);
  return '第' + chineseNumber(Number(m[1])) + '讲';
}

function extractScene(md) {
  const m = md.match(/```compressed-json\s*\r?\n([\s\S]*?)\r?\n```/);
  if (!m) return null;
  const b64 = m[1].replace(/\s+/g, '');
  const json = LZString.decompressFromBase64(b64);
  if (!json) throw new Error('LZString decompression failed');
  return { scene: JSON.parse(json), hash: crypto.createHash('sha1').update(b64).digest('hex').slice(0, 12) };
}

const round = (n) => Math.round(n * 100) / 100;

function elementBounds(elements) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const e of elements) {
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) continue;
    minX = Math.min(minX, e.x);
    minY = Math.min(minY, e.y);
    maxX = Math.max(maxX, e.x + e.width);
    maxY = Math.max(maxY, e.y + e.height);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function centerInside(el, rect, pad = 0) {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  return (
    cx >= rect.x - pad &&
    cx <= rect.x + rect.width + pad &&
    cy >= rect.y - pad &&
    cy <= rect.y + rect.height + pad
  );
}

function containsRect(outer, inner) {
  const eps = 2;
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.width <= outer.x + outer.width + eps &&
    inner.y + inner.height <= outer.y + outer.height + eps
  );
}

function detectSections(elements) {
  let candidates = elements.filter(
    (e) =>
      e.type === 'rectangle' &&
      e.width >= 400 &&
      e.height >= 380 &&
      !(e.boundElements || []).some((b) => b.type === 'text')
  );

  // Drop outlines nested inside a larger section outline.
  candidates = candidates.filter(
    (c) => !candidates.some((other) => other !== c && containsRect(other, c))
  );

  // Reading order: left to right, then top to bottom for stacked boxes.
  candidates.sort((a, b) => {
    if (Math.abs(a.x - b.x) > 60) return a.x - b.x;
    if (Math.abs(a.y - b.y) > 40) return a.y - b.y;
    return a.x - b.x;
  });

  return candidates.map((rect, i) => {
    const inside = elements.filter((e) => e !== rect && centerInside(e, rect));
    const headings = inside
      .filter((e) => e.type === 'text' && e.fontSize >= 28)
      .sort((a, b) => b.fontSize - a.fontSize || a.y - b.y);
    const title =
      (headings[0] && headings[0].text.trim().replace(/\s+/g, ' ')) ||
      `章节 ${i + 1}`;
    return {
      index: i,
      title,
      x: round(rect.x),
      y: round(rect.y),
      w: round(rect.width),
      h: round(rect.height),
      headingY: headings.length ? round(Math.min(...headings.map((h) => h.y))) : round(rect.y),
      headings: headings.map((h) => ({ y: round(h.y), text: h.text.trim() })),
    };
  });
}

function mergedIntervals(elements, section) {
  const intervals = elements
    .filter((e) => e.type === 'text' || e.type === 'arrow' || e.type === 'line')
    .filter((e) => centerInside(e, section, 40))
    .map((e) => [Math.max(e.y, section.y), Math.min(e.y + e.height, section.y + section.height)])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
    else merged.push([...interval]);
  }
  return merged;
}

function snapToGap(y, gaps, radius) {
  let best = null;
  for (const gap of gaps) {
    if (gap[1] - gap[0] < 12) continue;
    const mid = (gap[0] + gap[1]) / 2;
    const dist = Math.abs(mid - y);
    if (dist <= radius && (!best || dist < best.dist)) best = { y: mid, dist };
  }
  return best ? best.y : y;
}

function buildSlides(section, elements) {
  const pad = SECTION_PAD;
  const camW = section.w + pad * 2;
  const camH = camW / SLIDE_ASPECT;
  const top = section.y - pad;
  const bottom = section.y + section.h + pad;

  // Sections that only slightly exceed one 4:3 view get a single, slightly
  // taller camera instead of being split through their heading.
  const fullHeight = section.h + pad * 2;
  if (fullHeight <= camH * 1.3) {
    const height = Math.max(camH, fullHeight);
    const width = height * SLIDE_ASPECT;
    return [
      {
        x: round(section.x + section.w / 2 - width / 2),
        y: round(section.y + section.h / 2 - height / 2),
        w: round(width),
        h: round(height),
        section: section.index,
        title: section.title.replace(/\s+/g, ' '),
      },
    ];
  }

  const intervals = mergedIntervals(elements, { ...section });
  const gaps = [];
  for (let i = 0; i < intervals.length - 1; i++) {
    const start = intervals[i][1];
    const end = intervals[i + 1][0];
    if (end > start) gaps.push([start, end]);
  }

  const contentH = camH - pad * 2;
  const step = contentH * (1 - OVERLAP_RATIO);
  const slides = [];
  let y0 = top;
  let first = true;

  while (y0 + camH < bottom - 2) {
    let finalY = y0;
    if (!first) {
      const snapped = snapToGap(y0, gaps, step * 0.35);
      const nextY = Math.max(top, snapped);
      // Never move so far that we lose the overlap.
      finalY = nextY < y0 ? nextY : Math.min(nextY, y0 + step * 0.5);
    }
    slides.push({ y: finalY, w: camW, h: camH });
    y0 = finalY + step;
    first = false;
  }

  // Align the final view with the bottom edge.
  const lastY = Math.max(top, bottom - camH);
  if (!slides.length || lastY > slides[slides.length - 1].y + camH * 0.35) {
    slides.push({ y: lastY, w: camW, h: camH });
  } else {
    slides[slides.length - 1].y = Math.max(
      lastY,
      slides.length > 1 ? slides[slides.length - 2].y + camH * 0.35 : top
    );
  }

  return slides.map((s) => {
    const contentTop = s.y + pad;
    const visibleHeadings = (section.headings || []).filter(
      (h) => h.y <= contentTop + camH * 0.28
    );
    let title = section.title;
    if (visibleHeadings.length) {
      const now = visibleHeadings.filter((h) => h.y <= contentTop + camH * 0.18);
      title = (now.length ? now[now.length - 1] : visibleHeadings[0]).text;
    }
    return {
      x: round(section.x - pad),
      y: round(s.y),
      w: round(s.w),
      h: round(s.h),
      section: section.index,
      title: title.replace(/\s+/g, ' '),
    };
  });
}

function trimElement(e) {
  const base = {
    id: e.id,
    type: e.type,
    x: round(e.x),
    y: round(e.y),
    w: round(e.width),
    h: round(e.height),
  };
  if (e.type === 'text') {
    Object.assign(base, {
      text: e.text,
      size: round(e.fontSize),
      color: e.strokeColor,
      align: e.textAlign,
      valign: e.verticalAlign,
      lineHeight: e.lineHeight || 1.25,
    });
  } else if (e.type === 'rectangle') {
    Object.assign(base, {
      color: e.strokeColor,
      bg: e.backgroundColor,
      strokeWidth: e.strokeWidth,
      round: !!e.roundness,
      fillStyle: e.fillStyle,
      strokeStyle: e.strokeStyle,
    });
  } else if (e.type === 'arrow' || e.type === 'line') {
    Object.assign(base, {
      color: e.strokeColor,
      strokeWidth: e.strokeWidth,
      points: (e.points || []).map(([px, py]) => [round(px), round(py)]),
      startArrowhead: e.startArrowhead || null,
      endArrowhead: e.endArrowhead || null,
      strokeStyle: e.strokeStyle,
    });
  }
  return base;
}

function buildDeck(dir, boardFile, noteFile) {
  const md = fs.readFileSync(boardFile, 'utf8');
  const extracted = extractScene(md);
  if (!extracted) throw new Error('no compressed-json block found');
  const { scene, hash } = extracted;

  const folder = path.basename(dir);
  const noteText = noteFile ? fs.readFileSync(noteFile, 'utf8') : '';
  const fm = parseFrontmatter(noteText);
  const fallbackTitle = folder.replace(/^\d+[._-]?/, '');
  const deckTitle = fm.title || fallbackTitle;
  const lecture = lectureLabel(fm.lecture);

  const elements = scene.elements.filter((e) => !e.isDeleted);
  const bounds = elementBounds(elements);
  let sections = detectSections(elements);

  // A board without drawn section boxes still gets a usable single-slide view.
  if (!sections.length) {
    sections = [
      {
        index: 0,
        title: deckTitle,
        x: bounds.x - 48,
        y: bounds.y - 48,
        w: bounds.w + 96,
        h: bounds.h + 96,
        headingY: bounds.y,
        headings: [],
      },
    ];
  }

  const slides = [];
  for (const section of sections) {
    const built = buildSlides(section, elements);
    for (const slide of built) {
      slides.push({ ...slide, sectionTitle: section.title });
    }
  }
  sections.forEach((s) => {
    s.slideStart = slides.findIndex((sl) => sl.section === s.index);
    s.slideCount = slides.filter((sl) => sl.section === s.index).length;
  });

  const noteHtml = noteFile ? path.basename(noteFile, '.md') + '.html' : '';
  const data = {
    version: 1,
    hash,
    title: deckTitle,
    lecture,
    source: path.relative(ROOT, boardFile).split(path.sep).join('/'),
    note: noteHtml,
    background: scene.appState?.viewBackgroundColor || '#ffffff',
    bounds: {
      x: round(bounds.x),
      y: round(bounds.y),
      w: round(bounds.w),
      h: round(bounds.h),
    },
    sections: sections.map((s) => ({
      index: s.index,
      title: s.title,
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      slideStart: s.slideStart,
      slideCount: s.slideCount,
    })),
    slides,
    elements: elements.filter((e) => ['rectangle', 'text', 'arrow', 'line'].includes(e.type)).map(trimElement),
  };
  return { folder, data };
}

function assetVersion(relativePath) {
  const file = path.join(ROOT, relativePath);
  return crypto
    .createHash('sha1')
    .update(fs.readFileSync(file))
    .digest('hex')
    .slice(0, 8);
}

function renderIndexHtml(deck, key, noteName) {
  const title = `${deck.title}${deck.lecture ? ' · ' + deck.lecture : ''}`;
  const cssVersion = assetVersion('assets/reader/reader.css');
  const jsVersion = assetVersion('assets/reader/reader.js');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f2efe8">
<title>${escapeHtml(deck.title)} · 画板阅读</title>
<link rel="stylesheet" href="../assets/reader/reader.css?v=${cssVersion}">
</head>
<body>
<div class="reader" id="reader"
     data-src="../assets/slides/${encodeURIComponent(key)}.json"
     data-note="${escapeHtml(noteName)}"
     data-home="../index.html">
  <header class="topbar">
    <a class="brand" href="../index.html" aria-label="返回笔记首页">
      <span class="brand-mark">OS</span>
      <span class="brand-text">
        <span class="brand-course">南京大学操作系统课程${deck.lecture ? ' · ' + escapeHtml(deck.lecture) : ''}</span>
        <span class="brand-deck" data-deck-title>${escapeHtml(deck.title)}</span>
      </span>
    </a>
    <nav class="tools" aria-label="阅读工具">
      <button class="tool" type="button" data-action="overview" title="画板概览 (Esc)" aria-label="画板概览">
        <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="2.5" width="6" height="6" rx="1"/><rect x="11.5" y="2.5" width="6" height="6" rx="1"/><rect x="2.5" y="11.5" width="6" height="6" rx="1"/><rect x="11.5" y="11.5" width="6" height="6" rx="1"/></svg>
        <span>概览</span>
      </button>
      <a class="tool" data-note-link href="${escapeHtml(noteName)}" title="阅读完整 Markdown 笔记" aria-label="阅读完整笔记">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 3.5h8l4 4v9H4z"/><path d="M12 3.5v4h4"/><path d="M7 11h6M7 14h4"/></svg>
        <span>笔记</span>
      </a>
      <button class="tool" type="button" data-action="fullscreen" title="全屏 (F)" aria-label="全屏">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3H3v4M13 3h4v4M7 17H3v-4M13 17h4v-4"/></svg>
        <span>全屏</span>
      </button>
    </nav>
  </header>

  <main class="stage" id="stage">
    <svg class="board" id="board" xmlns="http://www.w3.org/2000/svg"
         preserveAspectRatio="xMidYMid meet" role="img"
         aria-label="${escapeHtml(title)} 画板"></svg>
    <button class="edge edge-prev" type="button" data-action="prev" aria-label="上一页">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
    </button>
    <button class="edge edge-next" type="button" data-action="next" aria-label="下一页">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
    </button>
    <div class="touch-hint" id="touch-hint">双指缩放 · 拖动查看 · 下方按钮翻页</div>
    <div class="board-loading" id="board-loading">
      <span class="spinner" aria-hidden="true"></span>
      <span>正在展开画板…</span>
    </div>
    <div class="board-error" id="board-error" hidden>
      <strong>画板加载失败</strong>
      <p>请确认已运行 <code>node tools/build-slides.mjs</code>，或直接阅读完整笔记。</p>
      <a class="error-link" data-note-link href="${escapeHtml(noteName)}">阅读完整笔记 →</a>
    </div>
    <noscript>
      <div class="board-error">
        <strong>需要启用 JavaScript</strong>
        <p>画板阅读器需要 JavaScript 才能渲染。你也可以直接阅读完整笔记。</p>
        <a class="error-link" href="${escapeHtml(noteName)}">阅读完整笔记 →</a>
      </div>
    </noscript>
  </main>

  <footer class="bottombar">
    <div class="chapter">
      <span class="chapter-num" id="chapter-num">§1</span>
      <span class="chapter-title" id="chapter-title">画板概览</span>
    </div>
    <div class="timeline-wrap">
      <div class="timeline" id="timeline" role="group" aria-label="幻灯片进度"></div>
      <div class="hint" id="hint">← → 翻页 · 滚轮缩放 · 拖拽移动 · Esc 概览</div>
    </div>
    <div class="pager">
      <span class="pager-count" id="pager-count" aria-live="polite">1 / ${deck.slides.length}</span>
      <div class="pager-buttons">
        <button class="pager-btn" type="button" data-action="prev" aria-label="上一页">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4.5L7 10l5.5 5.5"/></svg>
        </button>
        <button class="pager-btn" type="button" data-action="next" aria-label="下一页">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 4.5L13 10l-5.5 5.5"/></svg>
        </button>
      </div>
    </div>
  </footer>
</div>
<script src="../assets/reader/reader.js?v=${jsVersion}" defer></script>
</body>
</html>
`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.excalidraw.md')) out.push(full);
  }
  return out;
}

function main() {
  const boards = walk(ROOT).sort();
  if (!boards.length) {
    console.error('No *.excalidraw.md files found.');
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(path.join(ROOT, 'assets', 'slides'), { recursive: true });
  let changed = 0;

  for (const boardFile of boards) {
    const dir = path.dirname(boardFile);
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const noteEntry = entries.find(
      (e) => e.isFile() && e.name.endsWith('.md') && !e.name.endsWith('.excalidraw.md')
    );
    const noteFile = noteEntry ? path.join(dir, noteEntry.name) : null;

    let built;
    try {
      built = buildDeck(dir, boardFile, noteFile);
    } catch (err) {
      console.error(`✗ ${path.relative(ROOT, boardFile)}: ${err.message}`);
      process.exitCode = 1;
      continue;
    }

    const { folder, data } = built;
    const jsonPath = path.join(ROOT, 'assets', 'slides', `${folder}.json`);
    const json = JSON.stringify(data);
    const previous = fs.existsSync(jsonPath) ? fs.readFileSync(jsonPath, 'utf8') : '';
    if (previous !== json) {
      fs.writeFileSync(jsonPath, json);
      changed++;
    }

    const noteName = data.note || '';
    const htmlPath = path.join(dir, 'index.html');
    const html = renderIndexHtml(data, folder, noteName);
    const previousHtml = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
    if (previousHtml !== html) {
      fs.writeFileSync(htmlPath, html);
      changed++;
    }

    console.log(
      `✓ ${folder}: ${data.elements.length} elements, ${data.sections.length} sections, ${data.slides.length} slides`
    );
  }

  console.log(changed ? `\nUpdated ${changed} generated file(s).` : '\nEverything is up to date.');
}

main();
