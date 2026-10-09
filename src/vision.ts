import type { Message, Mind } from "foxmind";
import { api, type LensBrowser } from "./browser.js";
import type { Capture } from "./capture.js";
import { FoxlensError } from "./errors.js";
import { privacyOf, type Eyes, type Privacy } from "./eyes.js";

/** Throws when a chat provider in the Mind is on the cloud tier and the caller did not allow it. */
export function guardCloud(mind: Mind, allowCloud = false): void {
  const cloud = mind.providers.filter((p) => p.tier === "cloud" && p.capabilities.includes("chat")).map((p) => p.name);
  if (cloud.length && !allowCloud) {
    throw new FoxlensError("cloud_not_allowed", `The Mind can send the screenshot to a cloud provider (${cloud.join(", ")}). Pass allowCloud: true to allow it, or use only browser and local providers.`);
  }
}

/**
 * A vision chat model through a foxmind Mind: a local server (Ollama, llama-server,
 * LM Studio) or your own cloud key on an OpenAI-compatible API. The screenshot goes
 * out as an OpenAI `image_url` content part, so the model must take images.
 */
export function mindEyes(mind: Mind, options: { allowCloud?: boolean; maxTokens?: number } = {}): Eyes {
  return {
    name: "foxmind",
    canPoint: true,
    async ask(image, prompt, { signal }) {
      guardCloud(mind, options.allowCloud);
      // foxmind types content as a string; OpenAI-compatible providers send it on unchanged.
      const content = [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: image } }] as unknown as string;
      const messages: Message[] = [{ role: "user", content }];
      const reply = await mind.chat(messages, { temperature: 0, maxTokens: options.maxTokens ?? 2048, ...(signal ? { signal } : {}) });
      return { text: reply.message.content ?? "", provider: reply.provider, tier: reply.tier, model: reply.model, ms: reply.ms };
    },
  };
}

interface TrialMl {
  createEngine(options: Record<string, unknown>): Promise<unknown>;
  runEngine(request: { args: unknown[]; options?: Record<string, unknown> }): Promise<unknown>;
}
let engine: { key: string; ready: Promise<unknown> } | undefined;

/**
 * Firefox's own image-to-text model through `browser.trial.ml`, on the device.
 * It writes a short caption and cannot point at elements. It needs the optional
 * `trialML` permission. Models come only from the Mozilla and Xenova orgs.
 */
export function trialMLEyes(options: { model?: string; device?: "wasm" | "gpu"; browser?: LensBrowser } = {}): Eyes {
  const model = options.model ?? "Mozilla/distilvit";
  const device = options.device ?? "wasm";
  return {
    name: "trialml",
    canPoint: false,
    async ask(image) {
      const browser = options.browser ?? api();
      if (browser.permissions && !(await browser.permissions.contains({ permissions: ["trialML"] }).catch(() => false))) {
        throw new FoxlensError("permission", 'The optional "trialML" permission is not granted. Ask for it with permissions.request from a click.');
      }
      const ml = (browser.trial as { ml?: TrialMl } | undefined)?.ml;
      if (!ml) throw new FoxlensError("unsupported", "browser.trial.ml is missing: this is not Firefox, or trial ML is turned off.");
      const key = `${model}:${device}`;
      if (engine && engine.key !== key) throw new FoxlensError("unsupported", `Firefox allows one trial.ml engine per extension, and ${engine.key} holds it.`);
      const started = Date.now();
      if (!engine) {
        const ready = ml.createEngine({ taskName: "image-to-text", modelHub: "huggingface", modelId: model, device });
        engine = { key, ready };
        ready.catch(() => (engine = undefined));
      }
      let output: unknown;
      try {
        await engine.ready;
        output = await ml.runEngine({ args: [image] });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new FoxlensError("unsupported", `trial.ml image-to-text failed: ${message}`, { cause: error });
      }
      const text = (output as { generated_text?: string }[] | undefined)?.[0]?.generated_text;
      if (typeof text !== "string") throw new FoxlensError("unsupported", `trial.ml returned no caption: ${JSON.stringify(output).slice(0, 200)}`);
      return { text: text.trim(), provider: "trialml", tier: "browser", model, ms: Date.now() - started };
    },
  };
}

export interface DescribeOptions {
  /** A foxmind Mind with a vision chat model. */
  mind?: Mind;
  /** Any vision model, for example `trialMLEyes()`. Used before `mind`. */
  eyes?: Eyes;
  /** Let a Mind send the screenshot to a cloud provider. Default false. */
  allowCloud?: boolean;
  /** The question for a chat model. Captioners ignore it. */
  prompt?: string;
  signal?: AbortSignal;
}

export interface Description {
  text: string;
  privacy: Privacy;
  ms: number;
}

export const DESCRIBE_PROMPT = "Describe this screenshot of a web page for a person who cannot see it. " +
  "Say what the page is for, then list the main text, images and controls from top to bottom. Use short sentences.";

/** The Eyes to use: `eyes` first, then a Mind. */
export function eyesOf(options: { eyes?: Eyes; mind?: Mind; allowCloud?: boolean }): Eyes {
  if (options.eyes) return options.eyes;
  if (!options.mind) throw new FoxlensError("unsupported", "Pass a vision model: mind (a foxmind Mind) or eyes.");
  guardCloud(options.mind, options.allowCloud);
  return mindEyes(options.mind, { allowCloud: options.allowCloud });
}

/** Describes a screenshot (a Capture or a PNG data URL) in words. */
export async function describe(image: Capture | string, options: DescribeOptions): Promise<Description> {
  const eyes = eyesOf(options);
  const seen = await eyes.ask(typeof image === "string" ? image : image.dataUrl, options.prompt ?? DESCRIBE_PROMPT, { signal: options.signal });
  return { text: seen.text.trim(), privacy: privacyOf(seen), ms: seen.ms };
}
