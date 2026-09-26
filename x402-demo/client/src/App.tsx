import { useState } from "react";

const merchantPath = "/merchant/dataset/demo-1";
const chainId = "0x14a34";
const chainName = "Base Sepolia";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

type Requirements = {
  scheme: "exact";
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string };
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

function provider(): EthereumProvider {
  if (!window.ethereum)
    throw new Error("MetaMask was not found. Install it in this browser first.");
  return window.ethereum;
}

function short(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
function usdc(value: string) {
  return `$${(Number(value) / 1_000_000).toFixed(4)}`;
}
function hexNonce() {
  return `0x${crypto.getRandomValues(new Uint8Array(32)).reduce((out, byte) => out + byte.toString(16).padStart(2, "0"), "")}`;
}
function base64(value: unknown) {
  return btoa(JSON.stringify(value));
}

async function ensureBaseSepolia(wallet: EthereumProvider) {
  try {
    await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (error) {
    if ((error as { code?: number }).code !== 4902) throw error;
    await wallet.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName,
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://sepolia.base.org"],
          blockExplorerUrls: ["https://sepolia.basescan.org"],
        },
      ],
    });
  }
}

export function App() {
  const [account, setAccount] = useState("");
  const [requirements, setRequirements] = useState<Requirements>();
  const [result, setResult] = useState<Record<string, unknown>>();
  const [activity, setActivity] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const note = (message: string) => setActivity((items) => [message, ...items].slice(0, 6));

  const connectWallet = async () => {
    setError("");
    const wallet = provider();
    const accounts = (await wallet.request({ method: "eth_requestAccounts" })) as string[];
    if (!accounts[0]) throw new Error("MetaMask returned no account.");
    await ensureBaseSepolia(wallet);
    setAccount(accounts[0]);
    note(`Wallet connected: ${short(accounts[0])}`);
  };

  const requestMerchant = async () => {
    setBusy(true);
    setError("");
    setResult(undefined);
    try {
      const response = await fetch(merchantPath);
      const body = await response.json();
      if (response.status !== 402)
        throw new Error(
          "The merchant did not return 402. Reset the demo or the resource may already be paid.",
        );
      const accepts = body.accepts as Requirements[];
      setRequirements(accepts[0]);
      note(`Merchant returned 402: ${usdc(accepts[0].amount)} ${accepts[0].extra.name}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Merchant request failed");
    } finally {
      setBusy(false);
    }
  };

  const payAndRequest = async () => {
    setBusy(true);
    setError("");
    try {
      if (!requirements) throw new Error("Request the merchant quote first.");
      const wallet = provider();
      const currentAccount =
        account ||
        (((await wallet.request({ method: "eth_requestAccounts" })) as string[])[0] ?? "");
      if (!currentAccount) throw new Error("Connect MetaMask before paying.");
      await ensureBaseSepolia(wallet);
      setAccount(currentAccount);
      const validBefore = Math.floor(Date.now() / 1000) + requirements.maxTimeoutSeconds;
      const authorization = {
        from: currentAccount,
        to: requirements.payTo,
        value: requirements.amount,
        validAfter: "0",
        validBefore: String(validBefore),
        nonce: hexNonce(),
      };
      const typedData = {
        domain: {
          name: requirements.extra.name,
          version: requirements.extra.version,
          chainId: 84532,
          verifyingContract: requirements.asset,
        },
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
            { name: "verifyingContract", type: "address" },
          ],
          TransferWithAuthorization: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" },
          ],
        },
        primaryType: "TransferWithAuthorization",
        message: authorization,
      };
      note("Waiting for MetaMask signature...");
      const signature = (await wallet.request({
        method: "eth_signTypedData_v4",
        params: [currentAccount, JSON.stringify(typedData)],
      })) as string;
      const paymentPayload = {
        x402Version: 2,
        accepted: requirements,
        payload: { signature, authorization },
      };
      note("Signature received. Sending payment proof to merchant...");
      const response = await fetch(merchantPath, {
        headers: { "PAYMENT-SIGNATURE": base64(paymentPayload) },
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || `Merchant rejected payment (${response.status})`);
      setResult(body);
      note(
        `Merchant returned data${body.payment?.txHash ? `: ${short(body.payment.txHash)}` : "."}`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="shell">
      <nav>
        <span className="brand">
          MAAT <b>X402</b>
        </span>
        <span className="nav-note">CLIENT DEMO / BASE SEPOLIA</span>
        <a href="http://localhost:8790" target="_blank" rel="noreferrer">
          Open merchant console ↗
        </a>
      </nav>
      <section className="hero">
        <div className="eyebrow">
          <i /> HTTP 402 PAYMENT FLOW
        </div>
        <h1>
          Pay for an API resource
          <br />
          <em>with your wallet.</em>
        </h1>
        <p>
          Connect MetaMask, ask the merchant for a price, sign the USDC authorization, then request
          the protected dataset again.
        </p>
      </section>
      <section className="grid">
        <article className="card main-card">
          <div className="card-head">
            <span>DEMO STEPS</span>
            <span className={account ? "connected" : "pending"}>
              {account ? `● ${short(account)}` : "○ Wallet disconnected"}
            </span>
          </div>
          <div className="step">
            <div className="step-no">01</div>
            <div>
              <h2>Connect MetaMask</h2>
              <p>Switches the wallet to Base Sepolia. No payment happens yet.</p>
            </div>
            <button
              className="button secondary"
              onClick={() => void connectWallet()}
              disabled={busy}
            >
              {account ? "Connected" : "Connect wallet"}
            </button>
          </div>
          <div className={`step ${requirements ? "active" : ""}`}>
            <div className="step-no">02</div>
            <div>
              <h2>Ask the merchant</h2>
              <p>The first request intentionally receives HTTP 402 and a payment quote.</p>
              {requirements && (
                <div className="quote">
                  <strong>{usdc(requirements.amount)}</strong>
                  <span>Base Sepolia USDC → {short(requirements.payTo)}</span>
                </div>
              )}
            </div>
            <button
              className="button secondary"
              onClick={() => void requestMerchant()}
              disabled={busy}
            >
              {requirements ? "Quote received" : "Request 402"}
            </button>
          </div>
          <div className={`step ${result ? "complete" : ""}`}>
            <div className="step-no">03</div>
            <div>
              <h2>Confirm payment</h2>
              <p>
                MetaMask signs an EIP-712 USDC authorization. The merchant then settles it and
                returns data.
              </p>
            </div>
            <button
              className="button primary"
              onClick={() => void payAndRequest()}
              disabled={busy || !requirements}
            >
              {busy ? "Waiting..." : result ? "Paid successfully" : "Confirm in MetaMask"}
            </button>
          </div>
          {error && <div className="notice error">{error}</div>}
          {result && (
            <div className="notice success">
              <strong>Protected data received</strong>
              <pre>{String(JSON.stringify(result, null, 2))}</pre>
            </div>
          )}
        </article>
        <aside className="card side-card">
          <div className="card-head">
            <span>ACTIVITY</span>
            <span className="live">
              <i /> LIVE
            </span>
          </div>
          <div className="activity">
            {activity.length ? (
              activity.map((item, index) => (
                <div key={`${item}-${index}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {item}
                </div>
              ))
            ) : (
              <div className="empty">Your payment flow will appear here.</div>
            )}
          </div>
          <div className="boundary">
            <span>SERVER BOUNDARY</span>
            <p>
              The demo client signs with MetaMask. The reusable merchant service verifies and
              settles through the facilitator.
            </p>
          </div>
        </aside>
      </section>
      <footer>
        <span>DEMO CLIENT</span>
        <span>Next step: replace direct merchant calls with Maat Gateway</span>
      </footer>
    </main>
  );
}
