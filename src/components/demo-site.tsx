"use client";
import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowUpRight, ArrowRight, Plus, Check } from "lucide-react";
import "./demo-site.css";

const subscribeHydration = () => () => {};

export function DemoSite({ about = false }: { about?: boolean }) {
  const t = useTranslations("demo");
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  const [count, setCount] = useState(0);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [tab, setTab] = useState("identity");
  return (
    <div className="forma-site" data-hydrated={hydrated}>
      <nav className="forma-nav">
        <Link className="forma-logo" href="/demo-site">
          forma<span>®</span>
        </Link>
        <div>
          <a href="/demo-site#projects">{t("projects")} </a>
          <Link href="/demo-site/about">{t("studio")} </Link>
          <a href="/demo-site#contact" className="forma-contact">
            {t("contact")}
            <ArrowUpRight size={13} />
          </a>
        </div>
      </nav>
      <main>
        <section className="forma-hero">
          <div className="forma-hero-text">
            <span className="forma-kicker">{t("kicker")} </span>
            <h1>
              {about ? (
                <>
                  {t("aboutTitle")}
                  <br />
                  <em>{t("aboutTitleEnd")} </em>
                </>
              ) : (
                <>
                  {t("title")}
                  <br />
                  {t("titleMiddle")} <em>{t("titleEnd")}</em>
                </>
              )}
            </h1>
            <p>{about ? t("aboutDescription") : t("description")}</p>
            <a className="forma-primary" href="#projects">
              {about ? t("discoverWork") : t("discoverStudio")}
              <ArrowUpRight size={15} />
            </a>
            <div className="forma-hero-foot">
              <span>
                {t("firstIdea")}
                <br />
                {t("lastDetail")}
              </span>
              <span>↓</span>
            </div>
          </div>
          <div className="forma-art" aria-label={t("artLabel")}>
            <div className="forma-arch arch-back" />
            <div className="forma-sphere" />
            <div className="forma-arch arch-front" />
            <div className="forma-cube" />
            <span className="forma-art-label">
              {t("boldness")}
              <br />
              {t("meaning")}
            </span>
            <span className="forma-art-star">✳</span>
          </div>
        </section>
        <div className="forma-band">
          <span>{t("strategy")} </span>
          <b>✳</b>
          <span>{t("identity")} </span>
          <b>✳</b>
          <span>Digital</span>
          <b>✳</b>
          <span>{t("freshEye")} </span>
          <b>↗</b>
        </div>
        <section id="projects" className="forma-projects">
          <div className="forma-section-heading">
            <span className="forma-kicker">{t("projectsKicker")} </span>
            <h2>{t("projectsTitle")} </h2>
            <div className="forma-tabs" role="tablist" aria-label={t("expertise")}>
              {(["identity", "web", "print"] as const).map((item) => (
                <button
                  key={item}
                  role="tab"
                  aria-selected={tab === item}
                  onClick={() => {
                    setTab(item);
                    window.history.replaceState(null, "", `#${item.toLowerCase()}`);
                  }}
                >
                  {t(item)}
                </button>
              ))}
            </div>
          </div>
          <div className="forma-project-tiles">
            <div className="forma-project-tile">
              <span>{tab === "web" ? "digital." : tab === "print" ? "papier." : "aura."}</span>
              <div>
                <b>{tab === "web" ? "Maison Noma" : tab === "print" ? t("magazine") : t("aura")}</b>
                <ArrowUpRight size={18} />
              </div>
            </div>
            <div className="forma-project-tile second">
              <span>
                {tab === "web" ? "bonjour" : "mōno"}
                <i>®</i>
              </span>
              <div>
                <b>{t("objects")} </b>
                <ArrowUpRight size={18} />
              </div>
            </div>
          </div>
        </section>
        <section id="contact" className="forma-bottom">
          <div>
            <span className="forma-kicker">{t("contactKicker")} </span>
            <h2>{t("contactTitle")} </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSent(true);
              }}
            >
              <label htmlFor="demo-email">{t("email")} </label>
              <div>
                <input
                  id="demo-email"
                  type="email"
                  required
                  placeholder={t("emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button type="submit" aria-label={t("submit")}>
                  <ArrowRight size={18} />
                </button>
              </div>
              {sent && (
                <p role="status">
                  <Check size={15} />
                  {t("thanks")}
                </p>
              )}
            </form>
          </div>
          <div className="forma-interaction">
            <span>{t("details")} </span>
            <button onClick={() => setCount((c) => c + 1)} aria-label={t("addIdea")}>
              <Plus size={20} />
            </button>
            <strong>{t("ideaCount", { count })}</strong>
            <p>{t("tryButton")} </p>
          </div>
        </section>
      </main>
      <footer className="forma-footer">
        <Link className="forma-logo" href="/demo-site">
          forma<span>®</span>
        </Link>
        <p>{t("footer")} </p>
        <span>{t("credits")} </span>
      </footer>
    </div>
  );
}
