export type PlatformRole = "ADMIN" | "USER";
export type GameRole = "GAMEMASTER" | "PLAYER";

export type SessionUser = {
  id: number;
  email: string;
  display_name?: string;
  platform_role: PlatformRole;
  game_role: GameRole;
};

export type AuthSession = {
  authenticated: boolean;
  user?: SessionUser;
};

export type AdminUser = {
  id: number;
  email: string;
  display_name?: string;
  is_linked: boolean;
  platform_role: PlatformRole;
  game_role: GameRole;
  is_active: boolean;
};

export type AdminUsersResponse = {
  users: AdminUser[];
};
