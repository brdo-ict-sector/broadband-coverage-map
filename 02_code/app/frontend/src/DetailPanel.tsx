import { Fragment, useEffect, useState } from "react";
import { fetchFacility, type FacilityDetail, type Payment } from "./api";

type Props = {
  facilityId: number;
  onClose: () => void;
};

// Card layout agreed 2026-07-17: fixed field list with Ukrainian labels.
const FACILITY_FIELDS: [string, string][] = [
  ["domain_type", "Галузь"],
  ["specific_type", "Тип"],
  ["name", "Назва"],
  ["edrpou", "ЄДРПОУ"],
  ["oblast", "Область"],
  ["hromada", "Громада"],
  ["settlement", "Населений пункт"],
  ["str_address", "Адреса"],
  ["id_source", "Ідентифікатор закладу"],
  ["edra_id", "Ідентифікатор будівлі"],
  ["katottg_4", "КАТОТТГ"],
];

const PAYMENT_ROWS: [keyof Payment, string][] = [
  ["payer_name", "Платник"],
  ["trans_date", "Дата платежу"],
  ["recipt_edrpou", "ЄДРПОУ надавача"],
  ["currency", "Валюта"],
];

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "Точка в межах будівлі",
  medium: "≤ 100 м від центру будівлі",
};

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

  // Esc dismisses the panel (design handoff).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fieldValue = (key: string): string | null => {
    if (!data) return null;
    // The source edra_id column is empty for now; the spatially matched
    // building id (build_id) stands in for it.
    const v = key === "edra_id" ? data.edra_id ?? data.build_id : data[key];
    return v == null || v === "" ? null : String(v);
  };

  const confidence = (data?.confidence ?? null) as string | null;
  const payments = data?.payments ?? [];

  return (
    <aside className="panel">
      <div className="panel-head">
        <div style={{ flex: 1 }}>
          {data && (
            <span className={`badge ${confidence ?? "none"}`}>
              {confidence
                ? CONFIDENCE_LABEL[confidence] ?? confidence
                : "Без прив'язки до будівлі"}
            </span>
          )}
          <h2>
            {data
              ? String(data.name ?? `Заклад #${facilityId}`)
              : "Завантаження…"}
          </h2>
        </div>
        <button className="panel-close" onClick={onClose} aria-label="Закрити">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="panel-body">
        {error && <p>Не вдалося завантажити: {error}</p>}
        {data && (
          <>
            <h3>Інформація про заклад</h3>
            <dl className="detail-grid">
              {FACILITY_FIELDS.map(([key, label]) => {
                const v = fieldValue(key);
                return v == null ? null : (
                  <Fragment key={key}>
                    <dt>{label}</dt>
                    <dd>{v}</dd>
                  </Fragment>
                );
              })}
            </dl>

            <h3 className="payments-title">
              Оплачений доступ до Інтернету{" "}
              {payments.length > 0 && (
                <span className="count">· {payments.length}</span>
              )}
            </h3>
            {payments.length === 0 && (
              <p className="muted">Немає даних про оплату.</p>
            )}
            <div className="payments">
              {payments.map((p, i) => (
                <div className="payment" key={i}>
                  <div className="payment-head">
                    <div className="payment-provider">
                      {p.recipt_name ?? p.recipt_edrpou ?? "Провайдер"}
                    </div>
                    {p.amount != null && (
                      <div className="payment-sum">{p.amount}</div>
                    )}
                  </div>
                  <div className="payment-grid">
                    {PAYMENT_ROWS.map(([key, label]) =>
                      p[key] == null || p[key] === "" ? null : (
                        <div key={key}>
                          <div className="k">{label}</div>
                          <div className="v">{String(p[key])}</div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
