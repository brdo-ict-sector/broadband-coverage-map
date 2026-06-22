// Basemap: CARTO "Positron" — a clean, light vector style (no API key). Its
// muted palette is a modern look and makes the coloured facility points pop.
// Override with VITE_BASEMAP_URL (e.g. our own PMTiles style) for production.
const CARTO_POSITRON =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

export const basemap =
  (import.meta.env.VITE_BASEMAP_URL as string | undefined) ?? CARTO_POSITRON;
