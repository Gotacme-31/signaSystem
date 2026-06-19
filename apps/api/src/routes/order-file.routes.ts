import { Router } from "express";
import { auth } from "../middlewares/auth";
import {
  deleteOrderFileController,
  downloadOrderFileController,
  listOrderFilesController,
  orderFileUploadMiddleware,
  uploadOrderFileController,
} from "../controllers/order-file.controller";

const router = Router({ mergeParams: true });

router.post("/", auth, orderFileUploadMiddleware, uploadOrderFileController);
router.get("/", auth, listOrderFilesController);
router.get("/:fileId/download", auth, downloadOrderFileController);
router.delete("/:fileId", auth, deleteOrderFileController);

export default router;
