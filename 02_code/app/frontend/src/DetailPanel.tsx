import { useEffect, useState } from "react";
import { fetchFacility, type FacilityDetail } from "./api";

type Props = {
  facilityId: number;
  onClose: () => void;
};

// The NSZU schema is whatever the source xlsx had, so we render generically but
// tuned: surface the useful fields first and hide internal IDs / code columns
// (and lat/lng, which the map already conveys).
const PRIORITY = [
  "division_name",
  "division_type",
  "legal_entity_name",
  "care_type",
  "property_type",
  "residence_region",
  "residence_settlement",
  "address",
  "division_phone",
  "legal_entity_phone",
  "legal_entity_website",
  "email",
];
const HIDE = new Set([
  "legal_entity_id",
  "division_id",
  "edr_role",
  "edr_founders",
  "spromozhna_merezha_role",
  "registration_settlement_koatuu",
  "registration_gromada_koatuu",
  "residence_gromada_koatuu",
  "residence_settlement_koatuu",
  "location",
  "lat",
  "lng",
]);

// Friendlier labels for the few keys worth renaming; others fall back to the
// de-underscored column name.
const LABELS: Record<string, string> = {
  legal_entity_name: "Юридична особа",
  legal_entity_edrpou: "ЄДРПОУ",
  legal_entity_phone: "Телефон (ЮО)",
  legal_entity_website: "Сайт",
  division_type: "Тип підрозділу",
  division_phone: "Телефон",
  care_type: "Тип допомоги",
  property_type: "Форма власності",
  residence_region: "Область",
  residence_settlement: "Населений пункт",
  address: "Адреса",
  confidence: "Достовірність",
  distance_m: "Відстань, м",
  build_id: "BUILD_ID",
  katottg: "КАТОТТГ",
};

function pretty(key: string): string {
  return LABELS[key] ?? key.replace(/_/g, " ");
}

export default function DetailPanel({ facilityId, onClose }: Props) {
  const [data, setData] = useState<FacilityDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    fetchFacility(facilityId)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [facilityId]);

  const entries = data
    ? Object.entries(data).filter(
        ([k, v]) =>
          v != null && v !== "" && k !== "facility_id" && !HIDE.has(k)
      )
    : [];
  entries.sort((a, b) => {
    const ia = PRIORITY.indexOf(a[0]);
    const ib = PRIORITY.indexOf(b[0]);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  const confidence = data?.confidence as string | undefined;

  return (
    <aside className="panel">
      <button className="close" onClick={onClose} aria-label="Закрити">
        ×
      </button>
      {error && <p>Не вдалося завантажити: {error}</p>}
      {!data && !error && <p>Завантаження…</p>}
      {data && (
        <>
          <h2>
            {String(
              data.division_name ??
                data.legal_entity_name ??
                `Заклад #${facilityId}`
            )}
          </h2>
          {confidence && (
            <p>
              <span className={`badge ${confidence}`}>{confidence}</span>
            </p>
          )}
          <table>
            <tbody>
              {entries.map(([k, v]) => (
                <tr key={k}>
                  <td className="key">{pretty(k)}</td>
                  <td>{String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </aside>
  );
}
