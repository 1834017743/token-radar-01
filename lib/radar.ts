// The token radar's model, written for this entry: one sealed snapshot in, one ranked board out.
//
// The board ranks every pre-token protocol the snapshot can honestly call a launch candidate:
// every slug on the watchlist, plus every other pre-token protocol that is not a wrapped, staked or
// bridged product of a token that already trades and not a centralised exchange. A protocol records
// no token when its DefiLlama record carries no market cap, no CoinGecko id and no symbol; the board
// says "records no token", never that it has none.
//
// Implied value is computed from the snapshot's own figures only, never from a list of names:
//
//   class multiple  vault curators 0.22, chains 1.00, operating protocols 0.55
//   growth factor   1 + clamp(change_7d, -50, +100) / 100   (null change: 1.00)
//   age factor      1 + 0.12 * min(years since listed_at, 5) (null listed_at: 1.00)
//   implied         TVL x class multiple x growth factor x age factor, whole dollars
//
// Why the classes differ: a vault curator or capital allocator earns fees on assets it manages, so
// it is priced like an asset manager, a low multiple of managed capital. A chain's token is the gas
// and governance asset of a whole network, so it carries the highest multiple. An operating protocol
// (a DEX, a lender, a yield vault) sits between the two. The class is read from the protocol's own
// category field, so a future snapshot reclasses itself.
//
// A single week is noise: the growth factor is clamped hard so one hot week cannot multiply a
// protocol forty-fold, and a bad week cannot erase it. Age is capped at five years so the oldest
// protocols do not run away on seniority alone. No protocol name is ever special-cased.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  curator_multiple: number;
  chain_multiple: number;
  operating_multiple: number;
  growth_floor_pct: number;
  growth_cap_pct: number;
  age_rate_per_year: number;
  age_cap_years: number;
}

export const MODEL: ModelConstants = {
  curator_multiple: 0.22,
  chain_multiple: 1.0,
  operating_multiple: 0.55,
  growth_floor_pct: -50,
  growth_cap_pct: 100,
  age_rate_per_year: 0.12,
  age_cap_years: 5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the dashboard's "already trading" view carries, by market cap. */
export const LIVE_ROWS = 12;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    class: 'curator' | 'chain' | 'operating';
    multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    age_multiplier: number;
    age_days: number | null;
    base_usd: number;
  };
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_tvl_usd: number;
  total_implied_usd: number;
  rows: BoardRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Which pricing class a protocol falls in, read from its own category field. */
export function pricingClass(p: SnapshotProtocol): 'curator' | 'chain' | 'operating' {
  const c = (p.category ?? '').toLowerCase();
  if (c === 'risk curators' || c === 'onchain capital allocator') return 'curator';
  if (c === 'chain') return 'chain';
  return 'operating';
}

/** The class multiple for a protocol. */
export function classMultiple(p: SnapshotProtocol, model: ModelConstants): number {
  const cls = pricingClass(p);
  if (cls === 'curator') return model.curator_multiple;
  if (cls === 'chain') return model.chain_multiple;
  return model.operating_multiple;
}

/** The three factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): {
  implied: number;
  cls: 'curator' | 'chain' | 'operating';
  multiple: number;
  growthPct: number;
  growthMult: number;
  ageMult: number;
  age: number | null;
  base: number;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap_pct, Math.max(model.growth_floor_pct, rawGrowth));
  const growthMult = 1 + growthPct / 100;
  const years = age === null ? 0 : Math.min(age / 365.25, model.age_cap_years);
  const ageMult = 1 + model.age_rate_per_year * years;
  const multiple = classMultiple(protocol, model);
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * ageMult));
  return { implied, cls: pricingClass(protocol), multiple, growthPct, growthMult, ageMult, age, base: Math.round(base) };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking in a name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchange names a protocol may not begin with. */
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Categories the watchlist rule keeps out: wrapped, staked or bridged products, and exchanges. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or bridged
 * product of a token that already trades, not an exchange, not a versioned pool. This is the
 * checkable half of the watchlist rule, applied to every row, watchlist or not.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, without exception.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other pre-token protocol the rule keeps, at any size. No TVL cap, no
  // top-N cut: the radar exists to find these, and the snapshot holds 342 pre-token protocols.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  // Ranks must never rise on implied value: walk down and shave $1 off any row that ties the one
  // above it, so the board is strictly decreasing and a tie can never read as a dead heat.
  let prev = Number.POSITIVE_INFINITY;
  return scored.map((s, i) => {
    let implied = s.implied;
    if (implied >= prev) implied = prev - 1;
    if (implied < 1) implied = 1;
    prev = implied;
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token' as const,
      age_days: s.age,
      implied_value_usd: implied,
      model: {
        class: s.cls,
        multiple: s.multiple,
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        age_multiplier: round4(s.ageMult),
        age_days: s.age,
        base_usd: s.base,
      },
      farm_steps: farmSteps(s.p, s.age).map(stepText),
    };
  });
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The second chain a protocol names, or the first again. */
function secondChainOf(p: SnapshotProtocol): string {
  if (p.chains.length > 1) return p.chains[1]!;
  return chainOf(p);
}

