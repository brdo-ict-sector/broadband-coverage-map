import { useEffect, useMemo, useState } from "react";
import MapView from "./MapView";
import DetailPanel from "./DetailPanel";
import FiltersPanel from "./FiltersPanel";
import ProviderChart from "./ProviderChart";
import { exportFacilitiesCsv } from "./exportCsv";
import {
  fetchFacilities,
  providerKey,
  type FacilityCollection,
  type FacilityFeature,
} from "./api";

export default function App() {
  const [data, setData] = useState<FacilityCollection | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const [oblast, setOblast] = useState<string | null>(null);
  const [hromada, setHromada] = useState<string | null>(null);
  const [settlement, setSettlement] = useState<string | null>(null);
  const [domain, setDomain] = useState<string | null>(null);
  const [facilityEdrpou, setFacilityEdrpou] = useState("");
  const [providerEdrpou, setProviderEdrpou] = useState("");

  useEffect(() => {
    fetchFacilities()
      .then(setData)
      .catch((e) => setLoadError(String(e)));
  }, []);

  // The dataset is one country-sized FeatureCollection (~18k points), so all
  // filtering happens client-side and the map just re-renders the subset.
  const filtered = useMemo<FacilityFeature[]>(() => {
    if (!data) return [];
    const fq = facilityEdrpou.trim();
    const pq = providerEdrpou.trim();
    return data.features.filter((f) => {
      const p = f.properties;
      if (oblast && p.oblast !== oblast) return false;
      if (hromada && p.hromada !== hromada) return false;
      if (settlement && p.settlement !== settlement) return false;
      if (domain && p.domain !== domain) return false;
      if (fq && !(p.edrpou ?? "").includes(fq)) return false;
      // Matches a typed (partial) EDRPOU, or the exact provider key set by a
      // click on the chart (name-based for masked-EDRPOU ФОПи).
      if (
        pq &&
        !(p.providers ?? []).some(
          (pr) => (pr.edrpou ?? "").includes(pq) || providerKey(pr) === pq
        )
      )
        return false;
      return true;
    });
  }, [data, oblast, hromada, settlement, domain, facilityEdrpou, providerEdrpou]);

  const filteredCollection = useMemo<FacilityCollection>(
    () => ({ type: "FeatureCollection", features: filtered }),
    [filtered]
  );

  const hasActiveFilter =
    oblast != null ||
    hromada != null ||
    settlement != null ||
    domain != null ||
    facilityEdrpou.trim() !== "" ||
    providerEdrpou.trim() !== "";

  // Changes whenever the filter combination changes; MapView refits the
  // viewport to the current subset on each change.
  const fitKey = [
    oblast, hromada, settlement, domain,
    facilityEdrpou.trim(), providerEdrpou.trim(),
  ].join(" ");

  const selectOblast = (v: string | null) => {
    setOblast(v);
    setHromada(null);
    setSettlement(null);
  };
  const selectHromada = (v: string | null) => {
    setHromada(v);
    setSettlement(null);
  };
  const resetFilters = () => {
    setOblast(null);
    setHromada(null);
    setSettlement(null);
    setDomain(null);
    setFacilityEdrpou("");
    setProviderEdrpou("");
  };

  return (
    <div className="page">
      <header className="header">
        <div className="header-brand">
          <div>
            <h1>Мапа покриття фіксованим Інтернетом</h1>
            <p className="header-sub">
              Моніторинг статусу підключення соціальних закладів, а також
              покриття населених пунктів фіксованим Інтернетом.
            </p>
          </div>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn-secondary"
            disabled={filtered.length === 0}
            onClick={() => exportFacilitiesCsv(filtered)}
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Експорт CSV
          </button>
        </div>
      </header>

      {loadError && (
        <div className="load-error">Не вдалося завантажити дані: {loadError}</div>
      )}

      <div className="layout">
        <FiltersPanel
          data={data}
          filtered={filtered}
          oblast={oblast}
          hromada={hromada}
          settlement={settlement}
          domain={domain}
          facilityEdrpou={facilityEdrpou}
          providerEdrpou={providerEdrpou}
          hasActiveFilter={hasActiveFilter}
          onOblast={selectOblast}
          onHromada={selectHromada}
          onSettlement={setSettlement}
          onDomain={setDomain}
          onFacilityEdrpou={setFacilityEdrpou}
          onProviderEdrpou={setProviderEdrpou}
          onReset={resetFilters}
        />

        <main className="content">
          <div className="map-box">
            <MapView
              data={filteredCollection}
              fitKey={fitKey}
              hasActiveFilter={hasActiveFilter}
              selectedId={selected}
              onSelect={setSelected}
            />
            {selected != null && (
              <DetailPanel
                facilityId={selected}
                onClose={() => setSelected(null)}
              />
            )}
          </div>

          <ProviderChart
            features={filtered}
            activeProvider={providerEdrpou.trim()}
            onSelectProvider={(key) =>
              setProviderEdrpou((cur) => (cur.trim() === key ? "" : key))
            }
          />
        </main>
      </div>
    </div>
  );
}
