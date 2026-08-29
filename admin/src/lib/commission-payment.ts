import { parsePostgresId } from '@/db/postgres-dto';

export type ParsedCommissionPayment = {
  commissionId: bigint;
  paidAmount: string;
};

export function parseCommissionPayments(value: unknown): ParsedCommissionPayment[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw Object.assign(new Error('payments 必须包含 1 至 100 条付款记录'), {
      code: 'commission_payments_invalid',
      status: 400,
    });
  }

  const payments = value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw Object.assign(new Error(`第 ${index + 1} 条付款记录格式无效`), {
        code: 'commission_payment_invalid',
        status: 400,
      });
    }
    const input = entry as { commissionId?: unknown; paidAmount?: unknown };
    if (input.commissionId === undefined || input.commissionId === null || input.commissionId === '') {
      throw Object.assign(new Error(`第 ${index + 1} 条付款记录缺少 commissionId`), {
        code: 'commission_payment_invalid',
        status: 400,
      });
    }
    if (typeof input.paidAmount !== 'string' && typeof input.paidAmount !== 'number') {
      throw Object.assign(new Error(`第 ${index + 1} 条实际打款金额格式无效`), {
        code: 'commission_paid_amount_invalid',
        status: 400,
      });
    }
    const paidAmount = String(input.paidAmount).trim();
    if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(paidAmount) || Number(paidAmount) <= 0) {
      throw Object.assign(new Error('实际打款金额须为 0.01 至 999999999999.99，最多两位小数'), {
        code: 'commission_paid_amount_invalid',
        status: 400,
      });
    }
    return {
      commissionId: parsePostgresId(input.commissionId, 'commission id'),
      paidAmount,
    };
  });

  if (new Set(payments.map((payment) => payment.commissionId.toString())).size !== payments.length) {
    throw Object.assign(new Error('同一条提成不能重复确认打款'), {
      code: 'commission_payment_duplicate',
      status: 400,
    });
  }
  return payments;
}
