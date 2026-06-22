import { useEffect, useState } from "react";
import MapView from "./MapView";
import DetailPanel from "./DetailPanel";
import CommunityFilter from "./CommunityFilter";
import { fetchCommunities } from "./api";

export default function App() {
  const [selected, setSelected] = useState<number | null>(null);
  const [communities, setCommunities] =
    useState<GeoJSON.FeatureCollection | null>(null);
  const [communityId, setCommunityId] = useState<number | null>(null);

  useEffect(() => {
    fetchCommunities()
      .then(setCommunities)
      .catch((e) => console.error("communities:", e));
  }, []);

  return (
    <>
      <MapView
        onSelect={setSelected}
        communities={communities}
        communityId={communityId}
      />

      <div className="controls">
        <h1>Покриття закладів</h1>

        <CommunityFilter
          communities={communities}
          value={communityId}
          onChange={setCommunityId}
        />

        <div className="legend-rows">
          <div>
            <span className="swatch" style={{ background: "#16a34a" }} />
            Точне співпадіння (high)
          </div>
          <div>
            <span className="swatch" style={{ background: "#f59e0b" }} />
            Найближча будівля ≤ 25 м (medium)
          </div>
        </div>
      </div>

      {selected != null && (
        <DetailPanel facilityId={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
