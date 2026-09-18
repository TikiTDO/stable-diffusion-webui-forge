import { useCallback, useEffect, useRef, useState } from "react";

import { ForgeClient } from "../api/forge/client";
import type { Project } from "../api/forge/types";
import type { GenerationResult } from "./generation";

const STORAGE_KEY = "diffusatory.project";

function rememberedProjectId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function rememberProjectId(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // A browser without storage still gets a working session.
  }
}

/**
 * The project that generated images are copied into. `null` means images stay
 * where Forge writes them and nothing else happens.
 */
export function useProject(client: ForgeClient) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectIdState] = useState<string | null>(rememberedProjectId);
  const [notice, setNotice] = useState<string | null>(null);
  const copied = useRef(new Set<string>());

  const reload = useCallback(async () => {
    try {
      const next = await client.projects();
      setProjects(next);
      // A remembered project that no longer exists is forgotten, not an error.
      setProjectIdState((current) =>
        current && !next.some((project) => project.id === current) ? null : current,
      );
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Projects could not be listed.");
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setProjectId = useCallback((id: string | null) => {
    setProjectIdState(id);
    rememberProjectId(id);
    setNotice(null);
  }, []);

  const createProject = useCallback(
    async (name: string) => {
      const project = await client.createProject(name);
      setProjects((current) =>
        [...current, project].sort((a, b) => a.id.localeCompare(b.id)),
      );
      setProjectId(project.id);
      return project;
    },
    [client, setProjectId],
  );

  /** Copies each finished image of one task into the active project, once. */
  const copyResults = useCallback(
    async (taskId: string, results: GenerationResult[]) => {
      if (!projectId || copied.current.has(taskId)) return;
      copied.current.add(taskId);
      const images = results.filter((result) => result.kind === "image");
      let added = 0;
      for (const result of images) {
        try {
          await client.addProjectImage(projectId, result.image);
          added += 1;
        } catch (cause) {
          setNotice(
            cause instanceof Error
              ? cause.message
              : "An image could not be copied to the project.",
          );
        }
      }
      if (added) {
        setProjects((current) =>
          current.map((project) =>
            project.id === projectId
              ? { ...project, image_count: project.image_count + added }
              : project,
          ),
        );
      }
    },
    [client, projectId],
  );

  const project = projects.find((item) => item.id === projectId) ?? null;
  return {
    projects,
    project,
    projectId,
    setProjectId,
    createProject,
    copyResults,
    notice,
    reload,
  };
}
