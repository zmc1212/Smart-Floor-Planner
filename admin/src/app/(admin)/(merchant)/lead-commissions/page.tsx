'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageContainer, ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import {
  Button,
  Card,
  Col,
  Flex,
  Form,
  InputNumber,
  Modal,
  Row,
  Segmented,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
  type TableColumnsType,
} from 'antd';
import { CheckCircle2, Save } from 'lucide-react';
import { notify } from '@/components/admin/operation-feedback';

type CommissionRole = 'referrer' | 'designer' | 'measurer';
type CommissionStatus = 'payable' | 'paid' | 'voided';
type CalculationType = 'fixed' | 'percentage';

type Rule = {
  id: string;
  role: CommissionRole;
  calculationType: CalculationType;
  value: string;
  status: 'active' | 'disabled';
  version: number;
};

type Commission = {
  id: string;
  role: CommissionRole;
  ruleType: CalculationType;
  ruleValue: string;
  payableAmount: string;
  originalPayableAmount: string;
  originalBeneficiaryUserId: string;
  adjustedAt: string | null;
  adjustedBy: string | null;
  adjustReason: string | null;
  status: CommissionStatus;
  beneficiary: { id: string; nickname: string | null; phone: string | null } | null;
  lead: { id: string; name: string; phone: string; communityName: string | null; contractAmount: string | null; source?: string | null } | null;
  referrer: { nickname: string | null; phone: string | null } | null;
  designer: { displayName: string; phone: string | null } | null;
  measurer: { displayName: string; phone: string | null } | null;
  appointment: { address: string; timeRange: string; status: string } | null;
};

type PaymentFormValues = {
  payments: Array<{ paidAmount: string }>;
};

type LeadCommissionGroup = {
  leadKey: string;
  lead: Commission['lead'];
  referrer: Commission['referrer'];
  designer: Commission['designer'];
  measurer: Commission['measurer'];
  appointment: Commission['appointment'];
  commissions: Commission[];
  payableTotal: number;
  payableCount: number;
  paidCount: number;
  voidedCount: number;
  adjustedCount: number;
};

const ROLE_OPTIONS: Array<{ label: string; value: CommissionRole; color: string }> = [
  { label: '推荐人', value: 'referrer', color: 'green' },
  { label: '设计师', value: 'designer', color: 'blue' },
  { label: '测量员', value: 'measurer', color: 'orange' },
];

const ROLE_ORDER: Record<CommissionRole, number> = {
  referrer: 0,
  designer: 1,
  measurer: 2,
};

const STATUS_CONFIG: Record<CommissionStatus, { label: string; color: string }> = {
  payable: { label: '待支付', color: 'warning' },
  paid: { label: '已支付', color: 'success' },
  voided: { label: '已作废', color: 'default' },
};

function roleMeta(role: CommissionRole) {
  return ROLE_OPTIONS.find((item) => item.value === role) || ROLE_OPTIONS[0];
}

function formatAmount(value: string | number) {
  return Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateParam(value: unknown) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  const maybe = value as { format?: (token: string) => string };
  return typeof maybe.format === 'function' ? maybe.format('YYYY-MM-DD') : String(value).slice(0, 10);
}

function appointmentTime(value: string | null) {
  const match = value?.match(/^[[(]([^,]+),([^\])]+)[\])]/);
  if (!match) return '未预约';
  const start = new Date(match[1].replaceAll('"', ''));
  return Number.isNaN(start.getTime())
    ? '已预约'
    : start.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function leadGroupKey(record: Commission) {
  return record.lead?.id || `orphan-${record.id}`;
}

