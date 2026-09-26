/* GET /api/chain: latest mainnet block and the ETH price from the Uniswap v3 WETH/USDC pool. */
import { rpc } from "@/lib/chain";
import { errorMessage } from "@/lib/http";
import { ethUsdPrice } from "@/lib/uniswap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [block, ethUsd] = await Promise.all([rpc().getBlockNumber(), ethUsdPrice()]);
    return Response.json({ blockNumber: block.toString(), ethUsd });
  } catch (caught) {
    return Response.json({ error: errorMessage(caught) }, { status: 502 });
  }
}
