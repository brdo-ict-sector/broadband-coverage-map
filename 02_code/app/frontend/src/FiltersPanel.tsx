import { useEffect, useMemo, useRef, useState } from "react";
import type { FacilityCollection, FacilityFeature } from "./api";

type Props = {
  data: FacilityCollection | null;
  filtered: FacilityFeature[];
  oblast: string | null;
  hromada: string | null;
  settlement: string | null;
  domain: string | null;
  facilityEdrpou: string;
  providerEdrpou: string;
  hasActiveFilter: boolean;
  onOblast: (v: string | null) => void;
  onHromada: (v: string | null) => void;
  onSettlement: (v: string | null) => void;
  onDomain: (v: string | null) => void;
  onFacilityEdrpou: (v: string) => void;
  onProviderEdrpou: (v: string) => void;
  onReset: () => void;
};

const collator = new Intl.Collator("uk");

function uniqueSorted(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort(
    collator.compare
  );
}

// Count-up on change (design handoff: counters animate 300ms).
function useCountUp(target: number, duration = 300): number {
  const [value, setValue] = useState(target);
  const prevRef = useRef(target);
  useEffect(() => {
    const from = prevRef.current;
    prevRef.current = target;
    if (from === target) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      setValue(Math.round(from + (target - from) * k));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  const shown = useCountUp(value);
  return (
    <div className={accent ? "stat accent" : "stat"}>
      <span className="stat-value">{shown.toLocaleString("uk")}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      className="search-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  value: string | null;
  options: string[];
  onChange: (v: string | null) => void;
  disabled?: boolean;
  placeholder: string;
}) {
  return (
    <label className="filter">
      <span>{label}</span>
      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function FiltersPanel(props: Props) {
  const { data, filtered } = props;
  const features = data?.features;

  const oblasts = useMemo(
    () => uniqueSorted((features ?? []).map((f) => f.properties.oblast)),
    [features]
  );
  const domains = useMemo(
    () => uniqueSorted((features ?? []).map((f) => f.properties.domain)),
    [features]
  );
  const hromadas = useMemo(() => {
    if (!features) return [];
    const src = props.oblast
      ? features.filter((f) => f.properties.oblast === props.oblast)
      : features;
    return uniqueSorted(src.map((f) => f.properties.hromada));
  }, [features, props.oblast]);
  // The full settlement list is ~10k entries — only offer it once the scope is
  // narrowed to an oblast or a hromada.
  const settlements = useMemo(() => {
    if (!features || (!props.oblast && !props.hromada)) return [];
    const src = features.filter(
      (f) =>
        (!props.oblast || f.properties.oblast === props.oblast) &&
        (!props.hromada || f.properties.hromada === props.hromada)
    );
    return uniqueSorted(src.map((f) => f.properties.settlement));
  }, [features, props.oblast, props.hromada]);

  const stats = useMemo(() => {
    const providerIds = new Set<string>();
    // "Платники" are counted by the facility's ЄДРПОУ: branch points (ВРМ,
    // філії) of one legal entity collapse into one payer.
    const payerIds = new Set<string>();
    for (const f of filtered) {
      const provs = f.properties.providers ?? [];
      if (provs.length > 0 && f.properties.edrpou)
        payerIds.add(f.properties.edrpou);
      for (const p of provs) if (p.edrpou) providerIds.add(p.edrpou);
    }
    return { shown: filtered.length, payers: payerIds.size, providers: providerIds.size };
  }, [filtered]);

  return (
    <aside className="sidebar">
      <section className="card">
        <h2>Основні показники</h2>
        <div className="stats-body">
          <StatTile label="Закладів на мапі" value={stats.shown} />
          <StatTile
            label="Платників за послуги доступу (за ЄДРПОУ)"
            value={stats.payers}
            accent
          />
          <StatTile label="Провайдерів" value={stats.providers} />
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          <h2>Фільтри</h2>
          {props.hasActiveFilter && (
            <button type="button" className="link-btn" onClick={props.onReset}>
              Скинути
            </button>
          )}
        </div>

        <div className="filters-body">
          <Select
            label="Область"
            value={props.oblast}
            options={oblasts}
            onChange={props.onOblast}
            disabled={!data}
            placeholder="Усі області"
          />
          <Select
            label="Громада"
            value={props.hromada}
            options={hromadas}
            onChange={props.onHromada}
            disabled={!data}
            placeholder="Усі громади"
          />
          <Select
            label="Населений пункт"
            value={props.settlement}
            options={settlements}
            onChange={props.onSettlement}
            disabled={!data || (!props.oblast && !props.hromada)}
            placeholder={
              props.oblast || props.hromada
                ? "Усі населені пункти"
                : "Спершу оберіть область"
            }
          />
          <Select
            label="Галузь"
            value={props.domain}
            options={domains}
            onChange={props.onDomain}
            disabled={!data}
            placeholder="Усі галузі"
          />

          <div className="filters-divider" />

          <label className="filter">
            <span>ЄДРПОУ закладу</span>
            <input
              type="search"
              inputMode="numeric"
              value={props.facilityEdrpou}
              placeholder="напр. 04328200"
              onChange={(e) => props.onFacilityEdrpou(e.target.value)}
            />
            <SearchIcon />
          </label>
          <label className="filter">
            <span>ЄДРПОУ провайдера</span>
            <input
              type="search"
              inputMode="numeric"
              value={props.providerEdrpou}
              placeholder="напр. 21560766"
              onChange={(e) => props.onProviderEdrpou(e.target.value)}
            />
            <SearchIcon />
          </label>
        </div>
      </section>

      <section className="card">
        <h2>Легенда прив'язки</h2>
        <div className="legend-rows">
          <div>
            <span className="swatch high" />
            Точка в межах будівлі
          </div>
          <div>
            <span className="swatch medium" />≤ 100 м від центру будівлі
          </div>
          <div>
            <span className="swatch none" />
            Без прив'язки до будівлі
          </div>
        </div>
        <p className="legend-note">
          Колір показує точність прив'язки закладу до будівлі.
        </p>
      </section>
    </aside>
  );
}