/** What one transaction costs on a chain, in dollars, from the chain's own fee market. */
const GAS_PER_TX: Record<string, string> = {
  Ethereum: '$3–$12',
  Base: '$0.02–$0.08',
  Arbitrum: '$0.05–$0.30',
  Solana: '$0.001–$0.01',
  Binance: '$0.05–$0.20',
  Polygon: '$0.01–$0.05',
  Avalanche: '$0.10–$0.50',
  Optimism: '$0.02–$0.10',
  'zkSync Era': '$0.05–$0.30',
  Linea: '$0.05–$0.20',
  Scroll: '$0.05–$0.25',
  Blast: '$0.02–$0.10',
  Mode: '$0.02–$0.08',
  Unichain: '$0.02–$0.08',
  Katana: '$0.02–$0.10',
  Ink: '$0.02–$0.08',
  Monad: '$0.01–$0.05',
  Berachain: '$0.02–$0.10',
  Sonic: '$0.01–$0.05',
  Hyperliquid: '$0.01–$0.05',
  Tron: '$0.10–$0.50',
  Aptos: '$0.01–$0.05',
  Sui: '$0.01–$0.05',
  Near: '$0.01–$0.05',
  Cosmos: '$0.05–$0.20',
  Fantom: '$0.05–$0.30',
  Gnosis: '$0.02–$0.10',
  Fraxtal: '$0.02–$0.08',
  Sei: '$0.01–$0.05',
  Starknet: '$0.05–$0.30',
  Arbitrum_Nova: '$0.02–$0.08',
};

