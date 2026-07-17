// All requests go to the same-origin "/api" path (Caddy proxy in prod, Vite
// proxy in dev), so no base URL or CORS handling is needed in the client.

export type Provider = { edrpou: string; name: string | null };

// ФОП providers come with a privacy-masked EDRPOU ("xxxxxxxxxx"), so the
// stable identity of a provider is its EDRPOU when real, its name otherwise.
export function providerKey(p: Provider): string {
  return /^\d+$/.test(p.edrpou) ? p.edrpou : p.name ?? p.edrpou;
}

export type FacilityProps = {
  facility_id: number;
  name: string | null;
  domain: string | null;
  oblast: string | null;
  hromada: string | null;
  settlement: string | null;
  edrpou: string | null;
  confidence: "high" | "medium" | null;
  providers: Provider[] | null;
};

export type FacilityFeature = GeoJSON.Feature<GeoJSON.Point, FacilityProps>;

export type FacilityCollection = {
  type: "FeatureCollection";
  features: FacilityFeature[];
};

export type Payment = {
  payer_name: string | null;
  trans_date: string | null;
  currency: string | null;
  recipt_edrpou: string | null;
  recipt_name: string | null;
  amount: string | null;
};

export type FacilityDetail = Record<string, unknown> & {
  facility_id: number;
  payments: Payment[];
};

export async function fetchFacilities(): Promise<FacilityCollection> {
  const res = await fetch("/api/facilities");
  if (!res.ok) throw new Error(`facilities: ${res.status}`);
  return res.json();
}

export async function fetchFacility(id: number): Promise<FacilityDetail> {
  const res = await fetch(`/api/facilities/${id}`);
  if (!res.ok) throw new Error(`facility ${id}: ${res.status}`);
  return res.json();
}
