"use client";

import { ListTextFilter, NoMatches, useTextFilter } from "@/components/list-text-filter";
import { ProjectCard, type ProjectCardData } from "./project-card";

/**
 * The `/projects` card grid with its text filter (surface-polish P-12g). The
 * cards arrive already clearance-scoped from the server page; this component
 * only narrows what is on screen.
 */
export function ProjectList({ projects }: { projects: ProjectCardData[] }) {
  const { query, setQuery, matches } = useTextFilter();
  const visible = projects.filter((p) => matches(`${p.name} ${p.clearance.join(" ")}`));

  return (
    <div className="flex flex-col gap-4">
      <ListTextFilter label="Filter projects" placeholder="Filter projects" value={query} onChange={setQuery} />
      {visible.length === 0 ? (
        <NoMatches noun="projects" />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {visible.map((p) => (
            <li key={p.id}>
              <ProjectCard
                id={p.id}
                name={p.name}
                clearance={p.clearance}
                threadCount={p.threadCount}
                taskCount={p.taskCount}
                lastActivity={p.lastActivity}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
