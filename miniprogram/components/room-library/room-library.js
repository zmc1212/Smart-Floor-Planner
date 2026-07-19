Component({
  options: {
    styleIsolation: 'apply-shared'
  },
  properties: {
    plannedRooms: { type: Array, value: [] },
    layoutTemplates: { type: Array, value: [] },
    myCloudFloorPlans: { type: Array, value: [] }
  },
  methods: {
    onSelectLayout(e) { this.triggerEvent('selectlayout', { id: e.currentTarget.dataset.id }); },
    onOpenCloudPlan(e) {
      const id = e.currentTarget.dataset.id;
      const fp = this.properties.myCloudFloorPlans.find(f => f._id === id);
      if (fp) {
        const { openSurveyingEditor } = require('../../utils/surveyNavigation.js');
        openSurveyingEditor({ floorPlanId: fp._id });
      }
    },
    onResetLayout() { this.triggerEvent('resetlayout'); },
    onEnterRoom: function (e) {
      this.triggerEvent('enterroom', { id: e.currentTarget.dataset.id });
    },
    onAddRoom: function () {
      this.triggerEvent('addroom');
    },

    onAIGen: function (e) {
      this.triggerEvent('aigen', { id: e.currentTarget.dataset.id });
    }
  }
})
