import { useState } from "react";

interface CatalogRefreshButtonProps {
  label: string;
  noun: string;
  onRefresh: () => Promise<number>;
}

export function CatalogRefreshButton({
  label,
  noun,
  onRefresh,
}: CatalogRefreshButtonProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setStatus(null);
    setFailed(false);
    try {
      const count = await onRefresh();
      setStatus(`${count} ${noun}${count === 1 ? "" : "s"} found`);
    } catch (error) {
      setFailed(true);
      setStatus(error instanceof Error ? error.message : `${label} failed.`);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="catalog-refresh">
      <button type="button" disabled={refreshing} onClick={() => void refresh()}>
        {refreshing ? "Refreshing…" : label}
      </button>
      {status && (
        <small role={failed ? "alert" : "status"}>{status}</small>
      )}
    </div>
  );
}
