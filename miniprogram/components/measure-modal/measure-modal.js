Component({
  properties: {
    show: { type: Boolean, value: false },
    edgeName: { type: String, value: '' }
  },
  methods: {
    onConfirm() { this.triggerEvent('confirm'); }
  }
})
