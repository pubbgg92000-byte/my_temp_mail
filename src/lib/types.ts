export type TempInbox = {
  id: string;
  emailAddress: string;
  localPart: string;
  status: string;
  createdAt: string;
  expiresAt: string | null;
};

export type InboxMessage = {
  id: string;
  from: string | null;
  subject: string | null;
  code: string | null;
  bodyPreview: string | null;
  receivedAt: string | null;
};
