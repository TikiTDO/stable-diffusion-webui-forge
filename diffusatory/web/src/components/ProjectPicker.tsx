import type { Project } from "../api/forge/types";

interface ProjectPickerProps {
  projects: Project[];
  projectId: string | null;
  notice: string | null;
  onChange: (id: string | null) => void;
  onCreate: (name: string) => Promise<unknown>;
}

const NEW_PROJECT = "+new";

/** Where finished images are copied. "No project" leaves them in Forge's output folder only. */
export function ProjectPicker({
  projects,
  projectId,
  notice,
  onChange,
  onCreate,
}: ProjectPickerProps) {
  const active = projects.find((project) => project.id === projectId) ?? null;
  return (
    <label className="project-picker">
      <span>Project</span>
      <select
        value={projectId ?? ""}
        onChange={(event) => {
          const value = event.target.value;
          if (value === NEW_PROJECT) {
            const name = window.prompt("Project name");
            if (name?.trim()) void onCreate(name.trim());
            return;
          }
          onChange(value || null);
        }}
      >
        <option value="">No project</option>
        {projects.map((project) => (
          <option value={project.id} key={project.id}>
            {project.name}
          </option>
        ))}
        <option value={NEW_PROJECT}>New project...</option>
      </select>
      {active && (
        <small>
          {active.image_count} {active.image_count === 1 ? "image" : "images"} · New results copy here.
        </small>
      )}
      {notice && <small role="alert">{notice}</small>}
    </label>
  );
}
