export interface BinanceAd { price: string | number; minSingleTransAmount?: string | number; maxSingleTransAmount?: string | number; minTransAmount?: string | number; maxTransAmount?: string | number; nickName?: string; tradeMethods?: unknown[] }
export interface BinanceResponse { success?: boolean; data?: BinanceAd[] }
