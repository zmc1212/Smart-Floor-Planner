Component({
  properties: {
    // True while heading-follow / automatic direction picking is active.
    active: {
      type: Boolean,
      value: false
    },
    bearingLabel: {
      type: String,
      value: ''
    }
  },
  methods: {
    onTap() {
      this.triggerEvent('tap');
    }
  }
});
