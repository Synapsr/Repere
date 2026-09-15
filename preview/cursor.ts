// A 32px native cursor keeps the bubble's tip on the exact annotation coordinate.
// The white outline remains visible on dark pages; the fallback stays clickable.
function commentCursor(adding: boolean) {
  const bubble = "M4 28V16a12 12 0 1 1 12 12Z";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="${bubble}" fill="white" stroke="white" stroke-width="5" stroke-linejoin="round"/><path d="${bubble}" fill="white" stroke="#3657e8" stroke-width="2" stroke-linejoin="round"/>${adding ? '<path d="M12 16h8m-4-4v8" fill="none" stroke="#3657e8" stroke-width="2" stroke-linecap="round"/>' : ""}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 4 28, pointer`;
}

export const ADD_COMMENT_CURSOR = commentCursor(true);
export const COMMENT_CURSOR = commentCursor(false);
