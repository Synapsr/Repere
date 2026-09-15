"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, MessageCircle, MessageCirclePlus, MousePointer2 } from "lucide-react";
import { Modal } from "./ui";
import "./review-onboarding.css";

const storageKey = "repere.review-onboarding.v1";
const listeners = new Set<() => void>();
let dismissedInMemory = false;

function wasDismissed() {
  if (dismissedInMemory) return true;
  try {
    return window.localStorage.getItem(storageKey) === "dismissed";
  } catch {
    return false;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  function changed(event: StorageEvent) {
    if (event.key === storageKey) listener();
  }
  window.addEventListener("storage", changed);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", changed);
  };
}

function dismiss() {
  dismissedInMemory = true;
  try {
    window.localStorage.setItem(storageKey, "dismissed");
  } catch {
    // Private browsing and blocked storage still remember dismissal for this page session.
  }
  for (const listener of listeners) listener();
}

const serverSnapshot = () => true;

/** Auto-open is restricted by Review to authenticated guests reviewing an active website. */
export function ReviewOnboarding({
  autoShow,
  open,
  onClose,
}: {
  autoShow: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("review");
  const seen = useSyncExternalStore(subscribe, wasDismissed, serverSnapshot);
  if (!open && (!autoShow || seen)) return null;
  function close() {
    dismiss();
    onClose();
  }
  return (
    <Modal title={t("onboardingTitle")} onClose={close}>
      <div className="review-onboarding">
        <p className="review-onboarding-intro">{t("onboardingIntro")}</p>
        <div className="review-onboarding-demo" aria-hidden="true">
          <div className="review-onboarding-toolbar">
            <span className="review-onboarding-browse">
              <MousePointer2 size={12} />
              {t("browse")}
            </span>
            <span className="review-onboarding-comment">
              <MessageCirclePlus size={12} />
              {t("comment")}
            </span>
          </div>
          <div className="review-onboarding-page">
            <span />
            <span />
            <span />
            <i />
          </div>
          <span className="review-onboarding-pin">1</span>
          <span className="review-onboarding-bubble">
            <MessageCircle size={13} />
            <i />
            <i />
          </span>
          <MousePointer2 size={19} className="review-onboarding-pointer" />
        </div>
        <ol className="review-onboarding-steps">
          <li>
            <span>1</span>
            <div>
              <strong>{t("browse")}</strong>
              <p>{t("onboardingBrowse")}</p>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>{t("comment")}</strong>
              <p>{t("onboardingComment")}</p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>{t("onboardingResumeTitle")}</strong>
              <p>{t("onboardingResume")}</p>
            </div>
          </li>
        </ol>
        <button className="button primary review-onboarding-start" onClick={close} autoFocus>
          {t("onboardingStart")}
          <ArrowRight size={16} />
        </button>
      </div>
    </Modal>
  );
}
