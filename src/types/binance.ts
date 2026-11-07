export interface BinanceAd { advNo?: string; adNo?: string; price: string | number; minSingleTransAmount?: string | number; maxSingleTransAmount?: string | number; minTransAmount?: string | number; maxTransAmount?: string | number; nickName?: string; tradeMethods?: unknown[]; tradableAmount?: string | number }
export interface BinanceResponse { success?: boolean; data?: BinanceAd[] }
