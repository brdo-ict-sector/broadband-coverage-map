import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { basemap } from "./basemap";
import type { FacilityCollection } from "./api";

// Match-confidence colours: Teal · Vermillion · Slate (mirrored by the
// sidebar legend / CSS custom props).
const HIGH = "#0E9E73";
const MEDIUM = "#E8590C";
const UNMATCHED = "#5A6472";

const COLOR_BY_CONFIDENCE: maplibregl.ExpressionSpecification = [
  "match", ["get", "confidence"],
  "high", HIGH, "medium", MEDIUM, UNMATCHED,
];

type Props = {
  data: FacilityCollection;
  fitKey: string;
  hasActiveFilter: boolean;
  selectedId: number | null;
  onSelect: (id: number) => void;
};

// Lock the viewport to Ukraine: maxBounds stops panning away, minZoom stops
// zooming out to the rest of the world. MAX_BOUNDS is padded past the country
// bounds so fitBounds(UKRAINE_BOUNDS) can fully fit Ukraine (with padding)
// into any box aspect without being clamped mid-animation.
const UKRAINE_BOUNDS: maplibregl.LngLatBoundsLike = [
  [21.0, 43.5],
  [41.5, 53.2],
];
const MAX_BOUNDS: maplibregl.LngLatBoundsLike = [
  [18.5, 42.5],
  [44.0, 54.2],
];
const FIT_PADDING = 24;

const EMPTY: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const NO_SELECTION: maplibregl.FilterSpecification = [
  "==", ["get", "facility_id"], -1,
];

export default function MapView({
  data,
  fitKey,
  hasActiveFilter,
  selectedId,
  onSelect,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const dataRef = useRef(data);
  dataRef.current = data;

  // --- create the map once -------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: basemap,
      bounds: UKRAINE_BOUNDS,
      fitBoundsOptions: { padding: FIT_PADDING },
      minZoom: 4.5,
      maxZoom: 18,
      maxBounds: MAX_BOUNDS,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    // Debug/E2E hook: lets tooling reach the map instance (querySourceFeatures).
    (window as unknown as { __map?: maplibregl.Map }).__map = map;
    map.addControl(new maplibregl.NavigationControl(), "bottom-right");

    map.on("load", () => {
      // Facilities: every point as a small dot (no clustering) so the spatial
      // distribution is visible from the country view.
      map.addSource("facilities", { type: "geojson", data: EMPTY });

      // Selection halo UNDER the dots: a soft colour-matched ring around the
      // clicked facility (design handoff: "enlarged + soft ring").
      map.addLayer({
        id: "facility-selected-halo",
        type: "circle",
        source: "facilities",
        filter: NO_SELECTION,
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            5, 9, 10, 13, 16, 18,
          ],
          "circle-color": COLOR_BY_CONFIDENCE,
          "circle-opacity": 0.25,
        },
      });

      map.addLayer({
        id: "facility-point",
        type: "circle",
        source: "facilities",
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            5, 2.2, 8, 3.5, 12, 5.5, 16, 8,
          ],
          "circle-color": COLOR_BY_CONFIDENCE,
          "circle-opacity": 0.85,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": [
            "interpolate", ["linear"], ["zoom"], 5, 0.4, 10, 1.5,
          ],
        },
      });

      // Selected dot on top, enlarged.
      map.addLayer({
        id: "facility-selected",
        type: "circle",
        source: "facilities",
        filter: NO_SELECTION,
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            5, 5, 10, 7.5, 16, 11,
          ],
          "circle-color": COLOR_BY_CONFIDENCE,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });

      map.on("click", "facility-point", (e) => {
        const id = e.features?.[0]?.properties?.facility_id;
        if (id != null) onSelectRef.current(Number(id));
      });
      map.on("mouseenter", "facility-point", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "facility-point", () => {
        map.getCanvas().style.cursor = "";
      });

      setReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // --- push the (filtered) facilities into the source ----------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("facilities") as maplibregl.GeoJSONSource;
    src?.setData(data as GeoJSON.FeatureCollection);
  }, [ready, data]);

  // --- highlight the selected facility -------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const filter: maplibregl.FilterSpecification =
      selectedId == null
        ? NO_SELECTION
        : ["==", ["get", "facility_id"], selectedId];
    map.setFilter("facility-selected-halo", filter);
    map.setFilter("facility-selected", filter);
  }, [ready, selectedId]);

  // --- refit the viewport when the filter combination changes --------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!hasActiveFilter) {
      map.fitBounds(UKRAINE_BOUNDS, { padding: FIT_PADDING, duration: 600 });
      return;
    }
    const features = dataRef.current.features;
    if (features.length === 0) return;
    const b = new maplibregl.LngLatBounds();
    for (const f of features) {
      b.extend(f.geometry.coordinates as [number, number]);
    }
    if (!b.isEmpty()) {
      map.fitBounds(b, { padding: 60, duration: 700, maxZoom: 13 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fitKey, hasActiveFilter]);

  return <div className="map" ref={containerRef} />;
}
