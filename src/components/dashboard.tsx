"use client";
import { Tooltip } from "./tooltip";
import {
  Suspense,
  useEffect,
  useEffectEvent,
  useState,
  useMemo,
  useRef,
  type FormEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { LanguageSwitcher } from "./language-switcher";
import Link from "next/link";
import {
  Plus,
  LayoutGrid,
  Archive,
  Search,
  ArrowUpRight,
  Globe,
  FileText,
  MessageCircle,
  LogOut,
  ArrowRight,
  Upload,
  Link2,
  Sparkles,
  BookOpen,
  Copy,
  Check,
} from "lucide-react";
import type { Project, User, Workspace } from "../../shared/types";
import { api, relativeDate } from "@/lib/client";
import { Logo, Avatar, Modal, Spinner, ErrorBanner, OpenSourceFooter } from "./ui";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { ProjectCover } from "./project-cover";

export function CreateProject({
  workspaceId,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  onClose: () => void;
  onCreated: (p: Project) => void;
}) {
  const t = useTranslations("dashboard");
  const [type, setType] = useState<"website" | "pdf">("website");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const controller = new AbortController();
    request.current = controller;
    try {
      let body: FormData | string;
      if (type === "pdf") {
        if (!file) throw new Error(t("choosePdf"));
        if (file.size > 20 * 1024 * 1024) throw new Error(t("pdfTooLarge"));
        body = new FormData();
        body.set("name", name);
        body.set("type", type);
        body.set("file", file);
      } else {
        const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
        body = JSON.stringify({ name, type, url: normalized });
      }
      const { project } = await api<{ project: Project }>(
        `/api/projects?workspaceId=${workspaceId}`,
        {
          method: "POST",
          body,
          signal: controller.signal,
        },
      );
      if (!controller.signal.aborted) onCreated(project);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : t("createError"));
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }
  return (
    <Modal title={t("newProjectTitle")} onClose={onClose}>
      <div className="project-type-switch">
        <button className={type === "website" ? "selected" : ""} onClick={() => setType("website")}>
          <Globe size={21} />
          <strong>{t("website")} </strong>
          <span>{t("websiteHint")} </span>
        </button>
        <button className={type === "pdf" ? "selected" : ""} onClick={() => setType("pdf")}>
          <FileText size={21} />
          <strong>{t("pdf")} </strong>
          <span>{t("pdfHint")} </span>
        </button>
      </div>
      <form onSubmit={submit}>
        <label htmlFor="project-name">{t("projectName")} </label>
        <input
          id="project-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("projectPlaceholder")}
          maxLength={120}
          required
          autoFocus
        />
        {type === "website" ? (
          <>
            <label htmlFor="project-url">{t("websiteUrl")} </label>
            <div className="input-with-icon">
              <Link2 size={17} />
              <input
                id="project-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t("urlPlaceholder")}
                required
              />
            </div>
          </>
        ) : (
          <>
            <label htmlFor="project-file">{t("document")} </label>
            <label className="file-drop" htmlFor="project-file">
              <Upload size={26} />
              <strong>{file ? file.name : t("chooseFile")}</strong>
              <span>{t("fileHelp")} </span>
              <input
                id="project-file"
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => {
                  const next = e.target.files?.[0] || null;
                  setFile(next);
                  if (next && !name) setName(next.name.replace(/\.pdf$/i, ""));
                }}
                required
              />
            </label>
          </>
        )}
        <ErrorBanner message={error} />
        <div className="modal-footer">
          <button className="button secondary" type="button" onClick={onClose}>
            {t("cancel")}
          </button>
          <button className="button primary" disabled={pending}>
            {pending ? (
              <Spinner label={t("creating")} />
            ) : (
              <>
                {t("createProject")}
                <ArrowRight size={17} />
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function Dashboard() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardEntry />
    </Suspense>
  );
}

function DashboardLoading() {
  const t = useTranslations("dashboard");
  return (
    <main className="center-page">
      <Logo />
      <Spinner label={t("loading")} />
    </main>
  );
}

function DashboardEntry() {
  const t = useTranslations("dashboard");
  const router = useRouter();
  const search = useSearchParams();
  const [account, setAccount] = useState<{
    user: User;
    workspaces: Workspace[];
    preferred: string | null;
  } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [focusSwitcher, setFocusSwitcher] = useState(false);
  const loadFailure = useEffectEvent(() => t("loadError"));
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const { user } = await api<{ user: User | null }>("/api/auth/me", {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (!user) {
          router.replace("/login");
          return;
        }
        const { workspaces } = await api<{ workspaces: Workspace[] }>("/api/workspaces", {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (!workspaces.length) throw new Error(loadFailure());
        let preferred: string | null = null;
        try {
          preferred = localStorage.getItem(`repere.workspace.v1:${user.id}`);
        } catch {
          /* Storage can be disabled. The URL still remembers the workspace. */
        }
        setAccount({ user, workspaces, preferred });
      } catch (error) {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : loadFailure());
      }
    }
    void load();
    return () => controller.abort();
  }, [router, retry]);

  const requested = search.get("workspace");
  const workspace =
    account?.workspaces.find((item) => item.id === requested) ??
    account?.workspaces.find((item) => item.id === account.preferred) ??
    account?.workspaces[0];
  const workspaceId = workspace?.id;
  const userId = account?.user.id;
  useEffect(() => {
    if (!workspaceId || !userId) return;
    const next = new URL(window.location.href);
    if (next.searchParams.get("workspace") !== workspaceId) {
      next.searchParams.set("workspace", workspaceId);
      window.history.replaceState(null, "", `${next.pathname}${next.search}${next.hash}`);
    }
    try {
      localStorage.setItem(`repere.workspace.v1:${userId}`, workspaceId);
    } catch {
      /* Optional preference only. */
    }
  }, [workspaceId, userId, requested]);

  function select(nextWorkspace: Workspace) {
    setFocusSwitcher(true);
    setAccount((current) => (current ? { ...current, preferred: nextWorkspace.id } : current));
    const next = new URL(window.location.href);
    next.searchParams.set("workspace", nextWorkspace.id);
    window.history.pushState(null, "", `${next.pathname}${next.search}${next.hash}`);
  }
  if (!account || !workspace) {
    if (!error) return <DashboardLoading />;
    return (
      <main className="center-page workspace-bootstrap-error">
        <Logo />
        <ErrorBanner message={error} />
        <button
          className="button primary"
          onClick={() => {
            setError("");
            setRetry((value) => value + 1);
          }}
        >
          {t("retry")}
        </button>
      </main>
    );
  }
  return (
    <WorkspaceDashboard
      key={workspace.id}
      user={account.user}
      workspace={workspace}
      workspaces={account.workspaces}
      onSelectWorkspace={select}
      focusSwitcher={focusSwitcher}
      onCreatedWorkspace={(created) => {
        setAccount((current) =>
          current ? { ...current, workspaces: [...current.workspaces, created] } : current,
        );
        select(created);
      }}
    />
  );
}

