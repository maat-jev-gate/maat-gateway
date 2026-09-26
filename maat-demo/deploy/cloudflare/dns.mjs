const token = process.env.ACCOUNT_API_TOKEN;
const zoneName = process.env.DEPLOY_ZONE;
const domain = process.env.DEPLOY_DOMAIN;
const originIp = process.env.DEPLOY_ORIGIN_IP;

if (!token) throw new Error("ACCOUNT_API_TOKEN is required.");
if (!zoneName || !domain || !domain.endsWith(`.${zoneName}`))
  throw new Error("DEPLOY_DOMAIN must belong to DEPLOY_ZONE.");
if (
  !originIp ||
  !/^(\d{1,3}\.){3}\d{1,3}$/.test(originIp) ||
  originIp.split(".").some((part) => Number(part) > 255)
) {
  throw new Error("DEPLOY_ORIGIN_IP must be an IPv4 address.");
}

async function api(path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const body = await response.json();
  if (!response.ok || !body.success)
    throw new Error(
      `Cloudflare API request failed: ${body.errors?.map((error) => error.code).join(", ") || response.status}`,
    );
  return body.result;
}

const zones = await api(`/zones?name=${encodeURIComponent(zoneName)}`);
const zone = zones.find((item) => item.name === zoneName && item.status === "active");
if (!zone) throw new Error("Active Cloudflare zone was not found.");
const records = await api(`/zones/${zone.id}/dns_records?name=${encodeURIComponent(domain)}`);
if (records.some((record) => record.type !== "A"))
  throw new Error("A different DNS record already uses this hostname.");
if (records.length > 1) throw new Error("Multiple A records already use this hostname.");

const record = { type: "A", name: domain, content: originIp, ttl: 1, proxied: true };
if (records.length === 0) {
  await api(`/zones/${zone.id}/dns_records`, { method: "POST", body: JSON.stringify(record) });
  console.log(`Created DNS record for ${domain}.`);
} else if (records[0].content === originIp && records[0].proxied) {
  console.log(`DNS record for ${domain} is current.`);
} else {
  throw new Error(
    "The existing A record differs from the intended origin; review it before changing DNS.",
  );
}
