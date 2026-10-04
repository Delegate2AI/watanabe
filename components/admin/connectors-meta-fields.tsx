import { inputClass } from "./access-ui";
import { CONNECTOR_ICONS, type ConnectorIcon } from "@/lib/connectors/types";

export type { ConnectorIcon };

const labelClass = "block text-xs font-semibold uppercase tracking-wide text-ink-faint";

export function ConnectorMetaFields({
  description,
  icon,
  onDescriptionChange,
  onIconChange,
}: {
  description: string;
  icon: ConnectorIcon | "";
  onDescriptionChange: (value: string) => void;
  onIconChange: (value: ConnectorIcon | "") => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1">
        <span className={labelClass}>Description</span>
        <input
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          maxLength={280}
          className={inputClass}
          placeholder="Track issues and pull requests."
        />
      </label>
      <label className="grid gap-1">
        <span className={labelClass}>Icon</span>
        <select value={icon} onChange={(e) => onIconChange(e.target.value as ConnectorIcon | "")} className={inputClass}>
          <option value="">No icon</option>
          {CONNECTOR_ICONS.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
