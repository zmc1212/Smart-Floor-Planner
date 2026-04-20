Component({
  properties: {
    show: {
      type: Boolean,
      value: false,
      observer(newVal) {
        if (newVal) {
          this.drawPoster();
        } else {
          this.setData({ posterPath: '' });
        }
      }
    },
    caseData: {
      type: Object,
      value: null
    }
  },

  data: {
    posterPath: '',
    canvasWidth: 750,
    canvasHeight: 1100
  },

  methods: {
    onClose() {
      this.triggerEvent('close');
    },

    onPrevent() {},

    async drawPoster() {
      const { caseData } = this.data;
      if (!caseData) return;

      const query = this.createSelectorQuery();
      query.select('#posterCanvas')
        .fields({ node: true, size: true })
        .exec(async (res) => {
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');
          const dpr = wx.getSystemInfoSync().pixelRatio;

          // 设置内部宽高（固定逻辑像素，绘图时用逻辑像素）
          canvas.width = this.data.canvasWidth * dpr;
          canvas.height = this.data.canvasHeight * dpr;
          ctx.scale(dpr, dpr);

          // 1. 绘制背景
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, 750, 1100);

          try {
            // 2. 绘制顶部案例图 (Cover)
            if (caseData.coverImage) {
              const mainImg = canvas.createImage();
               // 如果是 Base64，直接绘制；如果是 URL，需要先获取临时路径
              mainImg.src = caseData.coverImage;
              await new Promise((resolve) => {
                mainImg.onload = resolve;
                mainImg.onerror = () => {
                  console.error('Image load failed');
                  resolve();
                };
              });
              
              // 模拟 aspectFill
              this.drawAspectFillImage(ctx, mainImg, 0, 0, 750, 600);
            }

            // 3. 绘制文字内容
            ctx.fillStyle = '#171717';
            ctx.font = 'bold 40px sans-serif';
            ctx.fillText(caseData.title || '量房大师案例分享', 40, 680);

            ctx.fillStyle = '#64748b';
            ctx.font = '28px sans-serif';
            ctx.fillText(`${caseData.style || ''} | ${caseData.roomType || ''}`, 40, 740);

            // 4. 绘制底部分隔线
            ctx.strokeStyle = '#f1f5f9';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(40, 800);
            ctx.lineTo(710, 800);
            ctx.stroke();

            // 5. 绘制品牌与二维码区域
            const app = getApp();
            const userInfo = app.globalData.userInfo || {};
            const branding = app.globalData.branding || {};
            const brandingName = branding.name || userInfo.enterpriseName || '智能量房大师';
            const primaryColor = branding.branding?.primaryColor || '#171717';
            const designerName = userInfo.role === 'staff' ? (userInfo.nickname || userInfo.name) : '';

            ctx.fillStyle = primaryColor;
            ctx.font = 'bold 36px sans-serif';
            ctx.fillText(brandingName, 40, 880);

            ctx.fillStyle = '#94a3b8';
            ctx.font = '24px sans-serif';
            const subText = designerName ? `首席设计师 ${designerName} 推荐` : '专业量房 · 智能设计 · 精准报价';
            ctx.fillText(subText, 40, 930);

            // 二维码占位 (通常使用公司 Logo 或 小程序码)
            ctx.fillStyle = '#f8fafc';
            ctx.fillRect(550, 840, 160, 160);
            ctx.fillStyle = '#cbd5e1';
            ctx.font = '20px sans-serif';
            ctx.fillText('小程序码', 590, 930);

            // 6. 生成临时路径
            setTimeout(() => {
              wx.canvasToTempFilePath({
                canvas,
                success: (res) => {
                  this.setData({ posterPath: res.tempFilePath });
                },
                fail: (err) => console.error('canvasToTempFilePath failed:', err)
              });
            }, 300);

          } catch (err) {
            console.error('Draw poster error:', err);
          }
        });
    },

    // 绘制 aspectFill 效果的工具函数
    drawAspectFillImage(ctx, img, x, y, w, h) {
      const imgW = img.width;
      const imgH = img.height;
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
    },

    async saveToPhotos() {
      if (!this.data.posterPath) return;

      try {
        await wx.saveImageToPhotosAlbum({
          filePath: this.data.posterPath
        });
        wx.showToast({ title: '已保存到相册', icon: 'success' });
        this.onClose();
      } catch (err) {
        if (err.errMsg.indexOf('auth deny') > -1) {
          wx.showModal({
            title: '授权提示',
            content: '需要您的相册授权才能保存图片',
            success: (res) => {
              if (res.confirm) wx.openSetting();
            }
          });
        }
      }
    }
  }
})
