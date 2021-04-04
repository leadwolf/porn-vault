import { Request, Response, Router } from "express";
import ffmpeg from "fluent-ffmpeg";
import path from "path";

import { sceneCollection } from "../database";
import Scene from "../types/scene";
import { handleError, logger } from "../utils/logger";
import {
  audioIsValidForContainer,
  FFProbeContainers,
  getDirectPlayMimeType,
  videoIsValidForContainer,
} from "./../ffmpeg/ffprobe";

export enum SceneStreamTypes {
  DIRECT = "direct",
  MP4 = "mp4",
  WEBM = "webm",
}

const TranscodeCodecs = {
  [SceneStreamTypes.MP4]: {
    video: "-c:v libx264",
    audio: "-c:a aac",
  },
  [SceneStreamTypes.WEBM]: {
    video: "-c:v libvpx-vp9",
    audio: "-c:a libopus",
  },
};

function streamTranscode(
  scene: Scene & { path: string },
  req: Request,
  res: Response,
  outputOptions: string[],
  mimeType: string
): void {
  res.writeHead(200, {
    "Accept-Ranges": "bytes",
    Connection: "keep-alive",
    "Transfer-Encoding": "chunked",
    "Content-Disposition": "inline",
    "Content-Transfer-Enconding": "binary",
    "Content-Type": mimeType,
  });

  const startQuery = (req.query as { start?: string }).start || "0";
  const startSeconds = Number.parseFloat(startQuery);
  if (Number.isNaN(startSeconds)) {
    res.status(400).send(`Could not parse start query as number: ${startQuery}`);
    return;
  }

  outputOptions.unshift(`-ss ${startSeconds}`);

  // Time out the request after 2mn to prevent accumulating
  // too many ffmpeg processes. After that, the user should reload the page
  req.setTimeout(2 * 60 * 1000);

  let command: ffmpeg.FfmpegCommand | null = null;
  let didEnd = false;

  command = ffmpeg(scene.path)
    .outputOption(outputOptions)
    .on("start", (commandLine: string) => {
      logger.verbose(`Spawned Ffmpeg with command: ${commandLine}`);
    })
    .on("end", () => {
      logger.verbose(`Scene "${scene.path}" has been converted successfully`);
      didEnd = true;
    })
    .on("error", (err) => {
      if (!didEnd) {
        handleError(
          `Request finished or an error happened while transcoding scene "${scene.path}"`,
          err
        );
      }
    });

  res.on("close", () => {
    logger.verbose("Stream request closed, killing transcode");
    command?.kill("SIGKILL");
    didEnd = true;
  });

  command.pipe(res, { end: true });
}

function streamDirect(scene: Scene & { path: string }, _: Request, res: Response): Response | void {
  const resolved = path.resolve(scene.path);
  return res.sendFile(resolved);
}

function transcodeWebm(
  scene: Scene & { path: string },
  req: Request,
  res: Response
): Response | void {
  const webmOptions: string[] = [
    "-f webm",
    "-deadline realtime",
    "-cpu-used 5",
    "-row-mt 1",
    "-crf 30",
    "-b:v 0",
  ];

  if (
    scene.meta.videoCodec &&
    videoIsValidForContainer(FFProbeContainers.WEBM, scene.meta.videoCodec)
  ) {
    webmOptions.push("-c:v copy");
  } else {
    webmOptions.push(TranscodeCodecs[SceneStreamTypes.WEBM].video);
  }
  if (
    scene.meta.audioCodec &&
    audioIsValidForContainer(FFProbeContainers.WEBM, scene.meta.audioCodec)
  ) {
    webmOptions.push("-c:a copy");
  } else {
    webmOptions.push(TranscodeCodecs[SceneStreamTypes.WEBM].audio);
  }

  return streamTranscode(
    scene,
    req,
    res,
    webmOptions,
    getDirectPlayMimeType(FFProbeContainers.WEBM)
  );
}

function transcodeMp4(
  scene: Scene & { path: string },
  req: Request,
  res: Response
): Response | void {
  const isMP4VideoValid =
    scene.meta.videoCodec && videoIsValidForContainer(FFProbeContainers.MP4, scene.meta.videoCodec);
  const isMP4AudioValid =
    scene.meta.audioCodec && audioIsValidForContainer(FFProbeContainers.MP4, scene.meta.audioCodec);

  // If the video codec is not valid for mp4, that means we can't just copy
  // the video stream. We should just transcode with webm
  if (!isMP4VideoValid) {
    return res.status(400).send(`Video codec "${scene.meta.videoCodec}" is not valid for mp4`);
  }

  const mp4Options = [
    "-f mp4",
    "-c:v copy",
    "-movflags frag_keyframe+empty_moov+faststart",
    "-preset veryfast",
    "-crf 18",
  ];

  mp4Options.push(isMP4AudioValid ? "-c:a copy" : TranscodeCodecs[SceneStreamTypes.MP4].audio);

  return streamTranscode(scene, req, res, mp4Options, getDirectPlayMimeType(FFProbeContainers.MP4));
}

export enum SceneStreamTypes {
  DIRECT = "direct",
  MP4 = "mp4",
  MKV = "mkv",
  WEBM = "webm",
}

const router = Router();

router.get("/:scene", async (req, res, next) => {
  const sc = await Scene.getById(req.params.scene);
  if (!sc || !sc.path) {
    return next(404);
  }
  const scene = sc as Scene & { path: string };

  const streamType = (req.query as { type?: SceneStreamTypes }).type;

  if (!streamType || streamType === SceneStreamTypes.DIRECT) {
    return streamDirect(scene, req, res);
  }

  try {
    if (!scene.meta.container || !scene.meta.videoCodec || !scene.meta.audioCodec) {
      logger.verbose(
        `Scene ${scene._id} doesn't have codec information to determine supported transcodes, running ffprobe`
      );
      await Scene.runFFProbe(scene);

      // Doesn't matter if this fails
      await sceneCollection.upsert(scene._id, scene).catch((err) => {
        handleError("Failed to update scene after updating codec information", err);
      });
    }
  } catch (err) {
    return res.status(500).send("Could not determine video codecs for transcoding");
  }

  switch (streamType) {
    case SceneStreamTypes.WEBM:
      return transcodeWebm(scene, req, res);
    case SceneStreamTypes.MP4:
      return transcodeMp4(scene, req, res);
    default:
      return res.sendStatus(400);
  }
});

export default router;
