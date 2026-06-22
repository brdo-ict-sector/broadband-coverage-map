// All requests go to the same-origin "/api" path (Caddy proxy in prod, Vite
// proxy in dev), so no base URL or CORS handling is needed in the client.
export type FacilityDetail = Record<string, unknown> & {
  facility_id: number;
  confidence: string;
};

export async function fetchFacilities(): Promise<GeoJSON.FeatureCollection> {
  const res = await fetch("/api/facilities");
  if (!res.ok) throw new Error(`facilities: ${res.status}`);
  return res.json();
}

export async function fetchFacility(id: number): Promise<FacilityDetail> {
  const res = await fetch(`/api/facilities/${id}`);
  if (!res.ok) throw new Error(`facility ${id}: ${res.status}`);
  return res.json();
}

export async function fetchCommunities(): Promise<GeoJSON.FeatureCollection> {
  const res = await fetch("/api/communities");
  if (!res.ok) throw new Error(`communities: ${res.status}`);
  return res.json();
}
