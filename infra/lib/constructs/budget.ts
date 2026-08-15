import * as budgets from 'aws-cdk-lib/aws-budgets';
import { Construct } from 'constructs';

export interface BudgetConstructProps {
  /** 月間予算額(USD)。8.2章の概算(初年度ほぼ$0〜数十円/月)から大きく外れた場合に検知する */
  monthlyLimitUsd?: number;
  /** 予算超過アラートの通知先メールアドレス。未指定の場合は通知購読なしでBudgetのみ作成する */
  alertEmail?: string;
}

/**
 * AWS Budgetsによる月間コスト監視(要件定義書 8.4章「コスト監視」決定済み)。
 * しきい値の目安(例: 月$5)。実際の値はデプロイ時にpropsで指定する。
 */
export class BudgetConstruct extends Construct {
  constructor(scope: Construct, id: string, props: BudgetConstructProps = {}) {
    super(scope, id);

    const monthlyLimitUsd = props.monthlyLimitUsd ?? 5;

    new budgets.CfnBudget(this, 'MonthlyCostBudget', {
      budget: {
        budgetName: 'bilingual-app-monthly-budget',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: {
          amount: monthlyLimitUsd,
          unit: 'USD',
        },
      },
      notificationsWithSubscribers: props.alertEmail
        ? [
            {
              notification: {
                notificationType: 'ACTUAL',
                comparisonOperator: 'GREATER_THAN',
                threshold: 80,
                thresholdType: 'PERCENTAGE',
              },
              subscribers: [{ subscriptionType: 'EMAIL', address: props.alertEmail }],
            },
            {
              notification: {
                notificationType: 'ACTUAL',
                comparisonOperator: 'GREATER_THAN',
                threshold: 100,
                thresholdType: 'PERCENTAGE',
              },
              subscribers: [{ subscriptionType: 'EMAIL', address: props.alertEmail }],
            },
          ]
        : undefined,
    });
  }
}
