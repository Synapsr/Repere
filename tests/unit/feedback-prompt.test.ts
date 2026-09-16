import { describe, expect, it } from "vitest";
import { feedbackPrompt } from "../../src/lib/feedback-prompt";
import type { Feedback, Project } from "../../shared/types";

const project: Project = {
  id: "private-project-id",
  name: "Studio",
  type: "website",
  url: "https://example.test/",
  description: "Keep the existing brand.",
  fileName: null,
  shareToken: "private-review-token",
  workspaceId: "private-workspace-id",
  archived: false,
  createdAt: "",
  updatedAt: "",
  commentCount: 2,
  resolvedCount: 0,
};
const comment: Feedback = {
  id: "private-comment-id",
  projectId: project.id,
  number: 3,
  body: "Make the button clearer.\nKeep its label.",
  author: { id: "private-user-id", name: "Alice", email: "private@example.test" },
  status: "open",
  kind: "text",
  createdAt: "",
  updatedAt: "",
  anchor: {
    type: "website",
    url: "https://example.test/contact?tab=team",
    selector: "#contact button",
    text: "Talk to us",
    x: 0.125,
    y: 0.5,
    documentX: 128.1,
    documentY: 940.2,
    viewportWidth: 1280,
    viewportHeight: 720,
  },
  screenshot: {
    width: 1280,
    height: 720,
    pointX: 0.1,
    pointY: 0.2,
    capturedAt: "2026-09-16T10:00:00Z",
  },
  replies: [
    {
      id: "reply-id",
      body: "Use the blue variant.",
      author: { id: "reply-author", name: "Bob", email: "reply@example.test" },
      createdAt: "",
    },
  ],
};

describe("feedback prompts", () => {
  it("keeps actionable page context and discussion without credentials or private image URLs", () => {
    const prompt = feedbackPrompt(project, [comment], "en");
    for (const expected of [
      "Feedback #3",
      "Alice",
      "Bob",
      "#contact button",
      "https://example.test/contact?tab=team",
      "Talk to us",
      "x=12.5%, y=50%",
      "1280 × 720",
      "> Make the button clearer.\n> Keep its label.",
      "> Use the blue variant.",
      "image is not included",
    ])
      expect(prompt).toContain(expected);
    for (const excluded of [
      "private-",
      "private@example.test",
      "reply@example.test",
      "/api/reviews/",
      "data:image/",
    ])
      expect(prompt).not.toContain(excluded);
  });
  it("supports French PDF page coordinates without inventing website selectors", () => {
    const prompt = feedbackPrompt(
      { ...project, type: "pdf", url: null, fileName: "Brand.pdf" },
      [
        {
          ...comment,
          anchor: { type: "pdf", page: 2, x: 0.2, y: 0.75 },
          screenshot: null,
          replies: [],
        },
      ],
      "fr",
    );
    expect(prompt).toContain("Applique les retours suivants");
    expect(prompt).toContain("Fichier : Brand.pdf");
    expect(prompt).toContain("Page : 2");
    expect(prompt).toContain("x=20%, y=75%");
    expect(prompt).not.toContain("Sélecteur CSS");
    expect(prompt).not.toContain("Capture :");
    expect(prompt).not.toContain("Discussion");
  });
  it("orders points without mutating inputs and preserves quoted multiline feedback", () => {
    const input = [comment, { ...comment, number: 1, body: "# Heading\r\n\r\n> Keep this quote" }];
    const prompt = feedbackPrompt(project, input, "en");
    expect(prompt.indexOf("Feedback #1")).toBeLessThan(prompt.indexOf("Feedback #3"));
    expect(input[0].number).toBe(3);
    expect(prompt).toContain("> # Heading\n> \n> > Keep this quote");
  });
});
