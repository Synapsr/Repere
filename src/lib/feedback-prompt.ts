import type { Locale } from "../../shared/locale";
import type { Feedback, Project } from "../../shared/types";
import en from "@/i18n/messages/en/prompt.json";
import fr from "@/i18n/messages/fr/prompt.json";

const messages: Record<Locale, typeof en> = { en, fr };
const line = (value: string) => value.replace(/[\r\n]+/g, " ");
const quote = (value: string) =>
  value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((part) => `> ${part}`)
    .join("\n");
const percent = (value: number) => `${Math.round(value * 1000) / 10}%`;

/** Explicit fields omit account emails, review tokens, storage keys and image bytes. */
export function feedbackPrompt(
  project: Pick<Project, "name" | "type" | "url" | "fileName" | "description">,
  comments: Feedback[],
  locale: Locale,
): string {
  const t = messages[locale];
  const introduction = [
    t.instruction,
    t.sourceNote,
    `# ${t.project} : ${line(project.name)}`,
    `${t.type} : ${t[project.type]}`,
    project.url
      ? `${t.url} : ${project.url}`
      : `${t.file} : ${line(project.fileName ?? project.name)}`,
    ...(project.description ? [`${t.description} :\n${quote(project.description)}`] : []),
  ];
  const sections = [...comments]
    .sort((a, b) => a.number - b.number)
    .map((comment) => {
      const { anchor } = comment;
      const location =
        anchor.type === "website"
          ? [
              `${t.page} : ${anchor.url}`,
              ...(anchor.selector ? [`${t.selector} : ${line(anchor.selector)}`] : []),
              ...(anchor.text ? [`${t.text} :\n${quote(anchor.text)}`] : []),
              `${t.position} : x=${percent(anchor.x)}, y=${percent(anchor.y)}`,
              `${t.documentPosition} : x=${Math.round(anchor.documentX)} px, y=${Math.round(anchor.documentY)} px`,
              `${t.viewport} : ${anchor.viewportWidth} × ${anchor.viewportHeight} px`,
            ]
          : [
              `${t.page} : ${anchor.page}`,
              `${t.pdfPosition} : x=${percent(anchor.x)}, y=${percent(anchor.y)}`,
            ];
      return [
        `## ${t.feedback} #${comment.number}`,
        ...location,
        ...(comment.screenshot ? [t.screenshot] : []),
        `### ${t.comment} — ${t.author.toLowerCase()} ${line(comment.author.name)}`,
        quote(comment.body),
        ...(comment.replies.length
          ? [
              `### ${t.replies}`,
              ...comment.replies.map(
                (reply) => `${t.author} ${line(reply.author.name)} :\n${quote(reply.body)}`,
              ),
            ]
          : []),
      ].join("\n\n");
    });
  return [...introduction, ...sections].join("\n\n") + "\n";
}
