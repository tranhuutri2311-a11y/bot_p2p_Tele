export interface TelegramMessage { chat?: { id: number; type?: 'private' | 'group' | 'supergroup' | 'channel'; title?: string; username?: string }; from?: { id?: number; username?: string; first_name?: string; last_name?: string }; text?: string }
export interface TelegramChatMemberUpdate { chat: NonNullable<TelegramMessage['chat']>; from?: TelegramMessage['from']; new_chat_member?: { status?: string } }
export interface TelegramUpdate { update_id?: number; message?: TelegramMessage; my_chat_member?: TelegramChatMemberUpdate }