function WorkspaceDashboard({
  user,
  workspace,
  workspaces,
  onSelectWorkspace,
  onCreatedWorkspace,
  focusSwitcher,
}: {
  user: User;
  workspace: Workspace;
  workspaces: Workspace[];
  onSelectWorkspace: (workspace: Workspace) => void;
  onCreatedWorkspace: (workspace: Workspace) => void;
  focusSwitcher: boolean;
}) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(false);
  const [help, setHelp] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"active" | "archived">("active");
  const [filter, setFilter] = useState("all");
  const [demoPending, setDemoPending] = useState(false);
  const [copiedId, setCopiedId] = useState("");
  const demoRequest = useRef<AbortController | null>(null);
  const loadFailure = useEffectEvent(() => t("loadError"));
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const data = await api<{ projects: Project[] }>(
          `/api/projects?workspaceId=${workspace.id}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) setProjects(data.projects);
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : loadFailure());
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => {
      controller.abort();
      demoRequest.current?.abort();
    };
  }, [workspace.id]);
  const activeProjects = projects.filter((p) => !p.archived);
  const openCount = activeProjects.reduce((sum, p) => sum + p.commentCount - p.resolvedCount, 0);
  const resolvedCount = activeProjects.reduce((sum, p) => sum + p.resolvedCount, 0);
  const filtered = useMemo(
    () =>
      projects.filter(
        (p) =>
          p.archived === (view === "archived") &&
          (filter === "all" || p.type === filter) &&
          p.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [projects, view, filter, query],
  );
  async function demo() {
    setDemoPending(true);
    setError("");
    const controller = new AbortController();
    demoRequest.current = controller;
    try {
      const { project } = await api<{ project: Project }>(
        `/api/projects?workspaceId=${workspace.id}`,
        {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({
            name: t("demoName"),
            type: "website",
            url: `${window.location.origin}/demo-site`,
          }),
        },
      );
      if (!controller.signal.aborted) router.push(`/r/${project.shareToken}`);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : t("createError"));
    } finally {
      if (!controller.signal.aborted) setDemoPending(false);
    }
  }
  return (
    <div className="dashboard-layout">
      <aside className="sidebar">
        <Logo />
        <WorkspaceSwitcher
          workspace={workspace}
          workspaces={workspaces}
          currentUserId={user.id}
          onSelect={onSelectWorkspace}
          onCreated={onCreatedWorkspace}
          autoFocus={focusSwitcher}
        />
        <nav aria-label={t("navigation")}>
          <button
            className={view === "active" ? "nav-item active" : "nav-item"}
            onClick={() => setView("active")}
          >
            <LayoutGrid size={18} />
            {t("projects")}
            <span className="nav-count">{activeProjects.length}</span>
          </button>
          <button
            className={view === "archived" ? "nav-item active" : "nav-item"}
            onClick={() => setView("archived")}
          >
            <Archive size={18} />
            {t("archives")}
            <span className="nav-count">{projects.length - activeProjects.length}</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setHelp(true)}>
            <BookOpen size={17} />
            {t("guide")}
          </button>
          <div className="sidebar-user">
            <Avatar name={user.name} />
            <div>
              <strong>{user.name}</strong>
              <Tooltip content={user.email} asChild>
                <span>{user.email}</span>
              </Tooltip>
            </div>
            <button
              className="icon-button"
              aria-label={t("signOut")}
              onClick={async () => {
                try {
                  await api("/api/auth/logout", { method: "POST" });
                  router.replace("/login");
                } catch (e) {
                  setError(e instanceof Error ? e.message : t("logoutError"));
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="dashboard-main">
        <main className="dashboard-content">
          <div className="page-heading">
            <div>
              <h1>{view === "active" ? t("projects") : t("archives")}</h1>
            </div>
            <div className="page-actions">
              <LanguageSwitcher />
              <button className="button primary" onClick={() => setModal(true)}>
                <Plus size={18} />
                {t("newProject")}
              </button>
            </div>
          </div>
          <div className="project-summary" aria-label={t("summaryLabel")}>
            <span>{t("activeCount", { count: activeProjects.length })}</span>
            <span>{t("openCount", { count: openCount })}</span>
            {resolvedCount > 0 && <span>{t("resolvedCount", { count: resolvedCount })}</span>}
          </div>
          <div className="project-toolbar">
            <div className="filter-tabs" aria-label={t("projectType")}>
              <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
                {t("allProjects")}
                <span>{projects.filter((p) => p.archived === (view === "archived")).length}</span>
              </button>
              <button
                className={filter === "website" ? "active" : ""}
                onClick={() => setFilter("website")}
              >
                <Globe size={15} />
                {t("websites")}
              </button>
              <button className={filter === "pdf" ? "active" : ""} onClick={() => setFilter("pdf")}>
                <FileText size={15} />
                PDF
              </button>
            </div>
            <div className="search-input">
              <Search size={16} />
              <input
                aria-label={t("search")}
                placeholder={t("searchPlaceholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <ErrorBanner message={error} />
          {loading ? (
            <div className="workspace-projects-loading" role="status">
              <Spinner label={t("loading")} />
            </div>
          ) : filtered.length ? (
            <div className="project-grid">
              {filtered.map((project, index) => (
                <article
                  className="project-card"
                  key={project.id}
                  style={{ animationDelay: `${index * 45}ms` }}
                >
                  <Link
                    href={`/r/${project.shareToken}`}
                    className={`project-preview preview-${project.type} preview-color-${index % 4}`}
                    aria-label={t("openProject", { name: project.name })}
                  >
                    <span className="project-type-badge">
                      {project.type === "website" ? <Globe size={12} /> : <FileText size={12} />}
                      {project.type === "website" ? t("websiteBadge") : t("pdf")}
                    </span>
                    <ProjectCover project={project} />
                    <span className="preview-open">
                      <ArrowUpRight size={21} />
                    </span>
                  </Link>
                  <div className="project-card-info">
                    <div className="project-title-row">
                      <Link href={`/r/${project.shareToken}`}>
                        <h2>{project.name}</h2>
                      </Link>
                      <button
                        className="icon-button"
                        aria-label={t("copyProjectLink", { name: project.name })}
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              `${window.location.origin}/r/${project.shareToken}`,
                            );
                            setCopiedId(project.id);
                            setTimeout(() => setCopiedId(""), 2000);
                          } catch {
                            setError(t("copyError"));
                          }
                        }}
                      >
                        {copiedId === project.id ? <Check size={16} /> : <Copy size={16} />}
                      </button>
                    </div>
                    <div className="project-card-footer">
                      <span
                        className={
                          project.commentCount - project.resolvedCount
                            ? "feedback-count"
                            : "feedback-count muted"
                        }
                      >
                        <MessageCircle size={14} />
                        {t("pendingComments", {
                          count: project.commentCount - project.resolvedCount,
                        })}
                      </span>
                      {project.resolvedCount > 0 && (
                        <span className="resolved-count">
                          <Check size={13} />
                          {project.resolvedCount}
                        </span>
                      )}
                      <span className="project-date">
                        {relativeDate(project.updatedAt, locale)}
                      </span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="projects-empty">
              <div className="empty-illustration">
                <div className="empty-sheet">
                  <span />
                  <span />
                  <span />
                </div>
                <span className="empty-pin">1</span>
                <MessageCircle size={21} />
              </div>
              <h2>
                {query
                  ? t("searchEmpty")
                  : view === "archived"
                    ? t("archiveEmpty")
                    : filter !== "all"
                      ? t("filterEmpty")
                      : t("empty")}
              </h2>
              <p>{query ? t("searchEmptyHelp") : t("emptyHelp")}</p>
              <button className="button primary" onClick={() => setModal(true)}>
                <Plus size={17} />
                {t("addProject")}
              </button>
              {!query && view === "active" && (
                <button className="text-button demo-button" disabled={demoPending} onClick={demo}>
                  {demoPending ? (
                    <Spinner label={t("preparing")} />
                  ) : (
                    <>
                      <Sparkles size={15} />
                      {t("tryExample")}
                      <ArrowRight size={14} />
                    </>
                  )}
                </button>
              )}
            </div>
          )}
          <footer className="dashboard-footer">
            <OpenSourceFooter />
          </footer>
        </main>
      </div>
      {modal && (
        <CreateProject
          workspaceId={workspace.id}
          onClose={() => setModal(false)}
          onCreated={(p) => router.push(`/r/${p.shareToken}`)}
        />
      )}
      {help && (
        <Modal title={t("guideTitle")} onClose={() => setHelp(false)}>
          <div className="guide-steps">
            <div>
              <b>01</b>
              <section>
                <h3>{t("guideAddTitle")} </h3>
                <p>{t("guideAdd")} </p>
              </section>
            </div>
            <div>
              <b>02</b>
              <section>
                <h3>{t("guideShareTitle")} </h3>
                <p>{t("guideShare")}</p>
              </section>
            </div>
            <div>
              <b>03</b>
              <section>
                <h3>{t("guideCommentTitle")} </h3>
                <p>{t("guideComment")}</p>
              </section>
            </div>
          </div>
          <button
            className="button primary full"
            onClick={() => {
              setHelp(false);
              setModal(true);
            }}
          >
            {t("addProject")}
            <ArrowRight size={16} />
          </button>
        </Modal>
      )}
    </div>
  );
}
