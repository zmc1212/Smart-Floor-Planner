Component({
  options: {
    styleIsolation: 'apply-shared'
  },
  properties: {
    show: { type: Boolean, value: false },
    currentStep: { type: Number, value: 1 },
    lastDirection: { type: String, value: '' },
    suggestedDirection: { type: String, value: '' },
    canFinish: { type: Boolean, value: false }
  },
  data: {
    selectedDirection: 'H',
    availableDirections: [],
    showAdvancedDirections: false,
    canOverrideDirection: false,
    recommendedDirection: 'H',
    recommendedLabel: '层高',
    recommendedDesc: '先测量层高，后续 3D 预览会自动使用',
    activeDirectionLabel: '层高',
    activeDirectionDesc: '先测量层高，后续 3D 预览会自动使用',
    smartKicker: '智能推荐',
    smartBadgeText: '推荐',
    guidanceTitle: '先量层高',
    guidanceText: '把测距仪垂直对准天花板，保持稳定后开始测量。',
    primaryActionText: '开始测层高',
    allDirections: [
      { key: 'H', label: '\u5c42\u9ad8', desc: '\u6d4b\u91cf\u623f\u95f4\u5c42\u9ad8' },
      { key: 'E', label: '\u4e1c\u5411', desc: '\u5411\u53f3\uff08\u6a2a\u5411\uff09' },
      { key: 'S', label: '\u5357\u5411', desc: '\u5411\u4e0b\uff08\u7eb5\u5411\uff09' },
      { key: 'W', label: '\u897f\u5411', desc: '\u5411\u5de6\uff08\u6a2a\u5411\uff09' },
      { key: 'N', label: '\u5317\u5411', desc: '\u5411\u4e0a\uff08\u7eb5\u5411\uff09' },
      { key: 'ANGLE', label: '\u659c\u89d2', desc: '\u975e\u76f4\u89d2\u5899\u9762' }
    ]
  },
  observers: {
    'show, currentStep, lastDirection, suggestedDirection, canFinish': function (show, step, lastDir, suggestedDir) {
      if (!show) return;

      let available = [];
      let defaultSelect = 'E';

      if (step === 0) {
        available = this.data.allDirections.filter(d => d.key === 'H');
        defaultSelect = 'H';
      } else {
        const angleOption = this.data.allDirections.filter(d => d.key === 'ANGLE');
        if (lastDir === 'ANGLE') {
          available = this.data.allDirections.filter(d => d.key !== 'H' && d.key !== 'ANGLE');
          defaultSelect = 'E';
        } else if (lastDir === 'E' || lastDir === 'W') {
          available = this.data.allDirections.filter(d => d.key === 'S' || d.key === 'N');
          defaultSelect = 'S';
        } else if (lastDir === 'S' || lastDir === 'N') {
          available = this.data.allDirections.filter(d => d.key === 'E' || d.key === 'W');
          defaultSelect = 'E';
        } else {
          available = this.data.allDirections.filter(d => d.key !== 'H' && d.key !== 'ANGLE');
          defaultSelect = 'E';
        }
        if (step >= 2) {
          available = available.concat(angleOption);
        }
      }

      const suggested = suggestedDir && available.some(d => d.key === suggestedDir)
        ? suggestedDir
        : defaultSelect;
      const recommended = available.find(d => d.key === suggested) || available[0] || this.data.allDirections[0];
      const isHeight = step === 0;
      const isAngle = recommended.key === 'ANGLE';
      const edgeNumber = Math.max(1, step);
      let guidanceTitle = isHeight ? '先量层高' : '推荐下一边';
      let guidanceText = isHeight
        ? '把测距仪垂直对准天花板，保持稳定后开始测量。'
        : '已按常见顺时针测量路径选好方向，直接开始即可；墙面不规则时可改方向或选择斜角。';
      let primaryActionText = isHeight ? '开始测层高' : '按推荐方向测第' + edgeNumber + '边';

      if (isAngle) {
        guidanceTitle = '测斜角墙';
        guidanceText = '斜角墙需要依次测墙 A、墙 B 和对角线，系统会自动计算夹角。';
        primaryActionText = '开始测斜角';
      }

      this.setData({
        availableDirections: available,
        selectedDirection: suggested,
        recommendedDirection: recommended.key,
        recommendedLabel: recommended.label,
        recommendedDesc: recommended.desc,
        activeDirectionLabel: recommended.label,
        activeDirectionDesc: recommended.desc,
        smartKicker: '智能推荐',
        smartBadgeText: '推荐',
        guidanceTitle: guidanceTitle,
        guidanceText: guidanceText,
        primaryActionText: primaryActionText,
        canOverrideDirection: available.length > 1,
        showAdvancedDirections: false
      });
    }
  },
  methods: {
    getPrimaryActionText(direction) {
      const step = Math.max(1, this.data.currentStep || 1);
      if (this.data.currentStep === 0 || direction === 'H') return '开始测层高';
      if (direction === 'ANGLE') return '开始测斜角';
      const prefix = direction === this.data.recommendedDirection ? '按推荐方向' : '按所选方向';
      return prefix + '测第' + step + '边';
    },
    onSelectDirection(e) {
      const direction = e.currentTarget.dataset.dir;
      const option = this.data.availableDirections.find(d => d.key === direction) || {};
      const isRecommended = direction === this.data.recommendedDirection;
      this.setData({
        selectedDirection: direction,
        activeDirectionLabel: option.label || this.data.recommendedLabel,
        activeDirectionDesc: option.desc || this.data.recommendedDesc,
        smartKicker: isRecommended ? '智能推荐' : '手动选择',
        smartBadgeText: isRecommended ? '推荐' : '已修改',
        primaryActionText: this.getPrimaryActionText(direction)
      });
    },
    onToggleAdvanced() {
      this.setData({ showAdvancedDirections: !this.data.showAdvancedDirections });
    },
    onConfirm() {
      if (this.data.selectedDirection === 'ANGLE') {
        this.triggerEvent('startangle');
      } else {
        this.triggerEvent('confirm', { direction: this.data.selectedDirection });
      }
    },
    onFinish() {
      this.triggerEvent('finish');
    },
    onClose() {
      this.triggerEvent('close');
    }
  }
});
