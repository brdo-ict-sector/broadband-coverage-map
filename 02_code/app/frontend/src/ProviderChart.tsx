import { useMemo, useState } from "react";
import { providerKey, type FacilityFeature } from "./api";

type Props = {
  features: FacilityFeature[];
  activeProvider: string;
  onSelectProvider: (key: string) => void;
};

type Row = { key: string; edrpou: string; name: string; count: number };

type Tip = { x: number; y: number; row: Row };

const TOP_N = 20;

export default function ProviderChart({
  features,
  activeProvider,
  onSelectProvider,
}: Props) {
  const [tip, setTip] = useState<Tip | null>(null);

  // Facilities covered per provider, over the CURRENT filter selection.
  // Providers are identified by providerKey (EDRPOU, or name for masked-EDRPOU
  // ФОПи); a facility counts once per provider even if it paid twice.
  const { rows, activeName } = useMemo(() => {
    const acc = new Map<string, Row>();
    for (const f of features) {
      const seen = new Set<string>();
      for (const p of f.properties.providers ?? []) {
        if (!p.edrpou) continue;
        const key = providerKey(p);
        if (seen.has(key)) continue;
        seen.add(key);
        const row = acc.get(key);
        if (row) row.count++;
        else acc.set(key, { key, edrpou: p.edrpou, name: p.name ?? p.edrpou, count: 1 });
      }
    }
    const sorted = [...acc.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name, "uk")
    );
    const active = activeProvider
      ? sorted.find(
          (r) => r.key === activeProvider || r.edrpou.includes(activeProvider)
        )
      : undefined;
    return { rows: sorted.slice(0, TOP_N), activeName: active?.name ?? null };
  }, [features, activeProvider]);

  const max = rows[0]?.count ?? 1;

  return (
    <section className="card chart-card">
      <div className="chart-titles">
        <h2>Топ-20 провайдерів за кількістю покритих закладів</h2>
        <span className="chart-hint">
          натисніть рядок, щоб відфільтрувати мапу
        </span>
      </div>
      {activeProvider && (
        <p className="chart-active">
          Активний фільтр: <strong>{activeName ?? activeProvider}</strong>
        </p>
      )}
      {rows.length === 0 ? (
        <p className="muted">У поточній вибірці немає платежів за Інтернет.</p>
      ) : (
        <div className="chart" onMouseLeave={() => setTip(null)}>
          {rows.map((r) => (
            <button
              key={r.key}
              type="button"
              className={
                "chart-row" + (activeProvider === r.key ? " active" : "")
              }
              onClick={() => onSelectProvider(r.key)}
              onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, row: r })}
              onMouseLeave={() => setTip(null)}
            >
              <span className="chart-label" title={r.name}>
                {r.name}
              </span>
              <span className="chart-track">
                <span
                  className="chart-bar"
                  style={{ width: `${(r.count / max) * 100}%` }}
                />
              </span>
              <span className="chart-value">{r.count.toLocaleString("uk")}</span>
            </button>
          ))}
        </div>
      )}
      {tip && (
        <div
          className="chart-tip"
          style={{ left: tip.x + 12, top: tip.y + 12 }}
        >
          <div className="chart-tip-name">{tip.row.name}</div>
          <div>
            ЄДРПОУ:{" "}
            {/^\d+$/.test(tip.row.edrpou) ? tip.row.edrpou : "приховано (ФОП)"}
          </div>
          <div>Покрито закладів: {tip.row.count}</div>
          <div className="chart-tip-hint">
            Натисніть, щоб показати заклади на мапі
          </div>
        </div>
      )}
    </section>
  );
}