function buildLeadGroups(records: Commission[]): LeadCommissionGroup[] {
  const groups = new Map<string, Commission[]>();
  const order: string[] = [];
  for (const record of records) {
    const key = leadGroupKey(record);
    const bucket = groups.get(key);
    if (bucket) bucket.push(record);
    else {
      groups.set(key, [record]);
      order.push(key);
    }
  }

  return order.map((key) => {
    const commissions = [...(groups.get(key) || [])].sort(
      (left, right) => ROLE_ORDER[left.role] - ROLE_ORDER[right.role]
    );
    const sample = commissions[0];
    return {
      leadKey: key,
      lead: sample?.lead ?? null,
      referrer: sample?.referrer ?? null,
      designer: sample?.designer ?? null,
      measurer: sample?.measurer ?? null,
      appointment: sample?.appointment ?? null,
      commissions,
      payableTotal: commissions.reduce((sum, item) => sum + Number(item.payableAmount || 0), 0),
      payableCount: commissions.filter((item) => item.status === 'payable').length,
      paidCount: commissions.filter((item) => item.status === 'paid').length,
      voidedCount: commissions.filter((item) => item.status === 'voided').length,
      adjustedCount: commissions.filter((item) => Boolean(item.adjustedAt)).length,
    };
  });
}

function paginateLeadGroups(records: Commission[], current: number, pageSize: number) {
  const groups = buildLeadGroups(records);
  return {
    rows: groups.slice((current - 1) * pageSize, current * pageSize),
    total: groups.length,
  };
}

function PersonCell({ name, phone, emptyLabel }: { name?: string | null; phone?: string | null; emptyLabel?: string }) {
  return (
    <Flex vertical gap={0}>
      <Typography.Text strong>{name || emptyLabel || '未分配'}</Typography.Text>
      <Typography.Text type="secondary" className="text-xs">{phone || '—'}</Typography.Text>
    </Flex>
  );
}

function StatusSummary({ group }: { group: LeadCommissionGroup }) {
  return (
    <Flex wrap gap={4}>
      {group.payableCount ? <Tag color="warning">待支付 {group.payableCount}</Tag> : null}
      {group.paidCount ? <Tag color="success">已支付 {group.paidCount}</Tag> : null}
      {group.voidedCount ? <Tag>已作废 {group.voidedCount}</Tag> : null}
      {group.adjustedCount ? <Tag color="processing">已调整 {group.adjustedCount}</Tag> : null}
      {!group.payableCount && !group.paidCount && !group.voidedCount ? <Tag>无记录</Tag> : null}
    </Flex>
  );
}

