Component({
  properties: {
    show: {
      type: Boolean,
      value: false,
      observer: function(newVal) {
        if (newVal) this.initCanvas();
      }
    },
    rooms: {
      type: Array,
      value: []
    },
    branding: {
      type: Object,
      value: null
    },
    planName: {
      type: String,
      value: '新家测绘报告'
    }
  },

  data: {
    tempFile: '',
    canvasHeight: 1800,
    saveText: '保存到相册'
  },

  methods: {
    onClose() {
      this.triggerEvent('close');
      this.setData({ tempFile: '' });
    },

    initCanvas() {
      const query = this.createSelectorQuery();
      query.select('#reportCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res[0] || !res[0].node) return;
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');

          // Calculate height based on data
          const headHeight = 200;
          const planHeight = 600;
          const listHeaderHeight = 100;
          const listHeight = this.data.rooms.length * 80 + 150;
          const totalHeight = headHeight + planHeight + listHeaderHeight + listHeight + 100;

          this.setData({ canvasHeight: totalHeight }, () => {
            // Wait for height update to propagate to canvas style if needed
            // But with type="2d" we can just set the node size
            const dpr = wx.getSystemInfoSync().pixelRatio;
            canvas.width = 750 * dpr;
            canvas.height = totalHeight * dpr;
            ctx.scale(dpr, dpr);

            this.drawReport(canvas, ctx, totalHeight);
          });
        });
    },

    async drawReport(canvas, ctx, totalHeight) {
      const rooms = this.data.rooms;
      const branding = this.data.branding || {};
      const primaryColor = branding.primaryColor || '#171717';
      const accentColor = branding.accentColor || '#0070f3';

      // 1. Background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 750, totalHeight);

      // 2. Header
      ctx.fillStyle = primaryColor;
      ctx.fillRect(0, 0, 750, 160);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 36px sans-serif';
      ctx.fillText(branding.name || '智能量房专家', 40, 75);
      
      ctx.font = '24px sans-serif';
      ctx.globalAlpha = 0.7;
      ctx.fillText('专业的数字化量房产出报告', 40, 115);
      ctx.globalAlpha = 1.0;

      // Plan Name Badge
      ctx.fillStyle = '#ffffff';
      this.drawRoundRect(ctx, 40, 180, 670, 80, 12);
      ctx.fillStyle = '#f5f5f5';
      ctx.fill();
      
      ctx.fillStyle = '#171717';
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText(`项目名称: ${this.data.planName}`, 70, 230);

      // 3. 2D Plan Section
      const planY = 300;
      ctx.strokeStyle = '#eeeeee';
      ctx.lineWidth = 1;
      this.drawGrid(ctx, 40, planY, 670, 500);

      // Draw Floor Plan Logic
      this.drawFloorPlan(ctx, 40, planY, 670, 500, rooms);

      // 4. Room Data List Section
      const listY = planY + 540;
      ctx.fillStyle = '#171717';
      ctx.font = 'bold 32px sans-serif';
      ctx.fillText('空间数据明细', 40, listY);

      // Table Header
      ctx.fillStyle = '#f8f8f8';
      ctx.fillRect(40, listY + 30, 670, 60);
      ctx.fillStyle = '#666666';
      ctx.font = '24px sans-serif';
      ctx.fillText('空间名称', 60, listY + 70);
      ctx.fillText('长(m)', 250, listY + 70);
      ctx.fillText('宽(m)', 400, listY + 70);
      ctx.fillText('高度', 550, listY + 70);
      ctx.fillText('面积', 660, listY + 70);

      let currentY = listY + 120;
      rooms.forEach((room, index) => {
        ctx.fillStyle = index % 2 === 0 ? '#ffffff' : '#fafafa';
        ctx.fillRect(40, currentY - 30, 670, 80);

        ctx.fillStyle = '#171717';
        ctx.font = '24px sans-serif';
        ctx.fillText(room.name || `空间 ${index + 1}`, 60, currentY + 15);
        
        ctx.font = 'bold 24px sans-serif';
        ctx.fillText((room.width / 10).toFixed(2), 250, currentY + 15);
        ctx.fillText((room.height / 10).toFixed(2), 400, currentY + 15);
        ctx.fillText(`${(room.height3D || 28)/10}m`, 550, currentY + 15);
        
        const area = (room.width * room.height / 100).toFixed(2);
        ctx.fillStyle = accentColor;
        ctx.fillText(`${area}㎡`, 660, currentY + 15);

        currentY += 80;
      });

      // 5. Footer
      ctx.fillStyle = '#999999';
      ctx.font = '22px sans-serif';
      const timeStr = new Date().toLocaleString();
      ctx.fillText(`生成于 ${timeStr} · 智简测绘技术支持`, 40, totalHeight - 40);

      // Generate Temp Image
      wx.canvasToTempFilePath({
        canvas,
        success: (res) => {
          this.setData({ tempFile: res.tempFilePath });
        },
        fail: (err) => {
          console.error('Canvas to Temp Image failed:', err);
          wx.showToast({ title: '图像生成失败', icon: 'none' });
        }
      }, this);
    },

    drawFloorPlan(ctx, x, y, w, h, rooms) {
      if (!rooms.length) return;
      
      // Calculate Bounding Box and Scale accurately for all room types
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      
      rooms.forEach(r => {
        if (r.polygon && r.polygon.length > 0) {
          r.polygon.forEach(p => {
            const worldX = r.x + p.x;
            const worldY = r.y + p.y;
            if (worldX < minX) minX = worldX;
            if (worldY < minY) minY = worldY;
            if (worldX > maxX) maxX = worldX;
            if (worldY > maxY) maxY = worldY;
          });
        } else {
          if (r.x < minX) minX = r.x;
          if (r.y < minY) minY = r.y;
          if (r.x + r.width > maxX) maxX = r.x + r.width;
          if (r.y + r.height > maxY) maxY = r.y + r.height;
        }
      });
      
      const planW = maxX - minX;
      const planH = maxY - minY;
      const scale = Math.min((w - 80) / planW, (h - 80) / planH);
      
      const offsetX = x + (w - planW * scale) / 2 - minX * scale;
      const offsetY = y + (h - planH * scale) / 2 - minY * scale;

      ctx.save();
      
      rooms.forEach(room => {
        const rx = room.x * scale + offsetX;
        const ry = room.y * scale + offsetY;
        const rw = (room.width || 0) * scale;
        const rh = (room.height || 0) * scale;

        // Draw Room Path (irregular or rect)
        ctx.beginPath();
        if (room.polygon && room.polygon.length >= 3) {
          const pts = room.polygon;
          ctx.moveTo(pts[0].x * scale + rx, pts[0].y * scale + ry);
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x * scale + rx, pts[i].y * scale + ry);
          }
          if (room.polygonClosed) ctx.closePath();
        } else {
          ctx.rect(rx, ry, rw, rh);
        }

        // Fill
        ctx.fillStyle = room.color || '#f0f0f0';
        ctx.globalAlpha = 0.5;
        ctx.fill();
        ctx.globalAlpha = 1.0;

        // Walls
        ctx.strokeStyle = '#171717';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Label (Center of room)
        ctx.fillStyle = '#171717';
        ctx.font = 'bold 18px sans-serif';
        const labelX = (room.polygon && room.polygon.length) ? (rx + (room.width/2) * scale) : (rx + rw/2);
        const labelY = (room.polygon && room.polygon.length) ? (ry + (room.height/2) * scale) : (ry + rh/2);
        ctx.fillText(room.name || '空间', labelX - 20, labelY);
      });

      ctx.restore();
    },

    drawGrid(ctx, x, y, w, h) {
      const step = 50;
      ctx.beginPath();
      for (let i = 0; i <= w; i += step) {
        ctx.moveTo(x + i, y);
        ctx.lineTo(x + i, y + h);
      }
      for (let j = 0; j <= h; j += step) {
        ctx.moveTo(x, y + j);
        ctx.lineTo(x + w, y + j);
      }
      ctx.stroke();
    },

    drawRoundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
    },

    onSave() {
      if (!this.data.tempFile) return;
      this.setData({ saveText: '正在保存...' });
      
      wx.saveImageToPhotosAlbum({
        filePath: this.data.tempFile,
        success: () => {
          wx.showToast({ title: '已保存到相册', icon: 'success' });
          this.setData({ saveText: '保存成功' });
          setTimeout(() => this.setData({ saveText: '保存到相册' }), 2000);
        },
        fail: (err) => {
          if (err.errMsg.indexOf('auth deny') > -1) {
            wx.showModal({
              title: '提示',
              content: '请授权保存到相册',
              success: (res) => {
                if (res.confirm) wx.openSetting();
              }
            });
          }
          this.setData({ saveText: '保存到相册' });
        }
      });
    }
  }
});
