export type CampaignPreset = {
  id: number;
  display_name: string;
  room_slug: string;
  gamemaster_user_ids: number[];
  player_user_ids: number[];
  default_split_room_names: string[];
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};

export type CampaignInput = Omit<CampaignPreset, "id" | "created_at" | "updated_at">;

export type CampaignsResponse = {
  campaigns: CampaignPreset[];
};

export type CampaignDirectoryUser = {
  id: number;
  email: string;
  display_name?: string;
  game_role: "GAMEMASTER" | "PLAYER";
  is_active: boolean;
};

export type CampaignDirectoryResponse = {
  users: CampaignDirectoryUser[];
};
