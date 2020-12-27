import Axios from "axios";
import boxen from "boxen";
import { readFileSync } from "fs";

import { createVault, Vault } from "./app";
import argv from "./args";
import { createBackup } from "./backup";
import {
  exitIzzy,
  izzyHasMinVersion,
  izzyProcess,
  izzyVersion,
  minIzzyVersion,
  spawnIzzy,
} from "./binaries/izzy";
import { getConfig, watchConfig } from "./config";
import { loadStores } from "./database";
import { tryStartProcessing } from "./queue/processing";
import { scanFolders, scheduleNextScan } from "./scanner";
import { ensureIndices } from "./search";
import * as logger from "./utils/logger";
import VERSION from "./version";

export default async (): Promise<Vault> => {
  logger.message("Check https://github.com/porn-vault/porn-vault for discussion & updates");

  const config = getConfig();
  const port = config.server.port || 3000;
  const vault = createVault();

  if (config.server.https.enable) {
    if (!config.server.https.key || !config.server.https.certificate) {
      console.error("Missing HTTPS key or certificate");
      process.exit(1);
    }

    const httpsOpts = {
      key: readFileSync(config.server.https.key),
      cert: readFileSync(config.server.https.certificate),
    };

    await vault.startServer(port, httpsOpts);
    logger.message(`HTTPS Server running on port ${port}`);
  } else {
    await vault.startServer(port);
    logger.message(`Server running on port ${port}`);
  }

  if (config.persistence.backup.enable === true) {
    vault.setupMessage = "Creating backup...";
    await createBackup(config.persistence.backup.maxAmount || 10);
  }

  try {
    vault.setupMessage = "Pinging Elasticsearch...";
    await Axios.get(config.search.host);
  } catch (error) {
    const _err: Error = error;
    logger.error(`Error pinging Elasticsearch @ ${config.search.host}: ${_err.message}`);
    process.exit(1);
  }

  logger.message("Loading database");
  vault.setupMessage = "Loading database...";

  async function checkIzzyVersion() {
    if (!(await izzyHasMinVersion())) {
      logger.error(`Izzy does not satisfy min version: ${minIzzyVersion}`);
      logger.message(
        "Use --update-izzy, delete izzy(.exe) and restart or download manually from https://github.com/boi123212321/izzy/releases"
      );
      logger.log("Killing izzy...");
      izzyProcess.kill();
      process.exit(1);
    }
  }

  if (await izzyVersion()) {
    await checkIzzyVersion();
    logger.message(`Izzy already running (on port ${config.binaries.izzyPort})...`);
    if (argv["reset-izzy"]) {
      logger.warn("Resetting izzy...");
      await exitIzzy();
      await spawnIzzy();
    }
  } else {
    await spawnIzzy();
  }
  await checkIzzyVersion();

  try {
    await loadStores();
  } catch (error) {
    const _err = <Error>error;
    logger.error(`Error while loading database: ${_err.message}`);
    logger.error("Try restarting, if the error persists, your database may be corrupted");
    logger.log(_err.stack);
    process.exit(1);
  }

  try {
    logger.message("Loading search engine");
    vault.setupMessage = "Loading search engine...";
    await ensureIndices(argv.reindex || false);
  } catch (error) {
    const _err = <Error>error;
    logger.error(`Error while loading search engine: ${_err.message}`);
    logger.log(_err.stack);
    process.exit(1);
  }

  vault.serverReady = true;

  const protocol = config.server.https.enable ? "https" : "http";

  console.log(
    boxen(`PORN VAULT ${VERSION} READY\nOpen ${protocol}://localhost:${port}/`, {
      padding: 1,
      margin: 1,
    })
  );

  watchConfig();

  if (config.scan.scanOnStartup) {
    // Scan and auto schedule next scans
    scanFolders(config.scan.interval).catch((err: Error) => {
      logger.error(err.message);
    });
  } else {
    // Only schedule next scans
    scheduleNextScan(config.scan.interval);

    logger.warn("Scanning folders is currently disabled.");
    tryStartProcessing().catch((err: Error) => {
      logger.error("Couldn't start processing...");
      logger.error(err.message);
    });
  }

  return vault;
};
