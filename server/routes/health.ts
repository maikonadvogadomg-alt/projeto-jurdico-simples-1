import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = { status: "ok" as const }; // 28/10: sem o pacote @workspace/api-zod (que nem vinha no zip)
  res.json(data);
});

export default router;
