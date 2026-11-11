import type { SimulationFixtures, SimulationScenario } from '../simulate';

/** Synthetic weekly report scenario. Records are raw entries, never dailies. */
export const weeklyReportScenario: SimulationScenario = {
  runIdPrefix: 'sim-native-weekly',
  clock: { startedAt: '2026-11-11T09:30:00.000Z', stepMs: 1000 },
  events: [
    {
      eventId: 'evt-weekly-20261111-0001',
      eventType: 'period_report',
      occurredAt: '2026-11-11T09:28:00.000Z',
      periodKind: 'weekly',
      periodStart: '2026-11-02',
      periodEnd: '2026-11-09',
    },
  ],
};

export const dailyReportScenario: SimulationScenario = {
  runIdPrefix: 'sim-native-daily',
  clock: { startedAt: '2026-11-11T10:00:00.000Z', stepMs: 1000 },
  events: [
    {
      eventId: 'evt-daily-20261111-0001',
      eventType: 'period_report',
      occurredAt: '2026-11-11T09:58:00.000Z',
      periodKind: 'daily',
      periodStart: '2026-11-10',
      periodEnd: '2026-11-10',
    },
  ],
};

interface ReportFixtureOptions {
  readonly title: string;
  readonly recordDates: readonly [string, string];
  readonly receiptPrefix: string;
}

function reportFixtures(options: ReportFixtureOptions): SimulationFixtures {
  const [firstDate, secondDate] = options.recordDates;
  return {
    nodes: {
      'read-records': {
        status: 'ok',
        outputs: {
          records: [
            {
              recordId: 'sim-record-0001',
              projectId: 'sim-project-01',
              source: 'construction_record',
              occurredAt: firstDate,
              summary: '客厅墙面开槽完成',
            },
            {
              recordId: 'sim-record-0002',
              projectId: 'sim-project-01',
              source: 'construction_record',
              occurredAt: secondDate,
              summary: '水电线管布设并完成固定',
            },
          ],
          recordCount: 2,
          hasRecords: true,
        },
      },
      'read-photos': {
        status: 'ok',
        outputs: {
          photos: [
            { photoId: 'sim-photo-0001', projectId: 'sim-project-01', source: 'manager_upload', role: 'manager' },
          ],
          photoCount: 1,
        },
      },
      'read-receivers': {
        status: 'ok',
        outputs: {
          receivers: { scope: 'project_members', roles: ['owner', 'worker', 'designer', 'enterprise_admin'] },
          receiverCount: 4,
        },
      },
      'compose-report': {
        status: 'ok',
        outputs: {
          title: options.title,
          body: '模拟整理内容：本期按原始施工记录整理 2 条进展、获权照片 1 张。',
          missingItems: [],
        },
      },
      'save-report': {
        status: 'ok',
        outputs: {
          saved: true,
          saveReceipt: { receiptId: `sim-save-${options.receiptPrefix}-0001`, simulated: true },
        },
      },
      'deliver-report': {
        status: 'ok',
        outputs: {
          delivered: true,
          deliveryReceipt: { receiptId: `sim-deliver-${options.receiptPrefix}-0001`, simulated: true },
        },
      },
    },
  };
}

export const periodReportFixtures = reportFixtures({
  title: '施工周报（模拟）',
  recordDates: ['2026-11-05', '2026-11-07'],
  receiptPrefix: 'weekly',
});

export const dailyReportFixtures = reportFixtures({
  title: '施工日报（模拟）',
  recordDates: ['2026-11-10', '2026-11-10'],
  receiptPrefix: 'daily',
});
