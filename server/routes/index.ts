import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import statusRouter from "./status.js";
import aiRouter from "./ai.js";
import uploadRouter from "./upload.js";
import crudRouter from "./crud.js";
import settingsRouter from "./settings.js";
import jurisprudenciaRouter from "./jurisprudencia.js";
import extraRouter from "./extra.js";
import integracoesRouter from "./integracoes.js";
import authJwtRouter from "./auth-jwt.js";
import prazosRouter from "./prazos.js";
import assinaturaRouter from "./assinatura.js";
import pjeRouter from "./pje.js";
import driveSyncRouter from "./drive-sync.js";
import colaborativoRouter from "./colaborativo.js";
import compatRouter from "./compat.js"; // 🔧 rotas que a tela chamava e não existiam (28/10)

const router: IRouter = Router();

router.use(compatRouter); // primeiro: o /djen/config completo (o do extra.ts só sabia o token)
router.use(healthRouter);
router.use(statusRouter);
router.use(aiRouter);
router.use(uploadRouter);
router.use(crudRouter);
router.use(settingsRouter);
router.use(jurisprudenciaRouter);
router.use(extraRouter);
router.use(integracoesRouter);
router.use(authJwtRouter);
router.use(prazosRouter);
router.use(assinaturaRouter);
router.use(pjeRouter);
router.use(driveSyncRouter);
router.use(colaborativoRouter);

export default router;
