export const ROLES = ['owner', 'admin', 'engineer'] as const;
export type Role = (typeof ROLES)[number];

export interface AuthUser {
  sub: string;
  tenantId: string;
  email: string;
  role: Role;
}
