import path from "path";
import { findNodeModulesPaths, getResolutionDirectory } from "./resolution";

export class ResolutionContext {
    readonly vaultRoot: string;
    readonly nodeModulesPaths: string[];
    readonly resolutionDirectory: string;

    constructor(vaultRoot: string, sourceFilePath: string) {
        this.vaultRoot = vaultRoot;
        this.nodeModulesPaths = findNodeModulesPaths(
            vaultRoot,
            path.dirname(sourceFilePath),
        );
        this.resolutionDirectory = getResolutionDirectory(
            this.nodeModulesPaths,
        );
    }

    static forVaultRoot(vaultRoot: string): ResolutionContext {
        return new ResolutionContext(vaultRoot, vaultRoot);
    }
}
