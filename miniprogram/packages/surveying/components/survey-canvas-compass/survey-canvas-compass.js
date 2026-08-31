Component({
  properties: {
    safeTop: {
      type: Number,
      value: 0
    },
    // Current canvas view rotation in degrees; the dial mirrors it so the
    // needle keeps pointing to the plan's "north" (world up) on screen.
    rotationDeg: {
      type: Number,
      value: 0
    },
    // True while the canvas follows the phone heading.
    active: {
      type: Boolean,
      value: false
    }
  },
  methods: {
    onTap() {
      this.triggerEvent('tap');
    }
  }
});
