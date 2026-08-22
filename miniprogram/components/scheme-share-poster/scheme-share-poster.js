const { openSheet, closeSheet, clearSheetTimer } = require('../../utils/sheetMotion.js');

const SHEET_KEYS = Object.freeze({
  mountedKey: 'sheetMounted',
  openKey: 'sheetOpen',
});

const CANVAS_WIDTH = 750;
const CANVAS_HEIGHT = 1100;
const IMAGE_HEIGHT = 820;
const BRAND_LOGO = '/images/home-ip-v1/brand-logo.png';
const BRAND_NAME = '家客来';

function loadCanvasImage(canvas, src) {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error('缺少图片路径'));
      return;
    }
    const image = canvas.createImage();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片加载失败'));
    image.src = src;
  });
}

function drawAspectFill(ctx, img, x, y, w, h) {
  const imgW = Number(img.width) || w;
  const imgH = Number(img.height) || h;
  const scale = Math.max(w / imgW, h / imgH);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  const offsetX = (w - drawW) / 2;
  const offsetY = (h - drawH) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, x + offsetX, y + offsetY, drawW, drawH);
  ctx.restore();
}

function truncateText(ctx, text, maxWidth) {
  const value = String(text || '').trim();
  if (!value) return '';
  if (ctx.measureText(value).width <= maxWidth) return value;
  let result = value;
  while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    imagePath: {
      type: String,
      value: '',
    },
    schemeTitle: {
      type: String,
      value: '',
    },
  },

  data: {
    sheetMounted: false,
    sheetOpen: false,
    posterPath: '',
    drawError: false,
    saving: false,
    canvasWidth: CANVAS_WIDTH,
    canvasHeight: CANVAS_HEIGHT,
  },

  observers: {
    'visible, imagePath, schemeTitle'(visible) {
      if (visible) {
        openSheet(this, SHEET_KEYS);
        this.scheduleDraw();
        return;
      }
      clearSheetTimer(this, SHEET_KEYS.openKey);
      if (this.data.sheetMounted || this.data.sheetOpen) {
        this.setData({
          sheetMounted: false,
          sheetOpen: false,
          posterPath: '',
          drawError: false,
          saving: false,
        });
      }
    },
  },

  lifetimes: {
    detached() {
      this._drawRequestId = (this._drawRequestId || 0) + 1;
      clearSheetTimer(this, SHEET_KEYS.openKey);
    },
  },

  methods: {
    noop() {},

    scheduleDraw() {
      const requestId = (this._drawRequestId || 0) + 1;
      this._drawRequestId = requestId;
      this.setData({ posterPath: '', drawError: false, saving: false });
      // Wait one frame so the offscreen canvas node is queryable after mount.
      setTimeout(() => {
        if (requestId !== this._drawRequestId) return;
        this.drawPoster(requestId);
      }, 40);
    },

    onRetry() {
      this.scheduleDraw();
    },

    onClose() {
      closeSheet(this, SHEET_KEYS, () => {
        this.setData({ posterPath: '', drawError: false, saving: false });
        this.triggerEvent('close');
      });
    },

    async drawPoster(requestId) {
      const imagePath = String(this.properties.imagePath || '').trim();
      const schemeTitle = String(this.properties.schemeTitle || '').trim() || '设计方案';
      if (!imagePath) {
        this.setData({ drawError: true, posterPath: '' });
        return;
      }

      try {
        const canvas = await this.queryCanvasNode();
        if (!canvas || requestId !== this._drawRequestId) return;

        const dpr = Number((wx.getWindowInfo && wx.getWindowInfo().pixelRatio)
          || (wx.getSystemInfoSync && wx.getSystemInfoSync().pixelRatio)
          || 2);
        const ctx = canvas.getContext('2d');
        canvas.width = CANVAS_WIDTH * dpr;
        canvas.height = CANVAS_HEIGHT * dpr;
        ctx.scale(dpr, dpr);

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        const cover = await loadCanvasImage(canvas, imagePath);
        if (requestId !== this._drawRequestId) return;
        drawAspectFill(ctx, cover, 0, 0, CANVAS_WIDTH, IMAGE_HEIGHT);

        ctx.fillStyle = '#183426';
        ctx.font = 'bold 40px sans-serif';
        ctx.fillText(truncateText(ctx, schemeTitle, CANVAS_WIDTH - 80), 40, 890);

        try {
          const logo = await loadCanvasImage(canvas, BRAND_LOGO);
          if (requestId !== this._drawRequestId) return;
          ctx.drawImage(logo, 40, 960, 72, 72);
        } catch (logoError) {
          console.warn('scheme-share-poster logo load failed', logoError);
        }

        ctx.fillStyle = '#00c365';
        ctx.font = 'bold 34px sans-serif';
        ctx.fillText(BRAND_NAME, 132, 1008);

        const posterPath = await this.exportCanvas(canvas);
        if (requestId !== this._drawRequestId) return;
        this.setData({ posterPath, drawError: false });
      } catch (error) {
        if (requestId !== this._drawRequestId) return;
        console.warn('scheme-share-poster draw failed', error);
        this.setData({ posterPath: '', drawError: true });
      }
    },

    queryCanvasNode() {
      return new Promise((resolve) => {
        this.createSelectorQuery()
          .select('#schemePosterCanvas')
          .fields({ node: true, size: true })
          .exec((res) => {
            const canvas = res && res[0] && res[0].node;
            resolve(canvas || null);
          });
      });
    },

    exportCanvas(canvas) {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          wx.canvasToTempFilePath({
            canvas,
            fileType: 'png',
            quality: 1,
            success: (result) => resolve(result.tempFilePath),
            fail: (error) => reject(error instanceof Error ? error : new Error(error && error.errMsg || '导出海报失败')),
          }, this);
        }, 80);
      });
    },

    async saveToPhotos() {
      const posterPath = this.data.posterPath;
      if (!posterPath || this.data.saving) return;
      this.setData({ saving: true });
      try {
        await wx.saveImageToPhotosAlbum({ filePath: posterPath });
        this.setData({ saving: false });
        this.shareSavedImage(posterPath);
      } catch (error) {
        this.setData({ saving: false });
        const message = String((error && error.errMsg) || '');
        if (message.includes('auth deny') || message.includes('auth denied')) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中允许保存图片到相册，保存后可发给家人或发朋友圈。',
            confirmText: '去设置',
            success: (result) => {
              if (result.confirm) wx.openSetting();
            },
          });
          return;
        }
        wx.showToast({ title: '保存失败，请稍后重试', icon: 'none' });
      }
    },

    shareSavedImage(filePath) {
      if (typeof wx.showShareImageMenu !== 'function') {
        wx.showToast({ title: '已保存到相册，可发给家人或发朋友圈', icon: 'none', duration: 2500 });
        return;
      }
      wx.showShareImageMenu({
        path: filePath,
        fail: () => {
          wx.showToast({ title: '已保存到相册，可发给家人或发朋友圈', icon: 'none', duration: 2500 });
        },
      });
    },
  },
});
