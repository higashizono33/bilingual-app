interface LineChartProps<T> {
  data: T[];
  /** グラフに使う数値フィールド。nullの点は0として描画する */
  field: keyof T;
  color: string;
  unit?: string;
  dotColor?: (row: T) => string;
}

/**
 * ダッシュボードの推移グラフ(要件定義書5.4章)。依存ライブラリなしのシンプルなSVG折れ線グラフ。
 * プロトタイプ(docs/prototype.html)のbuildLineChart()をReactコンポーネント化したもの。
 */
export function LineChart<T extends Record<string, unknown>>({
  data,
  field,
  color,
  unit = '',
  dotColor,
}: LineChartProps<T>) {
  const w = 640;
  const h = 170;
  const pad = 32;
  const values = data.map((row) => Number(row[field]) || 0);
  const max = Math.max(5, ...values);
  const steps = 4;

  function pointXY(value: number, i: number): [number, number] {
    const x = pad + (i / Math.max(data.length - 1, 1)) * (w - pad - 20);
    const y = h - pad - (value / max) * (h - pad * 2);
    return [x, y];
  }

  if (data.length === 0) {
    return (
      <div className="chart-empty">まだ記録がありません。今日の記録をはじめましょう。</div>
    );
  }

  const points = values.map((v, i) => pointXY(v, i));

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" className="line-chart">
      {Array.from({ length: steps + 1 }, (_, i) => {
        const v = Math.round((max / steps) * i);
        const y = h - pad - (v / max) * (h - pad * 2);
        return (
          <g key={i}>
            <line x1={pad} x2={w - 10} y1={y} y2={y} stroke="#eceff1" />
            <text x={4} y={y + 4} fontSize={10} fill="#9aa5b1">
              {v}
              {unit}
            </text>
          </g>
        );
      })}
      <polyline
        points={points.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
      />
      {data.map((row, i) => {
        const [x, y] = points[i];
        return <circle key={i} cx={x} cy={y} r={4} fill={dotColor ? dotColor(row) : color} />;
      })}
    </svg>
  );
}
