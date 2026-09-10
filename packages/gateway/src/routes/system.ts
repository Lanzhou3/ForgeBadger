import { Router } from "express";

import { authenticate } from "../auth/middleware.js";
import {
  directoryPickerSupported,
  selectNativeDirectory,
  type NativeDirectoryPickerDeps,
  type DirectoryPickerStatus
} from "../services/native-directory-picker.js";

export interface SystemRouteDeps {
  platform?: NodeJS.Platform;
  picker?: (deps?: NativeDirectoryPickerDeps) => Promise<DirectoryPickerStatus>;
}

export function createSystemRoutes(deps: SystemRouteDeps = {}): Router {
  const router = Router();

  router.use(authenticate);

  router.get("/desktop", (_req, res) => {
    const platform = deps.platform ?? process.platform;
    res.json({
      code: 0,
      data: {
        platform,
        directoryPickerSupported: directoryPickerSupported(platform)
      },
      message: ""
    });
  });

  router.post("/select-directory", async (_req, res) => {
    try {
      const picker = deps.picker ?? selectNativeDirectory;
      const result = await picker(deps.platform !== undefined ? { platform: deps.platform } : {});
      res.json({
        code: 0,
        data: result,
        message: ""
      });
    } catch (error) {
      res.status(500).json({
        code: 1,
        message: error instanceof Error ? error.message : "Failed to select directory"
      });
    }
  });

  return router;
}