export default function LeadCommissionsPage() {
  const actionRef = useRef<ActionType>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [records, setRecords] = useState<Commission[]>([]);
  const [loadingRules, setLoadingRules] = useState(true);
  const [savingRole, setSavingRole] = useState<CommissionRole | null>(null);
  const [paying, setPaying] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [paymentRecords, setPaymentRecords] = useState<Commission[]>([]);
  const [paymentForm] = Form.useForm<PaymentFormValues>();

  const loadRules = useCallback(async () => {
    const response = await fetch('/api/commission-rules');
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || '读取三方提成规则失败');
    setRules(result.data || []);
  }, []);

  useEffect(() => {
    setLoadingRules(true);
    void loadRules()
      .catch((error) => notify.error(error instanceof Error ? error.message : '读取三方提成规则失败'))
      .finally(() => setLoadingRules(false));
  }, [loadRules]);

  const updateRule = (role: CommissionRole, patch: Partial<Rule>) => {
    setRules((current) => current.map((rule) => (rule.role === role ? { ...rule, ...patch } : rule)));
  };

  const saveRule = async (role: CommissionRole) => {
    setSavingRole(role);
    try {
      const response = await fetch('/api/commission-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存提成规则失败');
      setRules(result.data || []);
      notify.success(`${roleMeta(role).label}提成规则已保存`);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存提成规则失败');
      void loadRules().catch(() => undefined);
    } finally {
      setSavingRole(null);
    }
  };

  const payableSelected = records.filter((record) => selected.includes(record.id) && record.status === 'payable');

  const openPayment = (recordsToPay: Commission[]) => {
    const payable = recordsToPay.filter((record) => record.status === 'payable');
    if (!payable.length) return;
    setPaymentRecords(payable);
    paymentForm.setFieldsValue({
      payments: payable.map((record) => ({
        paidAmount: Number(record.payableAmount) > 0 ? record.payableAmount : '',
      })),
    });
  };

  const closePayment = () => {
    if (paying) return;
    setPaymentRecords([]);
    paymentForm.resetFields();
  };

  const submitPayment = async () => {
    if (!paymentRecords.length || paying) return;
    try {
      const values = await paymentForm.validateFields();
      setPaying(true);
      const response = await fetch('/api/lead-commissions/mark-paid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payments: paymentRecords.map((record, index) => ({
            commissionId: record.id,
            paidAmount: values.payments[index].paidAmount,
          })),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '确认打款失败');
      notify.success(paymentRecords.length > 1 ? `${paymentRecords.length} 笔提成已确认打款` : '提成已确认打款');
      setPaymentRecords([]);
      paymentForm.resetFields();
      setSelected([]);
      await actionRef.current?.reload();
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) return;
      notify.error(error instanceof Error ? error.message : '确认打款失败');
    } finally {
      setPaying(false);
    }
  };

  const totals = useMemo(() => records.reduce<Record<CommissionStatus, number>>((result, record) => {
    result[record.status] += Number(record.payableAmount || 0);
    return result;
  }, { payable: 0, paid: 0, voided: 0 }), [records]);

  const leadGroups = useMemo(() => buildLeadGroups(records), [records]);

  const selectedLeadKeys = useMemo(
    () => leadGroups
      .filter((group) => {
        const payableIds = group.commissions
          .filter((item) => item.status === 'payable')
          .map((item) => item.id);
        return payableIds.length > 0 && payableIds.every((id) => selected.includes(id));
      })
      .map((group) => group.leadKey),
    [leadGroups, selected]
  );

  const toggleGroupSelection = (group: LeadCommissionGroup, checked: boolean) => {
    const payableIds = group.commissions
      .filter((item) => item.status === 'payable')
      .map((item) => item.id);
    if (!payableIds.length) return;
    setSelected((current) => {
      if (checked) {
        return Array.from(new Set([...current, ...payableIds]));
      }
      return current.filter((id) => !payableIds.includes(id));
    });
  };

  const childColumns: TableColumnsType<Commission> = [
    {
      title: '提成角色',
      dataIndex: 'role',
      width: 110,
      render: (role: CommissionRole) => {
        const meta = roleMeta(role);
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '规则',
      dataIndex: 'ruleType',
      width: 140,
      render: (_, record) => (
        <Flex vertical gap={0}>
          <Typography.Text>{record.ruleType === 'fixed' ? '固定金额' : '百分比'}</Typography.Text>
          <Typography.Text type="secondary" className="text-xs">
            {record.ruleType === 'fixed' ? `${record.ruleValue} 元/单` : `${record.ruleValue}%`}
          </Typography.Text>
        </Flex>
      ),
    },
    {
      title: '应付金额',
      dataIndex: 'payableAmount',
      width: 150,
      render: (_, record) => (
        <Flex vertical gap={0}>
          <Typography.Text strong>¥{formatAmount(record.payableAmount)}</Typography.Text>
          {record.adjustedAt && record.originalPayableAmount !== record.payableAmount ? (
            <Typography.Text type="secondary" className="text-xs">
              原始 ¥{formatAmount(record.originalPayableAmount)}
            </Typography.Text>
          ) : null}
        </Flex>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (_, record) => {
        const config = STATUS_CONFIG[record.status];
        return (
          <Flex vertical gap={4} align="flex-start">
            <Tag color={config.color}>{config.label}</Tag>
            {record.adjustedAt ? <Tag color="processing">已调整</Tag> : null}
          </Flex>
        );
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_, record) => record.status === 'payable' ? (
        <Button
          type="link"
          size="small"
          icon={<CheckCircle2 size={14} />}
          onClick={() => openPayment([record])}
        >
          确认打款
        </Button>
      ) : null,
    },
  ];

  const columns: ProColumns<LeadCommissionGroup>[] = [
    {
      title: '状态',
      dataIndex: 'status',
      valueType: 'select',
      valueEnum: Object.fromEntries(Object.entries(STATUS_CONFIG).map(([value, item]) => [value, item.label])),
      fieldProps: { allowClear: true, placeholder: '全部状态' },
      hideInTable: true,
    },
    {
      title: '角色',
      dataIndex: 'role',
      valueType: 'select',
      valueEnum: Object.fromEntries(ROLE_OPTIONS.map((item) => [item.value, item.label])),
      fieldProps: { allowClear: true, placeholder: '全部角色' },
      hideInTable: true,
    },
    {
      title: '线索来源',
      dataIndex: 'source',
      hideInTable: true,
      valueType: 'select',
      valueEnum: {
        referrer_network: '推荐人网络',
        staff_activity: '员工活动码',
        manual_entry: '企业录入',
      },
      fieldProps: { allowClear: true, placeholder: '全部来源' },
    },
    {
      title: '创建日期',
      dataIndex: 'createdRange',
      valueType: 'dateRange',
      hideInTable: true,
      fieldProps: { format: 'YYYY-MM-DD' },
    },
    {
      title: '客户',
      dataIndex: 'lead',
      hideInSearch: true,
      width: 160,
      render: (_, record) => <PersonCell name={record.lead?.name} phone={record.lead?.phone} />,
    },
    {
      title: '推荐人',
      dataIndex: 'referrer',
      hideInSearch: true,
      width: 160,
      render: (_, record) => record.referrer
        ? <PersonCell name={record.referrer.nickname} phone={record.referrer.phone} />
        : <PersonCell emptyLabel="无推荐人" />,
    },
    {
      title: '设计师',
      dataIndex: 'designer',
      hideInSearch: true,
      width: 160,
      render: (_, record) => <PersonCell name={record.designer?.displayName} phone={record.designer?.phone} />,
    },
    {
      title: '测量员',
      dataIndex: 'measurer',
      hideInSearch: true,
      width: 160,
      render: (_, record) => <PersonCell name={record.measurer?.displayName} phone={record.measurer?.phone} />,
    },
    {
      title: '上门预约',
      dataIndex: 'appointment',
      hideInSearch: true,
      width: 180,
      render: (_, record) => (
        <Flex vertical gap={0}>
          <Typography.Text>{appointmentTime(record.appointment?.timeRange || null)}</Typography.Text>
          <Typography.Text type="secondary" className="text-xs">{record.appointment?.address || '未预约'}</Typography.Text>
        </Flex>
      ),
    },
    {
      title: '提成合计',
      dataIndex: 'payableTotal',
      hideInSearch: true,
      width: 140,
      render: (_, record) => (
        <Flex vertical gap={0}>
          <Typography.Text strong>¥{formatAmount(record.payableTotal)}</Typography.Text>
          <Typography.Text type="secondary" className="text-xs">{record.commissions.length} 条角色提成</Typography.Text>
        </Flex>
      ),
    },
    {
      title: '状态摘要',
      dataIndex: 'statusSummary',
      hideInSearch: true,
      width: 220,
      render: (_, record) => <StatusSummary group={record} />,
    },
  ];

  return (
    <div className="admin-page-frame">
      <PageContainer
        breadcrumbRender={false}
        className="admin-page-container"
        title="三方提成"
        content="配置推荐人、设计师、测量员的提成规则；签单后展开明细，核对实际金额并确认打款。"
      >
        <Flex vertical gap={24}>
          <Row gutter={[16, 16]}>
            {ROLE_OPTIONS.map(({ label, value: role }) => {
              const rule = rules.find((item) => item.role === role);
              const isFixed = rule?.calculationType === 'fixed';
              return (
                <Col key={role} xs={24} xl={8}>
                  <Card
                    className="admin-panel-card"
                    loading={loadingRules}
                    title={`${label}提成`}
                    extra={<Tag color={rule?.status === 'active' ? 'success' : 'default'}>{rule?.status === 'active' ? '生效中' : '已停用'}</Tag>}
                  >
                    <Form layout="vertical">
                      <Form.Item label="提成方式">
                        <Segmented<CalculationType>
                          block
                          disabled={!rule}
                          value={rule?.calculationType || 'fixed'}
                          options={[
                            { label: '固定金额', value: 'fixed' },
                            { label: '百分比', value: 'percentage' },
                          ]}
                          onChange={(type) => updateRule(role, { calculationType: type })}
                        />
                      </Form.Item>
                      <Form.Item label="规则值">
                        <InputNumber
                          stringMode
                          min="0"
                          max={isFixed ? undefined : '100'}
                          step="0.0001"
                          controls={false}
                          disabled={!rule}
                          style={{ width: '100%' }}
                          addonBefore={isFixed ? '¥' : undefined}
                          addonAfter={<span className="whitespace-nowrap">{isFixed ? '元/单' : '%'}</span>}
                          value={rule?.value}
                          onChange={(value) => updateRule(role, { value: value == null ? '' : String(value) })}
                        />
                      </Form.Item>
                      <Form.Item extra="更改启用状态后需保存才会生效">
                        <Switch
                          disabled={!rule}
                          checked={rule?.status === 'active'}
                          checkedChildren="生效中"
                          unCheckedChildren="已停用"
                          onChange={(checked) => updateRule(role, { status: checked ? 'active' : 'disabled' })}
                        />
                      </Form.Item>
                      <Button
                        type="primary"
                        block
                        icon={<Save size={16} />}
                        loading={savingRole === role}
                        disabled={!rule || savingRole !== null}
                        onClick={() => void saveRule(role)}
                      >
                        保存规则
                      </Button>
                    </Form>
                  </Card>
                </Col>
              );
            })}
          </Row>

          <ProTable<LeadCommissionGroup>
            className="admin-mobile-filter-stack"
            headerTitle="签单提成台账"
            actionRef={actionRef}
            rowKey="leadKey"
            columns={columns}
            search={{ labelWidth: 'auto', defaultCollapsed: false, span: 8 }}
            options={{ reload: true, density: true, setting: false }}
            pagination={{ defaultPageSize: 10, showSizeChanger: true }}
            scroll={{ x: 1180 }}
            expandable={{
              expandedRowKeys: expandedKeys,
              onExpandedRowsChange: (keys) => setExpandedKeys(keys.map(String)),
              expandedRowRender: (group) => {
                const payableIds = group.commissions
                  .filter((item) => item.status === 'payable')
                  .map((item) => item.id);
                const selectedInGroup = payableIds.filter((id) => selected.includes(id));
                return (
                  <Table<Commission>
                    size="small"
                    rowKey="id"
                    pagination={false}
                    columns={childColumns}
                    dataSource={group.commissions}
                    rowSelection={{
                      selectedRowKeys: selectedInGroup,
                      onChange: (keys) => {
                        const nextKeys = keys.map(String);
                        setSelected((current) => {
                          const withoutGroup = current.filter((id) => !payableIds.includes(id));
                          return [...withoutGroup, ...nextKeys];
                        });
                      },
                      getCheckboxProps: (record) => ({ disabled: record.status !== 'payable' }),
                    }}
                  />
                );
              },
            }}
            rowSelection={{
              selectedRowKeys: selectedLeadKeys,
              onSelect: (record, selectedFlag) => toggleGroupSelection(record, selectedFlag),
              onSelectAll: (selectedFlag, _selectedRows, changeRows) => {
                changeRows.forEach((group) => toggleGroupSelection(group, selectedFlag));
              },
              getCheckboxProps: (record) => ({
                disabled: record.payableCount === 0,
              }),
            }}
            tableAlertRender={() => (
              <span>
                已选择 <Typography.Text strong>{payableSelected.length}</Typography.Text> 条待支付提成
              </span>
            )}
            tableAlertOptionRender={() => (
              <Button type="link" size="small" onClick={() => setSelected([])}>
                取消选择
              </Button>
            )}
            toolBarRender={() => [
              <Button
                key="paid"
                type="primary"
                icon={<CheckCircle2 size={16} />}
                disabled={!payableSelected.length}
                loading={paying}
                onClick={() => openPayment(payableSelected)}
              >
                批量确认打款{payableSelected.length ? ` (${payableSelected.length})` : ''}
              </Button>,
            ]}
            request={async (params) => {
              const query = new URLSearchParams();
              if (params.status) query.set('status', String(params.status));
              if (params.role) query.set('role', String(params.role));
              if (params.source) query.set('source', String(params.source));
              const range = params.createdRange as unknown[] | undefined;
              const fromDate = formatDateParam(range?.[0]);
              const toDate = formatDateParam(range?.[1]);
              if (fromDate) query.set('fromDate', fromDate);
              if (toDate) query.set('toDate', toDate);
              const response = await fetch(`/api/lead-commissions?${query}`);
              const result = await response.json();
              if (!response.ok || !result.success) throw new Error(result.error || '读取签单提成台账失败');
              const rows = (result.data || []) as Commission[];
              setRecords(rows);
              setSelected((current) => current.filter((id) => rows.some((row) => row.id === id && row.status === 'payable')));
              const pageSize = Number(params.pageSize || 10);
              const current = Number(params.current || 1);
              const page = paginateLeadGroups(rows, current, pageSize);
              setExpandedKeys(page.rows.map((group) => group.leadKey));
              return {
                data: page.rows,
                total: page.total,
                success: true,
              };
            }}
            onRequestError={(error) => notify.error(error instanceof Error ? error.message : '读取签单提成台账失败')}
          />

          <Row gutter={[16, 16]}>
            <Col xs={24} md={8}>
              <Card className="admin-panel-card" size="small">
                <Statistic title="待支付金额" value={totals.payable} precision={2} prefix="¥" />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card className="admin-panel-card" size="small">
                <Statistic title="已支付金额" value={totals.paid} precision={2} prefix="¥" />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card className="admin-panel-card" size="small">
                <Statistic title="已作废金额" value={totals.voided} precision={2} prefix="¥" />
              </Card>
            </Col>
          </Row>
        </Flex>
      </PageContainer>

      <Modal
        title={paymentRecords.length > 1 ? `批量确认打款（${paymentRecords.length} 笔）` : `确认${paymentRecords[0] ? roleMeta(paymentRecords[0].role).label : ''}打款`}
        open={paymentRecords.length > 0}
        onCancel={closePayment}
        onOk={() => void submitPayment()}
        confirmLoading={paying}
        destroyOnHidden
        okText="确认打款"
        cancelText="取消"
      >
        <Typography.Paragraph type="secondary" className="mt-4 mb-4">
          核对实际打款金额。确认后系统将保存最终金额、记录付款人和时间，并自动标记为已支付。
        </Typography.Paragraph>
        <Form form={paymentForm} layout="vertical">
          {paymentRecords.map((record, index) => (
            <Form.Item
              key={record.id}
              label={`${roleMeta(record.role).label} · ${record.beneficiary?.nickname || record.beneficiary?.phone || '未命名受益人'}`}
              name={['payments', index, 'paidAmount']}
              extra={record.originalPayableAmount !== record.payableAmount
                ? `当前应付 ¥${formatAmount(record.payableAmount)}；签单原始 ¥${formatAmount(record.originalPayableAmount)}`
                : `当前应付 ¥${formatAmount(record.payableAmount)}`}
              rules={[
                { required: true, message: '请输入实际打款金额' },
                {
                  validator: async (_, value) => {
                    const amount = Number(value);
                    if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999999.99) {
                      throw new Error('请输入 0.01 至 999999999999.99');
                    }
                  },
                },
              ]}
            >
              <InputNumber
                stringMode
                min="0.01"
                max="999999999999.99"
                step="0.01"
                controls={false}
                style={{ width: '100%' }}
                addonBefore="¥"
                precision={2}
                placeholder="请输入实际打款金额"
              />
            </Form.Item>
          ))}
        </Form>
      </Modal>
    </div>
  );
}
