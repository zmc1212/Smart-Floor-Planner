Component({
  methods: {
    onAutoConnectBLE() { this.triggerEvent('autoconnect'); },
    onConnectBLE() { this.triggerEvent('connect'); }
  }
})
