import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { basemap } from "./basemap";

// Confidence colours (match the legend in App).
const HIGH = "#16a34a";
const MEDIUM = "#f59e0b";
const ACCENT = "#2563eb";

type Props = {
  onSelect: (id: number) => void;
  communities: GeoJSON.FeatureCollection | null;
  communityId: number | null;
};

// Lock the viewport to Ukraine: maxBounds stops panning away, minZoom stops
// zooming out to the rest of the world.
const UKRAINE_BOUNDS: maplibregl.LngLatBoundsLike = [
  [21.0, 43.5],
  [41.5, 53.2],
];
const CENTER: [number, number] = [31.2, 48.5];

// Bounding box of any Polygon/MultiPolygon geometry, for fitBounds().
function geomBounds(geom: GeoJSON.Geometry): maplibregl.LngLatBounds {
  const b = new maplibregl.LngLatBounds();
  const walk = (coords: unknown): void => {
    if (Array.isArray(coords) && typeof coords[0] === "number") {
      b.extend(coords as [number, number]);
    } else if (Array.isArray(coords)) {
      coords.forEach(walk);
    }
  };
  if ("coordinates" in geom) walk((geom as { coordinates: unknown }).coordinates);
  return b;
}

export default function MapView({ onSelect, communities, communityId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // --- create the map once -------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: basemap,
      center: CENTER,
      zoom: 5.4,
      minZoom: 4.8,
      maxZoom: 18,
      maxBounds: UKRAINE_BOUNDS,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "bottom-right");

    map.on("load", () => {
      // Facilities: every accepted point as a small dot (no clustering) so the
      // spatial distribution is visible from the country view.
      map.addSource("facilities", { type: "geojson", data: "/api/facilities" });
      map.addLayer({
        id: "facility-point",
        type: "circle",
        source: "facilities",
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            5, 2.2, 8, 3.5, 12, 5.5, 16, 8,
          ],
          "circle-color": [
            "match", ["get", "confidence"],
            "high", HIGH, "medium", MEDIUM, "#888",
          ],
          "circle-opacity": 0.82,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": [
            "interpolate", ["linear"], ["zoom"], 5, 0.3, 10, 1,
          ],
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

  // --- add community borders once the data arrives -------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !communities) return;
    if (map.getSource("communities")) return; // already added

    map.addSource("communities", { type: "geojson", data: communities });

    // Keep all border/highlight layers BENEATH the dots (beforeId).
    map.addLayer(
      {
        id: "community-border",
        type: "line",
        source: "communities",
        paint: {
          "line-color": "#64748b",
          "line-opacity": 0.3,
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.4, 10, 1],
        },
      },
      "facility-point"
    );
    map.addLayer(
      {
        id: "community-selected-fill",
        type: "fill",
        source: "communities",
        filter: ["==", ["get", "id"], -1],
        paint: { "fill-color": ACCENT, "fill-opacity": 0.07 },
      },
      "facility-point"
    );
    map.addLayer(
      {
        id: "community-selected-line",
        type: "line",
        source: "communities",
        filter: ["==", ["get", "id"], -1],
        paint: { "line-color": ACCENT, "line-width": 2.5, "line-opacity": 0.9 },
      },
      "facility-point"
    );
  }, [ready, communities]);

  // --- react to the selected community ------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    // Filter the dots to the selected community (or show all).
    if (map.getLayer("facility-point")) {
      map.setFilter(
        "facility-point",
        communityId == null
          ? null
          : ["==", ["get", "community_id"], communityId]
      );
    }
    // Highlight the selected border.
    const hl: maplibregl.FilterSpecification =
      communityId == null
        ? ["==", ["get", "id"], -1]
        : ["==", ["get", "id"], communityId];
    if (map.getLayer("community-selected-fill"))
      map.setFilter("community-selected-fill", hl);
    if (map.getLayer("community-selected-line"))
      map.setFilter("community-selected-line", hl);

    // Zoom to the selection (or back out to the whole country).
    if (communityId == null) {
      map.fitBounds(UKRAINE_BOUNDS, { padding: 20, duration: 600 });
      return;
    }
    const feat = communities?.features.find(
      (f) => (f.properties?.id as number) === communityId
    );
    if (feat?.geometry) {
      const b = geomBounds(feat.geometry);
      if (!b.isEmpty()) map.fitBounds(b, { padding: 60, duration: 700, maxZoom: 12 });
    }
  }, [ready, communityId, communities]);

  return <div id="map" ref={containerRef} />;
}
