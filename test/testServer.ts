import boxen from "boxen";
import { expect } from "chai";
import { existsSync, rmdirSync, unlinkSync } from "fs";
import { Context, Suite } from "mocha";
import path from "path";
import sinon from "sinon";

import { createVault } from "../src/app";
import { getFFMpegURL, getFFProbeURL } from "../src/binaries/ffmpeg-download";
import { ensureIzzyExists, izzyVersion, resetIzzy, spawnIzzy } from "../src/binaries/izzy";
import { getConfig, loadTestConfig, resetLoadedConfig } from "../src/config";
import defaultConfig from "../src/config/default";
import { loadStores } from "../src/database";
import { ensureIndices } from "../src/search";
import { downloadFFLibs } from "../src/setup";
import { writeFileAsync } from "../src/utils/fs/async";
import VERSION from "../src/version";
import { Vault } from "./../src/app";
import { IConfig } from "./../src/config/schema";

const port = 5000;
const testConfigPath = "config.testenv.json";

let vault: Vault | null = null;

let exitStub: sinon.SinonStub | null = null;

const log = (...msgs: unknown[]): void => {
  if (!process.env.DEBUG) {
    console.log(...msgs);
  }
};

const testConfig: IConfig = {
  ...defaultConfig,
  binaries: {
    ...defaultConfig.binaries,
    izzyPort: 8500,
  },
  persistence: {
    ...defaultConfig.persistence,
    libraryPath: "test",
  },
  processing: {
    ...defaultConfig.processing,
    generatePreviews: false,
  },
  scan: {
    ...defaultConfig.scan,
    interval: 0,
    scanOnStartup: false,
  },
  server: {
    ...defaultConfig.server,
    port,
  },
};

function cleanupFiles() {
  resetLoadedConfig();

  if (existsSync("test/library")) {
    rmdirSync("test/library", { recursive: true });
  }

  if (existsSync(testConfigPath)) {
    unlinkSync(testConfigPath);
  }

  // Do not delete binaries, so the next run will be faster
}

interface ExtraTestConfig {
  plugins?: Partial<IConfig["plugins"]>;
  matching?: Partial<IConfig["matching"]>;
}

export async function startTestServer(
  this: Suite | Context,
  extraConfig: ExtraTestConfig = {}
): Promise<void> {
  this.timeout(60 * 1000); // time to download binaries

  try {
    if (vault) {
      throw new Error("Test server is already running");
    }

    cleanupFiles();

    const mergedConfig: IConfig = {
      ...testConfig,
      plugins: {
        ...testConfig.plugins,
        ...(extraConfig.plugins || {}),
      },
      matching: {
        ...testConfig.matching,
        ...(extraConfig.matching || {}),
      },
    };

    await writeFileAsync(testConfigPath, JSON.stringify(mergedConfig, null, 2), "utf-8");

    log(`Starting test server on port ${port}`);

    console.log(`Starting test server on port ${port}`);

    exitStub = sinon.stub(process, "exit");

    resetLoadedConfig();
    await loadTestConfig();
    const config = getConfig();
    expect(!!config).to.be.true;

    log(`Env: ${process.env.NODE_ENV}`);
    log(config);

    if (!existsSync(path.basename(getFFMpegURL())) || !path.basename(getFFProbeURL())) {
      await downloadFFLibs(config);
    }
    await ensureIzzyExists();
    log("Downloaded binaries");

    vault = createVault();

    await vault.startServer(port);

    log(`Server running on port ${port}`);

    vault.setupMessage = "Loading database...";
    if (await izzyVersion()) {
      log("Izzy already running, clearing...");
      await resetIzzy();
    } else {
      log("Spawning Izzy");
      await spawnIzzy();
    }

    try {
      await loadStores();
    } catch (error) {
      const _err = <Error>error;
      console.error(_err);
      console.error(`Error while loading database: ${_err.message}`);
      console.warn("Try restarting, if the error persists, your database may be corrupted");
      process.exit(1);
    }

    vault.setupMessage = "Loading search engine...";
    try {
      // Clear indices for every test
      await ensureIndices(true);
    } catch (error) {
      process.exit(1);
    }

    vault.serverReady = true;
    const protocol = config.server.https.enable ? "https" : "http";

    log(
      boxen(`TEST PORN VAULT ${VERSION} READY\nOpen ${protocol}://localhost:${port}/`, {
        padding: 1,
        margin: 1,
      })
    );

    const exitStubWasCalled = exitStub.called;
    exitStub?.restore();

    if (exitStubWasCalled) {
      throw new Error("Exit stub was called while setting up test environment");
    }
  } catch (error) {
    exitStub?.restore();

    console.error("Error setting up test environment");
    console.error(error);
    process.exit(1);
  }
}

export function stopTestServer(): void {
  cleanupFiles();

  if (vault) {
    log("Closing test server");
    vault.close();
    vault = null;
  }
}
