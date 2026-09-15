import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";
import type { PreviewConfig } from "../shared/preview";

type Element = DefaultTreeAdapterMap["element"];
type Node = DefaultTreeAdapterMap["node"];
const urlAttributes = new Set([
  "src",
  "href",
  "action",
  "formaction",
  "poster",
  "data",
  "cite",
  "background",
]);

export function rewriteUrl(value: string, targetOrigin: string, previewOrigin: string): string {
  // Relative URLs already work: the preview preserves the original path and origin structure.
  if (!/^(?:https?:)?\/\//i.test(value.trim())) return value;
  try {
    const target = new URL(value, targetOrigin);
    if (target.origin !== targetOrigin) return value;
    return `${previewOrigin}${target.pathname}${target.search}${target.hash}`;
  } catch {
    return value;
  }
}

function rewriteSrcset(value: string, targetOrigin: string, previewOrigin: string): string {
  // URL tokens may contain commas (notably data: URLs); descriptors delimit the next candidate.
  return value.replace(
    /(^|,\s*)(\S+)(\s+[^,]+)?/g,
    (match, prefix: string, url: string, descriptor: string = "") => {
      return `${prefix}${rewriteUrl(url, targetOrigin, previewOrigin)}${descriptor}`;
    },
  );
}

export function rewriteCss(value: string, targetOrigin: string, previewOrigin: string): string {
  return value
    .replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote: string, url: string) => {
      const rewritten = rewriteUrl(url.trim(), targetOrigin, previewOrigin);
      return rewritten === url.trim() ? match : `url(${quote}${rewritten}${quote})`;
    })
    .replace(
      /(@import\s+)(["'])([^"']+)\2/gi,
      (match, prefix: string, quote: string, url: string) => {
        return `${prefix}${quote}${rewriteUrl(url, targetOrigin, previewOrigin)}${quote}`;
      },
    );
}

function walk(node: Node, visitor: (element: Element) => void) {
  if ("tagName" in node) visitor(node);
  if ("childNodes" in node) for (const child of node.childNodes) walk(child, visitor);
  if ("content" in node) walk(node.content, visitor);
}

export function rewriteHtml(
  html: string,
  targetOrigin: string,
  previewOrigin: string,
  config: PreviewConfig,
): string {
  const document = parse(html);
  let head: Element | undefined;
  walk(document, (element) => {
    if (element.tagName === "head") head = element;
    const attribute = (name: string) => element.attrs.find((item) => item.name === name)?.value;
    if (
      element.tagName === "meta" &&
      ["content-security-policy", "content-security-policy-report-only"].includes(
        attribute("http-equiv")?.toLowerCase() ?? "",
      )
    ) {
      // A target's CSP must not disable the injected annotation bridge or its isolated iframe.
      element.attrs = [{ name: "data-repere-original-csp", value: "removed" }];
      return;
    }
    if (
      element.tagName === "link" &&
      attribute("rel")?.toLowerCase().split(/\s+/).includes("stylesheet")
    ) {
      try {
        // The stylesheet's URL tokens may change, so its original integrity digest no longer applies.
        if (new URL(attribute("href") ?? "", targetOrigin).origin === targetOrigin)
          element.attrs = element.attrs.filter((item) => item.name !== "integrity");
      } catch {
        /* Leave invalid target attributes for the browser to handle. */
      }
    }
    for (const item of element.attrs) {
      if (
        urlAttributes.has(item.name) ||
        (item.name === "href" && item.namespace === "http://www.w3.org/1999/xlink")
      )
        item.value = rewriteUrl(item.value, targetOrigin, previewOrigin);
      else if (item.name === "srcset" || item.name === "imagesrcset")
        item.value = rewriteSrcset(item.value, targetOrigin, previewOrigin);
      else if (item.name === "style")
        item.value = rewriteCss(item.value, targetOrigin, previewOrigin);
    }
    if (element.tagName === "style")
      for (const child of element.childNodes)
        if (child.nodeName === "#text")
          (child as DefaultTreeAdapterMap["textNode"]).value = rewriteCss(
            (child as DefaultTreeAdapterMap["textNode"]).value,
            targetOrigin,
            previewOrigin,
          );
    if (element.tagName === "meta" && attribute("http-equiv")?.toLowerCase() === "refresh") {
      const content = element.attrs.find((item) => item.name === "content");
      if (content)
        content.value = content.value.replace(
          /(url\s*=\s*)(["']?)(.+?)\2\s*$/i,
          (match, prefix: string, quote: string, url: string) =>
            `${prefix}${quote}${rewriteUrl(url, targetOrigin, previewOrigin)}${quote}`,
        );
    }
  });
  if (!head) throw new Error("HTML parser did not create a document head");
  const safeConfig = JSON.stringify(config)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const fragment = parse(
    `<head><script id="repere-preview-config" type="application/json">${safeConfig}</script><script src="${previewOrigin}/__repere/bridge.js"></script></head>`,
  );
  let injected: Element | undefined;
  walk(fragment, (element) => {
    if (element.tagName === "head") injected = element;
  });
  for (const child of injected!.childNodes) child.parentNode = head;
  head.childNodes.unshift(...injected!.childNodes);
  return serialize(document);
}
