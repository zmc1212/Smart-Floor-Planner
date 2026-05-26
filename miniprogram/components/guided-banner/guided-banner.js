Component({
  options: {
    styleIsolation: 'apply-shared'
  },
  properties: {
    guidedMode: { type: Boolean, value: false },
    measurementMode: { type: String, value: 'room' },
    wholeHomeStage: { type: String, value: '' },
    currentGuidedRoomName: { type: String, value: '' },
    guidedEdgeIndex: { type: Number, value: 0 },
    pendingDirection: { type: String, value: '' },
    canFinish: { type: Boolean, value: false },
    bleConnected: { type: Boolean, value: false }
  },
  data: {
    statusLabel: '',
    progressLabel: '',
    recommendationLabel: '',
    primaryActionLabel: '测下一边'
  },
  observers: {
    'guidedMode, measurementMode, wholeHomeStage, currentGuidedRoomName, guidedEdgeIndex, pendingDirection, canFinish': function () {
      this.updateSmartCopy();
    }
  },
  lifetimes: {
    attached: function () {
      this.updateSmartCopy();
    }
  },
  methods: {
    updateSmartCopy() {
      const directionLabels = {
        E: '东向墙',
        S: '南向墙',
        W: '西向墙',
        N: '北向墙',
        H: '层高'
      };
      const edgeIndex = this.data.guidedEdgeIndex || 0;
      const isHeightStep = edgeIndex < 0;
      const pendingDirection = this.data.pendingDirection || '';
      const nextLabel = isHeightStep
        ? directionLabels.H
        : (directionLabels[pendingDirection] || '下一段墙');

      if (this.data.measurementMode === 'whole_home') {
        if (this.data.wholeHomeStage === 'partition') {
          this.setData({
            statusLabel: '全屋骨架已生成',
            progressLabel: '分区/门窗',
            recommendationLabel: '继续完善内墙、门窗和空间属性',
            primaryActionLabel: '测下一边'
          });
          return;
        }

        this.setData({
          statusLabel: '全屋测量',
          progressLabel: isHeightStep ? '待测层高' : '已测 ' + edgeIndex + ' 边',
          recommendationLabel: '推荐下一步：' + nextLabel,
          primaryActionLabel: isHeightStep ? '测层高' : '按推荐测下一边'
        });
        return;
      }

      this.setData({
        statusLabel: this.data.currentGuidedRoomName || '当前房间',
        progressLabel: isHeightStep ? '待测层高' : '已测 ' + edgeIndex + ' 边',
        recommendationLabel: '推荐下一步：' + nextLabel,
        primaryActionLabel: isHeightStep ? '测层高' : '按推荐测下一边'
      });
    },
    onExitGuide() { this.triggerEvent('exitguide'); },
    onStartRemeasure() { this.triggerEvent('startremeasure'); },
    onExitToLibrary() { this.triggerEvent('exittolibrary'); },
    onSubmitFloorPlan() { this.triggerEvent('submitfloorplan'); },
    onAddEdge() { this.triggerEvent('addedge'); },
    onFinishPolygon() { this.triggerEvent('finishpolygon'); },
    onSaveDraft() { this.triggerEvent('savedraft'); }
  }
})
