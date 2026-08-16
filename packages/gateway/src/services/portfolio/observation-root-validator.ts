import { lstatSync, statSync } from "node:fs";

import { validateProjectRoot } from "../../lib/safe-resolve.js";
import { PortfolioObservationError, type ApprovedProjectRootIdentity } from "./observation-contract.js";
import type { ProjectRootValidator } from "./observation-service.js";

/** Production-only root validator; profile identity comes from filesystem truth. */
export class ApprovedProjectRootValidator implements ProjectRootValidator {
  validate(projectRoot: string): ApprovedProjectRootIdentity {
    try {
      if (lstatSync(projectRoot).isSymbolicLink()) {
        throw new PortfolioObservationError("PORTFOLIO_OBSERVATION_PROJECT_ROOT_SYMLINK_ESCAPE");
      }
      const canonicalPath = validateProjectRoot(projectRoot);
      const metadata = statSync(canonicalPath);
      return { canonicalPath, device: metadata.dev, inode: metadata.ino };
    } catch (error) {
      if (error instanceof PortfolioObservationError) throw error;
      throw new PortfolioObservationError("PORTFOLIO_OBSERVATION_PROJECT_ROOT_DENIED");
    }
  }
}
