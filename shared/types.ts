export type User = { id: string; email: string; name: string };
export type Workspace = { id: string; name: string; role: "owner" | "member" };
export type WorkspaceMember = { user: User; role: "owner" | "member" };
export type WorkspaceInvitation = {
  id: string;
  email: string;
  expiresAt: string;
  createdAt: string;
};
export type InvitationData = {
  invitation: {
    workspaceName: string;
    inviterName: string | null;
    emailHint: string;
    expiresAt: string;
  };
  user: User | null;
  canAccept: boolean;
};
export type WebsiteAnchor = {
  type: "website";
  url: string;
  selector: string | null;
  text: string | null;
  x: number;
  y: number;
  documentX: number;
  documentY: number;
  viewportWidth: number;
  viewportHeight: number;
};
export type PdfAnchor = { type: "pdf"; page: number; x: number; y: number };
export type Anchor = WebsiteAnchor | PdfAnchor;
export type CaptureInput = {
  dataUrl: string;
  capturedAt: string;
  pointX: number;
  pointY: number;
};
export type Screenshot = {
  width: number;
  height: number;
  pointX: number;
  pointY: number;
  capturedAt: string;
};
export type Project = {
  id: string;
  name: string;
  description: string | null;
  type: "website" | "pdf";
  url: string | null;
  fileName: string | null;
  shareToken: string;
  workspaceId: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  resolvedCount: number;
};
export type Reply = { id: string; body: string; author: User; createdAt: string };
export type Feedback = {
  id: string;
  number: number;
  projectId: string;
  body: string;
  status: "open" | "resolved";
  kind: "text" | "audio" | "text-suggestion";
  anchor: Anchor;
  screenshot?: Screenshot | null;
  author: User;
  replies: Reply[];
  createdAt: string;
  updatedAt: string;
};
export type ReviewData = {
  project: Project;
  comments: Feedback[];
  user: User | null;
  canManage: boolean;
};
