import type { FacilityFeature } from "./api";

const HEADER = [
  "facility_id",
  "Назва",
  "ЄДРПОУ",
  "Галузь",
  "Область",
  "Громада",
  "Населений пункт",
  "Прив'язка до будівлі",
  "Провайдери (ЄДРПОУ)",
  "Провайдери (назви)",
  "Довгота",
  "Широта",
];

const CONFIDENCE = new Map([
  ["high", "точка в межах будівлі"],
  ["medium", "≤ 100 м від центру будівлі"],
]);

function cell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Semicolon-separated with a BOM: what Excel opens correctly for Cyrillic
// content on a typical Ukrainian-locale Windows install.
export function exportFacilitiesCsv(features: FacilityFeature[]): void {
  const lines = [HEADER.join(";")];
  for (const f of features) {
    const p = f.properties;
    const providers = p.providers ?? [];
    const [lng, lat] = f.geometry.coordinates;
    lines.push(
      [
        p.facility_id,
        p.name,
        p.edrpou,
        p.domain,
        p.oblast,
        p.hromada,
        p.settlement,
        p.confidence ? CONFIDENCE.get(p.confidence) : "без прив'язки",
        providers.map((x) => x.edrpou).join(", "),
        providers.map((x) => x.name ?? "").join(", "),
        lng,
        lat,
      ]
        .map(cell)
        .join(";")
    );
  }
  const blob = new Blob(["﻿" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `zaklady-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
