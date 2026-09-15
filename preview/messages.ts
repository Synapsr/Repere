import { isLocale, type Locale } from "../shared/locale";

const english = {
  comment: "Comment {number}",
  approximate: "Approximate position",
  redirectTitle: "Continue browsing",
  redirectHeading: "This page redirects to another website.",
  redirectLink: "Open this page in a new tab",
  redirectHint: "Return to the project website to continue reviewing.",
  invalidRequest: "Invalid request target.",
  methodNotAllowed: "Method not allowed.",
  unknownEndpoint: "Unknown preview endpoint.",
  uploadTooLarge: "Preview uploads are limited to 25 MB.",
  unsafeRedirect: "This redirect cannot be opened safely.",
  stopping: "The preview service is restarting. Try again shortly.",
  unauthorized: "You are not authorized to open this preview.",
  capacity: "The preview service is busy. Try again shortly.",
  openFailed: "This website cannot be opened. Check its address and availability.",
  expired: "This preview session has expired. Reopen it from Repère.",
  upstreamFailed: "The website did not respond correctly. Try again shortly.",
};
export type PreviewMessageKey = keyof typeof english;
const french: Record<PreviewMessageKey, string> = {
  comment: "Retour {number}",
  approximate: "Position approximative",
  redirectTitle: "Continuer la navigation",
  redirectHeading: "Cette page vous dirige vers un autre site.",
  redirectLink: "Ouvrir cette page dans un nouvel onglet",
  redirectHint: "Revenez au site du projet pour continuer la relecture.",
  invalidRequest: "Adresse de requête invalide.",
  methodNotAllowed: "Méthode non autorisée.",
  unknownEndpoint: "Adresse d’aperçu inconnue.",
  uploadTooLarge: "Les envois dans l’aperçu sont limités à 25 Mo.",
  unsafeRedirect: "Cette redirection ne peut pas être ouverte en toute sécurité.",
  stopping: "Le service d’aperçu redémarre. Réessayez dans un instant.",
  unauthorized: "Vous n’êtes pas autorisé à ouvrir cet aperçu.",
  capacity: "Le service d’aperçu est occupé. Réessayez dans un instant.",
  openFailed: "Ce site ne peut pas être ouvert. Vérifiez son adresse et sa disponibilité.",
  expired: "Cette session d’aperçu a expiré. Rouvrez-la depuis Repère.",
  upstreamFailed: "Le site n’a pas répondu correctement. Réessayez dans un instant.",
};

export function previewMessage(locale: Locale, key: PreviewMessageKey): string {
  return (locale === "fr" ? french : english)[key];
}

export function previewPinLabel(locale: Locale, number: number, approximate = false): string {
  const label = previewMessage(locale, "comment").replace("{number}", String(number));
  return approximate ? `${label} · ${previewMessage(locale, "approximate")}` : label;
}

/** Only these two values may change the bridge language, including restored session storage. */
export function previewLocale(value: unknown, fallback: Locale = "en"): Locale {
  return isLocale(value) ? value : fallback;
}
