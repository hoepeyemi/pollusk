import express from "express";
import { runAlertsCheck } from "./runCheck.js";
import { writeRuleOnChain } from "./writeOnChain.js";
import { getConfig } from "./config.js";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError) {
      return res.status(400).json({ error: "Invalid JSON", details: err.message });
    }
    next(err);
  });

  app.post("/run-check", async (_req, res) => {
    try {
      const config = getConfig();
      const result = await runAlertsCheck(config);
      const serialized = {
        ...result,
        triggered: result.triggered.map(({ rule, currentPrice, triggered: t }) => ({
          rule: { ...rule, targetPriceUsd: Number(rule.targetPriceUsd) },
          currentPrice,
          triggered: t,
        })),
      };
      res.json({ ok: true, ...serialized });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.post("/write-alert", async (req, res) => {
    try {
      const config = getConfig();
      const body = req.body as { id?: string; asset?: string; condition?: string; targetPriceUsd?: number; createdAt?: number };
      if (!body.id || !body.asset || !body.condition || body.targetPriceUsd == null || body.createdAt == null) {
        return res.status(400).json({ error: "Missing id, asset, condition, targetPriceUsd, createdAt" });
      }
      const id = body.id.startsWith("0x") ? (body.id as `0x${string}`) : (`0x${body.id}` as `0x${string}`);
      const hash = await writeRuleOnChain(config, {
        id,
        asset: body.asset,
        condition: body.condition,
        targetPriceUsd: body.targetPriceUsd,
        createdAt: body.createdAt,
      });
      if (hash instanceof Error) {
        return res.status(400).json({ error: hash.message });
      }
      res.json({ ok: true, txHash: hash });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? String(e) });
    }
  });

  return app;
}
