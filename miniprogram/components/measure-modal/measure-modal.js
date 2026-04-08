Component({
  properties: {
    show: { type: Boolean, value: false },
    edgeName: { 
      type: String, 
      value: '',
      observer: function(newVal) {
        let type = '';
        if (newVal === '上方') type = 'top';
        else if (newVal === '下方') type = 'bottom';
        else if (newVal === '左侧') type = 'left';
        else if (newVal === '右侧') type = 'right';
        this.setData({ edgeType: type });
      }
    }
  },
  data: {
    edgeType: ''
  },
  methods: {
    onConfirm() { this.triggerEvent('confirm'); }
  }
});