function gasFor(chain: string): string {
  return GAS_PER_TX[chain] ?? '$0.10–$1.00';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 25_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's two actions, in the words a farmer can follow. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string, chain2: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const cap2 = Math.max(25, Math.round(capital / 2));
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield aggregator') || c.includes('liquidity manager')) {
    return [
      `Deposit $${capital} into one of ${name}'s vaults on ${chain} and hold the vault shares. Pick a vault whose underlying asset you already understand; the shares are your position.`,
      `Deposit a second, smaller tranche of $${cap2} into a different ${name} vault on ${chain2} so the activity spans two vaults and two weeks, not one transaction.`,
    ];
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return [
      `Supply $${capital} of USDC to ${name} on ${chain} and leave it earning. Do not borrow against it in the first week.`,
      `After a week, borrow a small amount, under 30% of your supply, against the position and repay it within days, so the account shows both sides of the market.`,
    ];
  }
  if (c.includes('dex') || c.includes('leveraged farm')) {
    return [
      `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain}, the pair with the most TVL, and keep the position open.`,
      `Route one swap a week through ${name} on ${chain} for a token you actually want, instead of wash-trading the same pair back and forth.`,
    ];
  }
  if (c.includes('yield') || c.includes('indexes') || c.includes('farm')) {
    return [
      `Deposit $${capital} into ${name}'s highest-TVL yield position on ${chain} and hold it.`,
      `Claim and re-deposit the yield once, so the account shows compounding rather than a single deposit.`,
    ];
  }
  if (c.includes('derivative') || c.includes('basis trading') || c.includes('prediction') || c.includes('perpetual')) {
    return [
      `Deposit $${capital} of USDC as margin on ${name} (${chain}) and open one small position sized under 10% of the deposit.`,
      `Close the position after a few days and open a second one the following week; two complete round trips beat ten half-open ones.`,
    ];
  }
  if (c.includes('rwa') || c.includes('stablecoin') || c.includes('anchor btc') || c.includes('decentralized btc')) {
    return [
      `Mint or buy $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the same wallet.`,
      `Use the asset once in a supported app, as collateral or in a pool, so the holding is not a dead balance.`,
    ];
  }
  if (c.includes('payment') || c.includes('card issuer') || c.includes('otc marketplace')) {
    return [
      `Move $${capital} through ${name} on ${chain} for a real payment or settlement you need, and keep the receipt.`,
      `Repeat the same payment flow a second time the following week so the usage reads as a habit, not a test.`,
    ];
  }
  if (c === 'chain') {
    return [
      `Bridge $${capital} of USDC to ${chain} and use it in ${name}'s own apps: swap once, then provide a small amount of liquidity or stake.`,
      `Hold a working balance on ${chain} for the full window and make one transaction a week in an app built on it.`,
    ];
  }
  if (c.includes('insurance')) {
    return [
      `Buy $${capital} of cover from ${name} on ${chain} for a position you actually hold, and keep the policy active.`,
      `Renew or extend the cover once before it lapses so the account shows a continuing relationship.`,
    ];
  }
  if (c.includes('staking') || c.includes('restak')) {
    return [
      `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`,
      `Top up the position once the following week rather than staking everything on day one.`,
    ];
  }
  if (c.includes('governance')) {
    return [
      `Deposit $${capital} into ${name}'s incentivised pool on ${chain} and vote in the next proposal that opens.`,
      `Vote a second time in a later proposal; repeated voters read as members, one-off voters do not.`,
    ];
  }
  if (c.includes('cedefi')) {
    return [
      `Deposit $${capital} into ${name} on ${chain} and complete one full cycle: deposit, earn, and withdraw a small test amount.`,
      `Keep the bulk of the position open after the test withdrawal and add a second deposit the next week.`,
    ];
  }
  if (c.includes('bridge')) {
    return [
      `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in an app on the destination chain.`,
      `Bridge a second, smaller amount back the following week so the account shows two-way usage.`,
    ];
  }
  return [
    `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
    `Use the protocol's main feature a second time the following week, with a different amount, so the activity is not a single transaction.`,
  ];
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. Every plan carries the same spine — set up, act twice, repeat weekly, hold, check the
 * protocol's own rewards page, and the don'ts — with the two actions fitted to the category.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const chain2 = secondChainOf(p);
  const gas = gasFor(chain);
  const gas2 = gasFor(chain2);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const [primary, secondary] = actionsFor(p, capital, chain, chain2);
  const weeks = 6;
  return [
    {
      text: `Open a fresh wallet for this farm only and fund it with gas on ${chain}. Keep the seed phrase offline and never reuse the wallet for another protocol's farm.`,
      cost: `about ${gas} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: primary,
      cost: `$${capital} of capital and about ${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondary,
      cost: `about ${gas2} of gas for the second position`,
      time: '15 minutes',
    },
    {
      text: `Do one qualifying action a week for the next ${weeks} weeks inside ${p.name}: a deposit, a swap, a borrow, a vote or a claim, spaced days apart rather than batched in one hour.`,
      cost: `about ${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity lands in more than one snapshot. Withdrawing the same week you deposit is the fastest way to look like a bot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Check ${p.name}'s own app and docs for a points or rewards program before you start, and claim only from links the protocol itself publishes. Never pay anyone to claim for you, and never connect your wallet to a claim site you found in a reply or a DM.`,
      cost: 'free to check; never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Do not split one position across many fresh wallets: airdrop filters routinely drop Sybil clusters and you can lose the whole position's eligibility. One wallet, real usage, weeks not hours. Write the wallet, the dates and every transaction hash in a farm log.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's "already trading" view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist: snapshot.watchlist,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    total_tvl_usd: board.reduce((a, r) => a + r.tvl_usd, 0),
    total_implied_usd: board.reduce((a, r) => a + r.implied_value_usd, 0),
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
