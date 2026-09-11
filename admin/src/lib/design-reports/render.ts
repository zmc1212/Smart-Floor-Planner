import type { ReportDraft } from './contract';

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

const TRANSITIONS = ['curtain', 'focus', 'vertical', 'flip', 'light', 'gallery'];
const ENTERS = ['rise', 'cascade', 'image', 'sequence', 'draw', 'type'];

/** Only trusted asset URLs supplied by the server may enter this renderer. Text is always escaped. */
export function renderReport(draft: ReportDraft, assetUrls: Record<string, string>) {
  const isSlides = draft.mode === 'slides';

  const pagesHtml = draft.pages.map((page, index) => {
    const transition = TRANSITIONS[index % TRANSITIONS.length];
    const enter = ENTERS[index % ENTERS.length];
    
    const assets = page.assetIds.map(id => assetUrls[id]).filter(Boolean);
    const hasImages = assets.length > 0;
    const isCover = index === 0 && !hasImages;
    
    let contentHtml = '';
    
    if (isCover) {
      contentHtml = `
        <div data-motion-surface="true" style="width: 100%; text-align: center;">
            <h1 data-motion-enter-target="true">${escapeHtml(draft.title)}</h1>
            <p data-motion-enter-target="true">${escapeHtml(page.title)}</p>
            ${page.body ? `<p data-motion-enter-target="true" class="subtitle">${escapeHtml(page.body)}</p>` : ''}
        </div>
      `;
    } else {
      contentHtml = `
        <div data-motion-surface="true" class="slide-content ${!hasImages ? 'text-only' : ''}">
            <div class="text-panel" data-motion-enter-target="true">
                <div class="eyebrow">${escapeHtml(draft.title)} · ${index + 1} / ${draft.pages.length}</div>
                <h2>${escapeHtml(page.title)}</h2>
                <p>${escapeHtml(page.body)}</p>
            </div>
            ${hasImages ? `
            <div class="image-panel ${assets.length > 1 ? `split images-${assets.length}` : ''}">
                ${assets.map((url, i) => `<img src="${escapeHtml(url)}" alt="汇报素材 ${i + 1}" loading="${index === 0 ? 'eager' : 'lazy'}">`).join('')}
            </div>
            ` : ''}
        </div>
      `;
    }

    return `
      <!-- Page ${index} -->
      <div class="slide ${index === 0 && isSlides ? 'active' : ''}" data-report-slide="true" data-chapter-id="page-${index}" data-transition="${transition}" data-enter="${enter}" data-motion-index="${index}" id="slide-${index}">
          ${contentHtml}
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(draft.title)}</title>
    <style>
        :root {
            --bg-color: #f7f9fa;
            --text-color: #2c3e50;
            --accent-color: #16a34a;
            --heading-color: #1a252f;
        }
        body, html {
            margin: 0; padding: 0; width: 100%; 
            ${isSlides ? 'height: 100dvh; overflow: hidden;' : 'height: auto; overflow-x: hidden; overflow-y: auto;'}
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg-color); color: var(--text-color);
        }
        #presentation-container { width: 100%; ${isSlides ? 'height: 100%; position: relative;' : 'display: flex; flex-direction: column; align-items: center; gap: 40px; padding: 40px 0;'} }
        
        .slide {
            ${isSlides ? `
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            display: flex; flex-direction: row; justify-content: center; align-items: center;
            opacity: 0; visibility: hidden; transition: opacity 0.6s ease;
            box-sizing: border-box; padding: 40px;
            ` : `
            position: relative; width: 100%; min-height: 100vh;
            display: flex; flex-direction: row; justify-content: center; align-items: center;
            box-sizing: border-box; padding: 40px;
            opacity: 1; visibility: visible;
            `}
        }
        ${isSlides ? '.slide.active { opacity: 1; visibility: visible; z-index: 10; }' : ''}
        
        .slide-cover { flex-direction: column; text-align: center; }
        .slide-cover h1 { font-size: clamp(2.5rem, 5vw, 4rem); color: var(--heading-color); margin-bottom: 20px; overflow-wrap: anywhere; }
        .slide-cover p { font-size: clamp(1.2rem, 3vw, 1.8rem); color: #7f8c8d; overflow-wrap: anywhere; }
        .slide-cover .subtitle { font-size: 1rem; color: #95a5a6; max-width: 800px; margin: 20px auto; white-space: pre-wrap; }
        
        .slide-content {
            display: flex; width: 90%; max-width: 1400px; height: 85%; min-height: 600px;
            background: #ffffff; border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.08); overflow: hidden;
        }
        .slide-content.text-only { max-width: 800px; height: auto; min-height: auto; }
        
        .text-panel { flex: 1; padding: 50px; display: flex; flex-direction: column; justify-content: center; }
        .eyebrow { color: #95a5a6; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 20px; }
        .text-panel h2 { font-size: clamp(2rem, 4vw, 3rem); color: var(--heading-color); margin-bottom: 20px; overflow-wrap: anywhere; }
        .text-panel p { font-size: 1.1rem; line-height: 1.8; color: #555; white-space: pre-wrap; overflow-wrap: anywhere; }
        
        .image-panel { flex: 1.5; position: relative; background-color: #eee; overflow: hidden; }
        .image-panel img { width: 100%; height: 100%; object-fit: cover; position: absolute; top: 0; left: 0; }
        
        .image-panel.split { display: grid; grid-template-rows: repeat(auto-fit, minmax(50%, 1fr)); }
        .image-panel.split.images-3, .image-panel.split.images-4 { grid-template-columns: 50% 50%; grid-template-rows: 50% 50%; }
        .image-panel.split img { position: relative; height: 100%; width: 100%; object-fit: cover; }

        /* Motion keyframes */
        @keyframes reportTransitionCurtain { from { clip-path: inset(0 50%); filter: brightness(0.5); } to { clip-path: inset(0); filter: none; } }
        @keyframes reportTransitionFocus { from { opacity: .2; transform: scale(1.12); } to { opacity: 1; transform: none; } }
        @keyframes reportTransitionShutter { from { clip-path: inset(0 0 100% 0); } to { clip-path: inset(0); } }
        @keyframes reportTransitionFlip { from { opacity: 0; transform: rotateY(-90deg); } to { opacity: 1; transform: none; } }
        @keyframes reportTransitionLight { from { opacity: 0.5; filter: brightness(2); } to { opacity: 1; filter: none; } }
        @keyframes reportTransitionGallery { from { opacity: 0; transform: translateX(50px); } to { opacity: 1; transform: none; } }

        @keyframes reportEnterRise { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: none; } }
        @keyframes reportEnterCascade { from { opacity: 0; transform: translate(18px, 14px); } to { opacity: 1; transform: none; } }
        @keyframes reportEnterImage { from { filter: brightness(1.5); } to { filter: none; } }
        @keyframes reportEnterSequence { from { opacity: 0; } to { opacity: 1; } }
        @keyframes reportEnterDraw { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0); } }
        @keyframes reportEnterType { from { opacity: 0; } to { opacity: 1; } }

        [data-report-slide].is-motion-entering[data-transition="curtain"] > [data-motion-surface] { animation: reportTransitionCurtain 0.8s ease both; }
        [data-report-slide].is-motion-entering[data-transition="focus"] > [data-motion-surface] { animation: reportTransitionFocus 0.8s ease both; }
        [data-report-slide].is-motion-entering[data-transition="vertical"] > [data-motion-surface] { animation: reportTransitionShutter 0.8s ease both; }
        [data-report-slide].is-motion-entering[data-transition="flip"] > [data-motion-surface] { animation: reportTransitionFlip 0.8s ease both; }
        [data-report-slide].is-motion-entering[data-transition="light"] > [data-motion-surface] { animation: reportTransitionLight 0.8s ease both; }
        [data-report-slide].is-motion-entering[data-transition="gallery"] > [data-motion-surface] { animation: reportTransitionGallery 0.8s ease both; }

        @media (prefers-reduced-motion: reduce) {
            [data-report-slide].is-motion-entering > [data-motion-surface],
            [data-report-slide].is-motion-entering [data-motion-enter-target] {
                animation: none !important;
            }
        }
        
        .controls { position: fixed; bottom: 30px; right: 30px; z-index: 100; display: flex; gap: 10px; }
        button { background-color: rgba(255, 255, 255, 0.9); color: var(--heading-color); border: 1px solid #ddd; padding: 10px 20px; cursor: pointer; border-radius: 30px; }
        button:hover { background-color: var(--accent-color); color: white; border-color: var(--accent-color); }
        button:disabled { opacity: 0.5; cursor: not-allowed; }

        /* Mobile responsive adjustments */
        @media (max-width: 768px) {
            .slide { padding: 20px; flex-direction: column; min-height: auto; }
            .slide-cover h1 { font-size: 2rem; }
            .slide-cover p { font-size: 1.1rem; }
            .slide-content { flex-direction: column; width: 100%; height: auto; min-height: 80vh; }
            .text-panel { padding: 20px; flex: none; height: auto; }
            .text-panel h2 { font-size: 1.5rem; margin-bottom: 10px; }
            .text-panel p { font-size: 1rem; }
            .image-panel { flex: 1; min-height: 300px; display: flex; flex-direction: column; }
            .image-panel.split { display: grid; grid-template-columns: 1fr; grid-template-rows: repeat(auto-fit, minmax(200px, 1fr)); }
            .image-panel.split.images-3, .image-panel.split.images-4 { grid-template-columns: 50% 50%; grid-template-rows: 50% 50%; }
            .image-panel.split img { height: 100%; position: relative; }
            .image-panel img { position: relative; }
            .controls { bottom: 15px; right: 15px; }
            button { padding: 8px 15px; font-size: 0.9rem; }
        }
    </style>
</head>
<body>
    <div id="presentation-container">
        ${pagesHtml}
    </div>
    
    <div class="controls">
        ${isSlides ? `
        <button id="prevBtn">上一页 (←)</button>
        <button id="nextBtn">下一页 (→)</button>
        ` : ''}
    </div>

    <script>
        (function attachReportMotion(global) {
            "use strict";
            const enteringClass = "is-motion-entering";
            function assignMotionOrder(slide) {
                slide.querySelectorAll("[data-motion-enter-target]").forEach((element, index) => {
                    if (!element.style.getPropertyValue("--motion-order")) {
                        element.style.setProperty("--motion-order", String(index));
                    }
                });
            }
            function replay(slide) {
                if (!(slide instanceof Element)) return;
                assignMotionOrder(slide);
                slide.classList.remove(enteringClass);
                void slide.offsetWidth;
                slide.classList.add(enteringClass);
            }
            function clear(slide) {
                if (slide instanceof Element) slide.classList.remove(enteringClass);
            }
            global.ReportMotion = Object.freeze({ replay, clear });
        })(window);

        let currentSlide = 0;
        const slides = document.querySelectorAll('.slide');
        const isSlidesMode = ${isSlides};
        
        function updateSlides() {
            if (!isSlidesMode) return;
            slides.forEach((slide, index) => {
                if (index === currentSlide) {
                    slide.classList.add('active');
                    ReportMotion.replay(slide);
                } else {
                    slide.classList.remove('active');
                    ReportMotion.clear(slide);
                }
            });
            const prevBtn = document.getElementById('prevBtn');
            const nextBtn = document.getElementById('nextBtn');
            if (prevBtn) prevBtn.disabled = currentSlide === 0;
            if (nextBtn) nextBtn.disabled = currentSlide === slides.length - 1;
        }
        
        function nextSlide() {
            if (currentSlide < slides.length - 1) {
                currentSlide++;
                updateSlides();
            }
        }
        
        function prevSlide() {
            if (currentSlide > 0) {
                currentSlide--;
                updateSlides();
            }
        }
        
        if (isSlidesMode) {
            document.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') nextSlide();
                else if (e.key === 'ArrowLeft' || e.key === 'PageUp') prevSlide();
            });
            const prevBtn = document.getElementById('prevBtn');
            const nextBtn = document.getElementById('nextBtn');
            if (prevBtn) prevBtn.onclick = prevSlide;
            if (nextBtn) nextBtn.onclick = nextSlide;
            
            let startX = 0;
            document.addEventListener('touchstart', e => {
                startX = e.changedTouches[0].clientX;
            }, {passive:true});
            document.addEventListener('touchend', e => {
                const dx = e.changedTouches[0].clientX - startX;
                if (Math.abs(dx) > 80) { dx < 0 ? nextSlide() : prevSlide(); }
            }, {passive:true});
            
            setTimeout(() => updateSlides(), 100);
        } else {
            const observer = new IntersectionObserver(entries => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        ReportMotion.replay(entry.target);
                    }
                }
            }, { threshold: 0.3 });
            slides.forEach(p => observer.observe(p));
        }
    </script>
</body>
</html>`;
}
