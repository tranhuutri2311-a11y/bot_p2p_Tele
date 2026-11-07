export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  ADMIN_REPORT_SECRET: string;
  STATS_SERVICE: Fetcher;
  ALLOWED_TELEGRAM_USER_IDS: string;
}

export interface TelegramUpdate {
  update_id?: number;
  message?: {
    chat?: { id: number };
    from?: { id?: number };
    text?: string;
  };
}

export interface StatsResponse {
  week?: string;
  totalRequests?: number;
  activePrivateUsers?: number;
  activeGroups?: number;
  users?: StatsUser[];
  conversations?: StatsConversation[];
  [key: string]: unknown;
}

export interface StatsUser {
  chatId?: number;
  userId?: number | null;
  username?: string | null;
  displayName?: string | null;
  chatType?: string;
  count?: number;
}

export interface StatsConversation {
  chatId?: number;
  chatType?: string;
  chatTitle?: string | null;
  chatUsername?: string | null;
  botStatus?: string;
  requestCount?: number;
}
