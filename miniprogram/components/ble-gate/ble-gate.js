Component({
  options: {
    styleIsolation: 'apply-shared'
  },
  methods: {
    onAutoConnectBLE() { this.triggerEvent('autoconnect'); },
    onConnectBLE() { this.triggerEvent('connect'); }
  }
})
