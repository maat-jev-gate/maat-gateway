import { config } from "dotenv";

config();

export type GatewaySettings = {
  bypassJev: boolean;
  bypassIntercepta: boolean;
  interceptaBypassVerdict: "ALLOW" | "BLOCK";
  bypassRealPayment: boolean;
  bypassWorldId: boolean;
  bypassMerchantRequest: boolean;
  jevBypassVerdict: "ALLOW" | "BLOCK" | "ESCALATE";
  worldBypassVerdict: "ALLOW" | "BLOCK";
  merchantUrl: string;
};

export const gatewaySettings: GatewaySettings = {
  bypassJev: false,
  bypassIntercepta: false,
  interceptaBypassVerdict: "ALLOW",
  bypassRealPayment: false,
  bypassWorldId: false,
  bypassMerchantRequest: false,
  jevBypassVerdict: "ESCALATE",
  worldBypassVerdict: "ALLOW",
  merchantUrl:
    process.env.MERCHANT_URL?.trim() ||
    "https://merchant.maat-jev-gate.online/merchant/dataset/demo-1",
};

export function updateGatewaySettings(input: Partial<GatewaySettings>): GatewaySettings {
  if (typeof input.bypassJev === "boolean") gatewaySettings.bypassJev = input.bypassJev;
  if (typeof input.bypassIntercepta === "boolean")
    gatewaySettings.bypassIntercepta = input.bypassIntercepta;
  if (input.interceptaBypassVerdict === "ALLOW" || input.interceptaBypassVerdict === "BLOCK")
    gatewaySettings.interceptaBypassVerdict = input.interceptaBypassVerdict;
  if (typeof input.bypassRealPayment === "boolean")
    gatewaySettings.bypassRealPayment = input.bypassRealPayment;
  if (typeof input.bypassWorldId === "boolean") gatewaySettings.bypassWorldId = input.bypassWorldId;
  if (typeof input.bypassMerchantRequest === "boolean")
    gatewaySettings.bypassMerchantRequest = input.bypassMerchantRequest;
  if (
    input.jevBypassVerdict === "ALLOW" ||
    input.jevBypassVerdict === "BLOCK" ||
    input.jevBypassVerdict === "ESCALATE"
  )
    gatewaySettings.jevBypassVerdict = input.jevBypassVerdict;
  if (input.worldBypassVerdict === "ALLOW" || input.worldBypassVerdict === "BLOCK")
    gatewaySettings.worldBypassVerdict = input.worldBypassVerdict;
  if (typeof input.merchantUrl === "string" && input.merchantUrl.trim())
    gatewaySettings.merchantUrl = input.merchantUrl.trim();
  return { ...gatewaySettings };
}
