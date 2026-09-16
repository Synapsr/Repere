"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Check, ChevronsUpDown, Plus, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Workspace } from "../../shared/types";
import { api } from "@/lib/client";
import { ErrorBanner, Modal, Spinner } from "./ui";
import { WorkspaceMembers } from "./workspace-members";
import "./workspace-switcher.css";

export function WorkspaceSwitcher({
  workspace,
  workspaces,
  currentUserId,
  onSelect,
  onCreated,
  autoFocus = false,
}: {
  workspace: Workspace;
  workspaces: Workspace[];
  currentUserId: string;
  onSelect: (workspace: Workspace) => void;
  onCreated: (workspace: Workspace) => void;
  autoFocus?: boolean;
}) {
  const t = useTranslations("dashboard");
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(0);
  const [creating, setCreating] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelectorAll<HTMLButtonElement>("button")[focused]?.focus();
  }, [open, focused]);
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function show() {
    setFocused(
      Math.max(
        0,
        workspaces.findIndex((item) => item.id === workspace.id),
      ),
    );
    setOpen(true);
  }
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  function keyboard(event: KeyboardEvent) {
    const count = workspaces.length + 2;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setFocused((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + count) % count);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setFocused(event.key === "Home" ? 0 : count - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }
  function closeCreation() {
    setCreating(false);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  function closeMembers() {
    setMembersOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  }

  return (
    <div
      className="workspace-switcher"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="workspace-trigger"
        aria-label={t("switchWorkspace")}
        aria-describedby={`${id}-name`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        autoFocus={autoFocus}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show();
          }
        }}
      >
        <span className="workspace-avatar" aria-hidden="true">
          {Array.from(workspace.name)[0]?.toLocaleUpperCase()}
        </span>
        <span className="workspace-name" id={`${id}-name`} title={workspace.name}>
          {workspace.name}
        </span>
        <ChevronsUpDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="workspace-menu"
          id={id}
          role="menu"
          aria-label={t("workspaces")}
          ref={menu}
          onKeyDown={keyboard}
        >
          <div className="workspace-menu-label" role="presentation">
            {t("workspaces")}
          </div>
          <div className="workspace-menu-list" role="presentation">
            {workspaces.map((item, index) => (
              <button
                key={item.id}
                role="menuitemradio"
                aria-checked={item.id === workspace.id}
                tabIndex={focused === index ? 0 : -1}
                onFocus={() => setFocused(index)}
                onClick={() => {
                  close();
                  if (item.id !== workspace.id) onSelect(item);
                }}
              >
                <span>{item.name}</span>
                {item.id === workspace.id && <Check size={16} aria-hidden="true" />}
              </button>
            ))}
          </div>
          <button
            className="workspace-menu-action"
            role="menuitem"
            tabIndex={focused === workspaces.length ? 0 : -1}
            onFocus={() => setFocused(workspaces.length)}
            onClick={() => {
              setOpen(false);
              setMembersOpen(true);
            }}
          >
            <Users size={16} />
            {t("members")}
          </button>
          <button
            className="workspace-create"
            role="menuitem"
            tabIndex={focused === workspaces.length + 1 ? 0 : -1}
            onFocus={() => setFocused(workspaces.length + 1)}
            onClick={() => {
              setOpen(false);
              setCreating(true);
            }}
          >
            <Plus size={16} />
            {t("newWorkspace")}
          </button>
        </div>
      )}
      {creating && <CreateWorkspace onClose={closeCreation} onCreated={onCreated} />}
      {membersOpen && (
        <WorkspaceMembers
          workspace={workspace}
          currentUserId={currentUserId}
          onClose={closeMembers}
        />
      )}
    </div>
  );
}

function CreateWorkspace({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (workspace: Workspace) => void;
}) {
  const t = useTranslations("dashboard");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || pending) return;
    setPending(true);
    setError("");
    const controller = new AbortController();
    request.current = controller;
    try {
      const { workspace } = await api<{ workspace: Workspace }>("/api/workspaces", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
        signal: controller.signal,
      });
      if (!controller.signal.aborted) onCreated(workspace);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : t("workspaceCreateError"));
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }
  return (
    <Modal title={t("newWorkspace")} onClose={onClose}>
      <form onSubmit={submit}>
        <label htmlFor="workspace-name">{t("workspaceName")}</label>
        <input
          id="workspace-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("workspacePlaceholder")}
          maxLength={80}
          autoFocus
          required
        />
        <ErrorBanner message={error} />
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            {t("cancel")}
          </button>
          <button className="button primary" disabled={pending || !name.trim()}>
            {pending ? <Spinner label={t("creating")} /> : t("createWorkspace")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
