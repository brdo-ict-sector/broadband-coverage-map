import { useMemo } from "react";

type Props = {
  communities: GeoJSON.FeatureCollection | null;
  value: number | null;
  onChange: (id: number | null) => void;
};

type Item = { id: number; name: string; oblast: string };

// Oblast is the first comma-segment of full_name; used to disambiguate the many
// communities that share a name.
function oblastOf(fullName: unknown): string {
  if (typeof fullName !== "string") return "";
  return fullName.split(",")[0].trim();
}

export default function CommunityFilter({ communities, value, onChange }: Props) {
  const items = useMemo<Item[]>(() => {
    if (!communities) return [];
    return communities.features
      .map((f) => ({
        id: f.properties?.id as number,
        name: (f.properties?.name as string) ?? "—",
        oblast: oblastOf(f.properties?.full_name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "uk"));
  }, [communities]);

  return (
    <label className="filter">
      <span>Громада</span>
      <select
        value={value ?? ""}
        disabled={!communities}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : Number(e.target.value))
        }
      >
        <option value="">Усі громади ({items.length})</option>
        {items.map((it) => (
          <option key={it.id} value={it.id}>
            {it.name}
            {it.oblast ? ` — ${it.oblast}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
