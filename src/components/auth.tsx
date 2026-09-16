"use client";
import { useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "./language-switcher";
import {
  ArrowRight,
  ArrowLeft,
  Mail,
  ShieldCheck,
  MousePointer2,
  Check,
  MessageCircle,
  Globe,
} from "lucide-react";
import { api } from "@/lib/client";
import { loginDestination } from "@/lib/login-destination";
import type { User } from "../../shared/types";
import { Logo, Avatar, Spinner, ErrorBanner, OpenSourceFooter } from "./ui";

export function AuthForm({
  onSuccess,
  compact = false,
}: {
  onSuccess: (user: User) => void;
  compact?: boolean;
}) {
  const t = useTranslations("auth");
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const requestInFlight = useRef(false);
  async function request() {
    await api("/api/auth/request", {
      method: "POST",
      body: JSON.stringify({ email, name: name.trim() || undefined }),
    });
    setStep("code");
    setSent(true);
  }
  async function authenticate(nextCode = code) {
    // A ref closes the gap before React renders the pending state after a paste or submit.
    if (requestInFlight.current || (step === "code" && !/^\d{6}$/.test(nextCode))) return;
    requestInFlight.current = true;
    setPending(true);
    setError("");
    let signedIn = false;
    try {
      if (step === "email") await request();
      else {
        const data = await api<{ user: User }>("/api/auth/verify", {
          method: "POST",
          body: JSON.stringify({ email, code: nextCode }),
        });
        onSuccess(data.user);
        signedIn = true;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("connectionError"));
    } finally {
      // Keep a successful verification locked while navigation or the parent update completes.
      if (!signedIn) {
        requestInFlight.current = false;
        setPending(false);
      }
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void authenticate();
  }
  function pasteCode(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    if (requestInFlight.current) return;
    // Accept copied code groups, whitespace and invisible separators, without extracting
    // arbitrary digits from a sentence or truncating a longer number into a different code.
    const pastedCode = event.clipboardData.getData("text/plain").replace(/[\s\u200B\uFEFF-]/g, "");
    if (!/^\d{1,6}$/.test(pastedCode)) return;
    setCode(pastedCode);
    setError("");
    if (pastedCode.length === 6) void authenticate(pastedCode);
  }
  return (
    <div className={compact ? "auth-form compact" : "auth-form"}>
      <h1>
        {step === "email" ? (
          compact ? (
            t("guestTitle")
          ) : (
            <>
              {t("titleStart")}
              <br />
              {t("titleEnd")}
            </>
          )
        ) : (
          t("codeTitle")
        )}
      </h1>
      <p className="auth-description">
        {step === "email"
          ? compact
            ? t("guestDescription")
            : t("description")
          : t.rich("codeDescription", { email, address: (chunks) => <strong>{chunks}</strong> })}
      </p>
      <form onSubmit={submit} aria-busy={pending}>
        {step === "email" ? (
          <>
            <label htmlFor="auth-name">
              {t("name")} <span className="muted">{t("optional")}</span>
            </label>
            <input
              id="auth-name"
              name="name"
              autoComplete="given-name"
              placeholder={t("namePlaceholder")}
              value={name}
              readOnly={pending}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />
            <label htmlFor="auth-email">{t("email")}</label>
            <div className="input-with-icon">
              <Mail size={18} />
              <input
                id="auth-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder={t("emailPlaceholder")}
                value={email}
                readOnly={pending}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={254}
              />
            </div>
          </>
        ) : (
          <>
            <label htmlFor="auth-code">{t("code")}</label>
            <input
              id="auth-code"
              className="otp-input"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={code}
              readOnly={pending}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onPaste={pasteCode}
              minLength={6}
              maxLength={6}
              required
              autoFocus
            />
            <div className="code-help">{t("spamHelp")}</div>
          </>
        )}
        <ErrorBanner message={error} />
        <button
          className="button primary full"
          disabled={pending || (step === "code" && code.length !== 6)}
          type="submit"
        >
          {pending ? (
            <Spinner label={step === "email" ? t("sending") : t("signingIn")} />
          ) : (
            <>
              {step === "email" ? t("sendCode") : t("signIn")}
              <ArrowRight size={18} />
            </>
          )}
        </button>
      </form>
      {step === "email" ? (
        <p className="auth-reassurance">
          <ShieldCheck size={15} />
          {t("noPassword")}
        </p>
      ) : (
        <div className="auth-actions">
          <button
            className="text-button"
            disabled={pending}
            onClick={() => {
              if (requestInFlight.current) return;
              setStep("email");
              setError("");
              setCode("");
            }}
          >
            <ArrowLeft size={14} />
            {t("changeEmail")}
          </button>
          <button
            className="text-button"
            disabled={pending}
            onClick={async () => {
              if (requestInFlight.current) return;
              requestInFlight.current = true;
              setPending(true);
              setError("");
              setSent(false);
              try {
                await request();
              } catch (e) {
                setError(e instanceof Error ? e.message : t("sendError"));
              } finally {
                requestInFlight.current = false;
                setPending(false);
              }
            }}
          >
            {t("resendCode")}
          </button>
          {sent && (
            <span className="sr-only" role="status">
              {t("codeSent")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
export function LoginPage() {
  const t = useTranslations("auth");
  const router = useRouter();
  const searchParams = useSearchParams();
  return (
    <main className="login-layout">
      <section className="login-main">
        <div className="login-heading">
          <Logo />
          <LanguageSwitcher />
        </div>
        <AuthForm
          onSuccess={() => {
            router.replace(loginDestination(searchParams.get("next"), window.location.origin));
          }}
        />
        <OpenSourceFooter />
      </section>
      <aside className="login-art" aria-label={t("previewLabel")}>
        <div className="art-topline">
          <span>{t("previewEyebrow")}</span>
          <span className="tiny-cross">✳</span>
        </div>
        <div className="art-composition">
          <div className="art-browser">
            <div className="art-browser-bar">
              <span className="traffic">
                <i />
                <i />
                <i />
              </span>
              <span>
                <Globe size={12} />
                {t("previewUrl")}
              </span>
            </div>
            <div className="art-site">
              <span className="art-site-logo">studio.</span>
              <div className="art-site-title">
                {t("previewTitle")}
                <br />
                <em>{t("previewTitleEnd")}</em>
              </div>
              <div className="art-line" />
              <div className="art-line short" />
              <span className="art-cta">
                {t("previewCta")} <ArrowRight size={13} />
              </span>
              <div className="art-shape">
                <div />
                <div />
                <div />
              </div>
              <span className="art-pin">1</span>
            </div>
          </div>
          <div className="art-comment">
            <div className="comment-author">
              <Avatar name="Camille Martin" />
              <div>
                <strong>Camille</strong>
                <span>{t("previewNow")}</span>
              </div>
              <span className="pill">#1</span>
            </div>
            <p>{t("previewComment")}</p>
            <div className="art-comment-footer">
              <MessageCircle size={14} />
              {t("reply")}
              <span>
                <Check size={14} />
                {t("resolve")}
              </span>
            </div>
          </div>
          <span className="art-cursor">
            <MousePointer2 size={29} fill="currentColor" />
            <span>Camille</span>
          </span>
        </div>
        <div className="art-bottom">
          <span className="art-step">
            <b>01</b> {t("share")}
          </span>
          <span className="art-step">
            <b>02</b> {t("annotate")}
          </span>
          <span className="art-step">
            <b>03</b> {t("progress")}
          </span>
        </div>
      </aside>
    </main>
  );
}
