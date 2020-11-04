import boxen from "boxen";
import express from "express";
import { existsSync, readFileSync } from "fs";
import https from "https";
import LRU from "lru-cache";
import moment from "moment";
import * as path from "path";

import { createBackup } from "./backup";
import { giannaVersion, resetGianna, spawnGianna } from "./binaries/gianna";
import { izzyVersion, resetIzzy, spawnIzzy } from "./binaries/izzy";
import { getConfig, watchConfig } from "./config/index";
import BROKEN_IMAGE from "./data/broken_image";
import { loadStores, sceneCollection } from "./database/index";
import { mountApolloServer } from "./middlewares/apollo";
import cors from "./middlewares/cors";
import { checkPassword, passwordHandler } from "./middlewares/password";
import queueRouter from "./queue_router";
import { tryStartProcessing } from "./queue/processing";
import mediaRouter from "./routers/media";
import scanRouter from "./routers/scan";
import { applyFlagRoute, applyStaticRoutes } from "./routers/static";
import { scanFolders, scheduleNextScan } from "./scanner";
import { buildIndices } from "./search";
import Actor from "./types/actor";
import Scene, { runFFprobe } from "./types/scene";
import SceneView from "./types/watch";
import * as logger from "./utils/logger";
import { httpLog } from "./utils/logger";
import { createObjectSet } from "./utils/misc";
import { renderHandlebars } from "./utils/render";
import VERSION from "./version";

const cache = new LRU({
  max: 500,
  maxAge: 3600 * 1000,
});

let serverReady = false;
let setupMessage = "Setting up...";

export default async (): Promise<void> => {
  logger.message("Check https://github.com/boi123212321/porn-vault for discussion & updates");

  const app = express();
  app.use(express.json());
  app.use(cors);

  app.use(httpLog);

  app.get("/version", (req, res) => {
    res.json({
      result: VERSION,
    });
  });

  app.get("/label-usage/scenes", async (req, res) => {
    const cached = cache.get("scene-label-usage");
    if (cached) {
      logger.log("Using cached scene label usage");
      return res.json(cached);
    }
    const scores = await Scene.getLabelUsage();
    if (scores.length) {
      logger.log("Caching scene label usage");
      cache.set("scene-label-usage", scores);
    }
    res.json(scores);
  });

  app.get("/label-usage/actors", async (req, res) => {
    const cached = cache.get("actor-label-usage");
    if (cached) {
      logger.log("Using cached actor label usage");
      return res.json(cached);
    }
    const scores = await Actor.getLabelUsage();
    if (scores.length) {
      logger.log("Caching actor label usage");
      cache.set("actor-label-usage", scores);
    }
    res.json(scores);
  });

  app.get("/setup", (req, res) => {
    res.json({
      serverReady,
      setupMessage,
    });
  });

  app.get("/", async (req, res, next) => {
    if (serverReady) {
      next();
    } else {
      res.status(404).send(
        await renderHandlebars("./views/setup.html", {
          message: setupMessage,
        })
      );
    }
  });

  app.get("/broken", (_, res) => {
    const b64 = BROKEN_IMAGE;

    const img = Buffer.from(b64, "base64");

    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": img.length,
    });
    res.end(img);
  });

  const config = getConfig();

  const port = config.server.port || 3000;

  if (config.server.https.enable) {
    if (!config.server.https.key || !config.server.https.certificate) {
      console.error("Missing HTTPS key or certificate");
      process.exit(1);
    }

    https
      .createServer(
        {
          key: readFileSync(config.server.https.key),
          cert: readFileSync(config.server.https.certificate),
        },
        app
      )
      .listen(port, () => {
        logger.message(`HTTPS Server running on Port ${port}`);
      });
  } else {
    app.listen(port, () => {
      logger.message(`Server running on Port ${port}`);
    });
  }

  applyFlagRoute(app);
  applyStaticRoutes(app);

  app.get("/password", checkPassword);

  app.use(passwordHandler);

  app.get("/", async (req, res) => {
    const file = path.join(process.cwd(), "app/dist/index.html");

    if (existsSync(file)) res.sendFile(file);
    else {
      return res.status(404).send(
        await renderHandlebars("./views/error.html", {
          code: 404,
          message: `File <b>${file}</b> not found`,
        })
      );
    }
  });

  app.use("/media", mediaRouter);

  app.get("/log", (req, res) => {
    res.json(logger.getLog());
  });

  mountApolloServer(app);

  app.use("/queue", queueRouter);

  app.get("/remaining-time", async (_req, res) => {
    const views = createObjectSet(await SceneView.getAll(), "scene");
    if (!views.length) return res.json(null);

    const now = Date.now();
    const numScenes = await sceneCollection.count();
    const viewedPercent = views.length / numScenes;
    const currentInterval = now - views[0].date;
    const fullTime = currentInterval / viewedPercent;
    const remaining = fullTime - currentInterval;
    const remainingTimestamp = now + remaining;
    /* TODO: server side cache result
       clear cache when some scene viewed
    */
    res.json({
      numViews: views.length,
      numScenes,
      viewedPercent,
      remaining,
      remainingSeconds: moment.duration(remaining).asSeconds(),
      remainingDays: moment.duration(remaining).asDays(),
      remainingMonths: moment.duration(remaining).asMonths(),
      remainingYears: moment.duration(remaining).asYears(),
      remainingTimestamp,
      currentInterval,
      currentIntervalDays: moment.duration(currentInterval).asDays(),
    });
  });

  app.use("/scan", scanRouter);

  if (config.persistence.backup.enable === true) {
    setupMessage = "Creating backup...";
    await createBackup(config.persistence.backup.maxAmount || 10);
  }

  setupMessage = "Loading database...";
  if (await izzyVersion()) {
    logger.log("Izzy already running, clearing...");
    await resetIzzy();
  } else {
    await spawnIzzy();
  }

  try {
    await loadStores();
  } catch (error) {
    const _err = <Error>error;
    logger.error(_err);
    logger.error(`Error while loading database: ${_err.message}`);
    logger.warn("Try restarting, if the error persists, your database may be corrupted");
    process.exit(1);
  }

  app.get("/ffprobe/:scene", async (req, res) => {
    const scene = await Scene.getById(req.params.scene);

    if (!scene || !scene.path) {
      return res.sendStatus(404);
    }

    res.json({
      result: await runFFprobe(scene.path),
    });
  });

  setupMessage = "Loading search engine...";
  if (await giannaVersion()) {
    logger.log("Gianna already running, clearing...");
    await resetGianna();
  } else {
    await spawnGianna();
  }

  try {
    setupMessage = "Building search indices...";
    await buildIndices();
  } catch (error) {
    const _err = <Error>error;
    logger.error(_err);
    logger.error(`Error while indexing items: ${_err.message}`);
    logger.warn("Try restarting, if the error persists, your database may be corrupted");
    process.exit(1);
  }

  serverReady = true;

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

    logger.warn("Scanning folders is currently disabled. Enable in config.json & restart.");
    tryStartProcessing().catch((err: Error) => {
      logger.error("Couldn't start processing...");
      logger.error(err.message);
    });
  }

  app.use(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (err: number, req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (typeof err === "number") return res.sendStatus(err);
      return res.sendStatus(500);
    }
  );
};
