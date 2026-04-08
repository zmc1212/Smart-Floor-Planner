Component({
  properties: {
    roomsCount: { type: Number, value: 0 },
    totalArea: { type: String, value: '0.00' },
    bleConnected: { type: Boolean, value: false }
  },
  methods: {
    onConnect() { this.triggerEvent('reconnect'); }
  }
})
