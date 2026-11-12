// A Pi extension, shipped inside Harf, that makes images with Pi's own
// image models (Pi's chat API has no way to ask for one).
//
// It adds:
//   - the generate_image tool, which saves the image in the working folder
//     and returns its path, relative to that folder;
//   - the --harf-image-model flag, the provider/id used when the tool call
//     names no model;
//   - /harf-image-models, which reports the image models Pi has
//     credentials for as one JSON notification;
//   - /harf-generate-image <prompt>, which makes an image without a chat
//     model and reports {"paths": [...]} or {"error": "..."} the same way.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";

const FOLDER = "images";
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

const id = (m) => `${m.provider}/${m.id}`;

async function pickModel(registry, wanted) {
  const models = await registry.getAvailableOfType("image");
  if (models.length === 0) {
    throw new Error("No image model is available. Sign in to a provider with image models in Pi (OpenRouter, or set OPENROUTER_API_KEY) to make images in Harf.");
  }
  if (!wanted) return models[0];
  const m = models.find((m) => id(m) === wanted);
  if (!m) {
    throw new Error(`The image model ${wanted} is not available. Available: ${models.map(id).join(", ")}`);
  }
  return m;
}

function slug(text) {
  const s = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 6).join("-");
  return s.slice(0, 40).replace(/-+$/, "") || "image";
}

// save writes each image under images/ without replacing an existing file
// and returns the paths relative to dir.
function save(dir, prompt, blocks) {
  mkdirSync(join(dir, FOLDER), { recursive: true });
  const base = slug(prompt);
  const paths = [];
  for (const b of blocks) {
    const ext = EXT[b.mimeType];
    if (!ext) continue;
    for (let n = 1; ; n++) {
      const rel = `${FOLDER}/${base}-${n}.${ext}`;
      try {
        writeFileSync(join(dir, rel), Buffer.from(b.data, "base64"), { flag: "wx" });
        paths.push(rel);
        break;
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
      }
    }
  }
  return paths;
}

async function generate(ctx, pi, args, signal) {
  const model = await pickModel(ctx.modelRegistry, args.model || pi.getFlag("harf-image-model"));
  let text = args.prompt;
  if (args.aspect_ratio) text += `\n\nAspect ratio: ${args.aspect_ratio}.`;
  const res = await ctx.modelRegistry.generateImages(model, { input: [{ type: "text", text }] }, { signal });
  if (res.stopReason !== "stop") {
    throw new Error(`${id(model)} made no image: ${res.errorMessage || res.stopReason}`);
  }
  const paths = save(ctx.cwd, args.prompt, res.output.filter((b) => b.type === "image"));
  if (paths.length === 0) {
    const said = res.output.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    throw new Error(`${id(model)} returned no image${said ? `: ${said}` : ""}`);
  }
  return { model: id(model), paths, usage: res.usage };
}

export default function (pi) {
  pi.registerFlag("harf-image-model", { type: "string", description: "Image model (provider/id) for generate_image" });

  pi.registerTool({
    name: "generate_image",
    label: "Generate image",
    description:
      "Make an image from a text description with an image generation model. The image is saved in the working folder " +
      "and its path, relative to that folder, is returned.",
    promptSnippet: "generate_image: make a picture from a description",
    promptGuidelines: [
      "Use generate_image when the user asks for a picture, photo, illustration or artwork, then embed the returned path in your reply with Markdown: ![description](images/name-1.png).",
    ],
    parameters: Type.Object({
      prompt: Type.String({ description: "What the image shows, in detail: subject, style, colours, composition" }),
      aspect_ratio: Type.Optional(Type.String({ description: "Shape of the image, such as 1:1, 16:9 or 9:16" })),
      model: Type.Optional(Type.String({ description: "Image model as provider/id; leave out to use the configured one" })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const r = await generate(ctx, pi, params, signal);
      const list = r.paths.map((p) => `- ${p}`).join("\n");
      return {
        content: [{ type: "text", text: `Saved with ${r.model}:\n${list}\nShow it in your reply with Markdown, for example ![${params.prompt.slice(0, 60)}](${r.paths[0]}).` }],
        details: { model: r.model, paths: r.paths },
        ...(r.usage ? { usage: r.usage } : {}),
      };
    },
  });

  pi.registerCommand("harf-image-models", {
    description: "Report the image models Pi has credentials for, as JSON",
    handler: async (_args, ctx) => {
      const models = await ctx.modelRegistry.getAvailableOfType("image");
      ctx.ui.notify(JSON.stringify({ models: models.map((m) => ({ id: id(m), name: m.name, provider: m.provider })) }), "info");
    },
  });

  pi.registerCommand("harf-generate-image", {
    description: "Make an image from the rest of the line, with no chat model",
    handler: async (args, ctx) => {
      try {
        const r = await generate(ctx, pi, { prompt: args.trim() }, ctx.signal);
        ctx.ui.notify(JSON.stringify({ model: r.model, paths: r.paths }), "info");
      } catch (e) {
        ctx.ui.notify(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), "error");
      }
    },
  });
}
