/** Where a model runs: in the browser, on a server on this machine, or in a cloud you pay with your key. */
export type Tier = "browser" | "local" | "cloud";

/** One answer from a vision model, and where it ran. */
export interface Seen {
  text: string;
  provider: string;
  tier: Tier;
  model: string;
  ms: number;
}

/** A vision model that foxlens can show a screenshot to. */
export interface Eyes {
  readonly name: string;
  /** False for a captioner that cannot point at an element, such as trial.ml image-to-text. */
  readonly canPoint: boolean;
  ask(image: string, prompt: string, options: { json?: boolean; signal?: AbortSignal }): Promise<Seen>;
}

/** Where the screenshot went. `leftDevice` is true only for the cloud tier. */
export interface Privacy {
  tier: Tier;
  provider: string;
  model: string;
  leftDevice: boolean;
}

const REACH: Record<Tier, number> = { browser: 0, local: 1, cloud: 2 };

/** Where the screenshot went over one or more calls: the most remote call wins. */
export function privacyOf(...calls: Seen[]): Privacy {
  const far = calls.reduce((a, b) => (REACH[b.tier] > REACH[a.tier] ? b : a));
  return { tier: far.tier, provider: far.provider, model: far.model, leftDevice: calls.some((c) => c.tier === "cloud") };
}
