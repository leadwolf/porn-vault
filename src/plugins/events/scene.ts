import { resolve } from "path";

import { getConfig } from "../../config";
import {
  actorCollection,
  imageCollection,
  labelCollection,
  movieCollection,
  studioCollection,
  viewCollection,
} from "../../database";
import {
  extractActors,
  extractFields,
  extractLabels,
  extractMovies,
  extractStudios,
} from "../../extractor";
import { runPluginsSerial } from "../../plugins";
import { indexActors } from "../../search/actor";
import { indexImages } from "../../search/image";
import { indexMovies } from "../../search/movie";
import { indexStudios } from "../../search/studio";
import Actor from "../../types/actor";
import Image from "../../types/image";
import Label from "../../types/label";
import Movie from "../../types/movie";
import Scene from "../../types/scene";
import Studio from "../../types/studio";
import SceneView from "../../types/watch";
import { downloadFile } from "../../utils/download";
import * as logger from "../../utils/logger";
import { libraryPath, validRating } from "../../utils/misc";
import { extensionFromUrl } from "../../utils/string";
import { isNumber } from "../../utils/types";
import { onActorCreate } from "./actor";
import { onMovieCreate } from "./movie";

// This function has side effects
export async function onSceneCreate(
  scene: Scene,
  sceneLabels: string[],
  sceneActors: string[],
  event = "sceneCreated"
): Promise<Scene> {
  const config = getConfig();

  const createdImages = [] as Image[];

  const pluginResult = await runPluginsSerial(config, event, {
    scene: JSON.parse(JSON.stringify(scene)) as Scene,
    sceneName: scene.name,
    scenePath: scene.path,
    $createLocalImage: async (path: string, name: string, thumbnail?: boolean) => {
      path = resolve(path);
      logger.log("Creating image from " + path);
      if (await Image.getImageByPath(path)) {
        logger.warn(`Image ${path} already exists in library`);
        return null;
      }
      const img = new Image(name);
      if (thumbnail) {
        img.name += " (thumbnail)";
      }
      img.path = path;
      img.scene = scene._id;
      logger.log("Created image " + img._id);
      await imageCollection.upsert(img._id, img);
      if (!thumbnail) {
        createdImages.push(img);
      }
      return img._id;
    },
    $createImage: async (url: string, name: string, thumbnail?: boolean) => {
      // if (!isValidUrl(url)) throw new Error(`Invalid URL: ` + url);
      logger.log("Creating image from " + url);
      const img = new Image(name);
      if (thumbnail) {
        img.name += " (thumbnail)";
      }
      const ext = extensionFromUrl(url);
      const path = libraryPath(`images/${img._id}${ext}`);
      await downloadFile(url, path);
      img.path = path;
      img.scene = scene._id;
      logger.log("Created image " + img._id);
      await imageCollection.upsert(img._id, img);
      if (!thumbnail) {
        createdImages.push(img);
      }
      return img._id;
    },
  });

  if (
    event === "sceneCreated" &&
    pluginResult.watches &&
    Array.isArray(pluginResult.watches) &&
    pluginResult.watches.every((v) => typeof v === "number")
  ) {
    for (const stamp of pluginResult.watches) {
      const watchItem = new SceneView(scene._id, stamp);
      await viewCollection.upsert(watchItem._id, watchItem);
    }
  }

  if (
    typeof pluginResult.thumbnail === "string" &&
    pluginResult.thumbnail.startsWith("im_") &&
    (!scene.thumbnail || config.plugins.allowSceneThumbnailOverwrite)
  ) {
    scene.thumbnail = pluginResult.thumbnail;
  }

  if (typeof pluginResult.name === "string") {
    scene.name = pluginResult.name;
  }

  if (typeof pluginResult.path === "string") {
    scene.path = pluginResult.path;
  }

  if (typeof pluginResult.description === "string") {
    scene.description = pluginResult.description;
  }

  if (typeof pluginResult.releaseDate === "number") {
    scene.releaseDate = new Date(pluginResult.releaseDate).valueOf();
  }

  if (typeof pluginResult.addedOn === "number") {
    scene.addedOn = new Date(pluginResult.addedOn).valueOf();
  }

  if (Array.isArray(pluginResult.views) && pluginResult.views.every(isNumber)) {
    for (const viewTime of pluginResult.views) {
      await Scene.watch(scene, viewTime);
    }
  }

  if (pluginResult.custom && typeof pluginResult.custom === "object") {
    for (const key in pluginResult.custom) {
      const fields = await extractFields(key);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      if (fields.length) scene.customFields[fields[0]] = pluginResult.custom[key];
    }
  }

  if (validRating(pluginResult.rating)) {
    scene.rating = pluginResult.rating;
  }

  if (typeof pluginResult.favorite === "boolean") {
    scene.favorite = pluginResult.favorite;
  }

  if (typeof pluginResult.bookmark === "number") {
    scene.bookmark = pluginResult.bookmark;
  }

  if (pluginResult.actors && Array.isArray(pluginResult.actors)) {
    const actorIds = [] as string[];
    for (const actorName of pluginResult.actors) {
      const extractedIds = await extractActors(actorName);
      if (extractedIds.length) actorIds.push(...extractedIds);
      else if (config.plugins.createMissingActors) {
        let actor = new Actor(actorName);
        actorIds.push(actor._id);
        const actorLabels = [] as string[];
        try {
          actor = await onActorCreate(actor, actorLabels);
        } catch (error) {
          const _err = error as Error;
          logger.log(_err);
          logger.error(_err.message);
        }
        await actorCollection.upsert(actor._id, actor);
        await Actor.attachToExistingScenes(actor, actorLabels);
        await indexActors([actor]);
        logger.log("Created actor " + actor.name);
      }
    }
    sceneActors.push(...actorIds);
  }

  if (pluginResult.labels && Array.isArray(pluginResult.labels)) {
    const labelIds = [] as string[];
    for (const labelName of pluginResult.labels) {
      const extractedIds = await extractLabels(labelName);
      if (extractedIds.length) {
        labelIds.push(...extractedIds);
        logger.log(`Found ${extractedIds.length} labels for ${<string>labelName}:`);
        logger.log(extractedIds);
      } else if (config.plugins.createMissingLabels) {
        const label = new Label(labelName);
        labelIds.push(label._id);
        await labelCollection.upsert(label._id, label);
        logger.log("Created label " + label.name);
      }
    }
    sceneLabels.push(...labelIds);
  }

  if (!scene.studio && pluginResult.studio && typeof pluginResult.studio === "string") {
    const studioId = (await extractStudios(pluginResult.studio))[0];

    if (studioId) scene.studio = studioId;
    else if (config.plugins.createMissingStudios) {
      const studio = new Studio(pluginResult.studio);
      scene.studio = studio._id;
      await studioCollection.upsert(studio._id, studio);
      await Studio.attachToExistingScenes(studio);
      await indexStudios([studio]);
      logger.log("Created studio " + studio.name);
    }
  }

  if (pluginResult.movie && typeof pluginResult.movie === "string") {
    const movieId = (await extractMovies(pluginResult.movie))[0];

    if (movieId) {
      const movie = <Movie>await Movie.getById(movieId);
      const sceneIds = (await Movie.getScenes(movie)).map((sc) => sc._id);
      await Movie.setScenes(movie, sceneIds.concat(scene._id));
      await indexMovies([movie]);
    } else if (config.plugins.createMissingMovies) {
      let movie = new Movie(pluginResult.movie);

      try {
        movie = await onMovieCreate(movie, "movieCreated");
      } catch (error) {
        const _err = error as Error;
        logger.log(_err);
        logger.error(_err.message);
      }

      await movieCollection.upsert(movie._id, movie);
      logger.log("Created movie " + movie.name);
      await Movie.setScenes(movie, [scene._id]);
      logger.log(`Attached ${scene.name} to movie ${movie.name}`);
      await indexMovies([movie]);
    }
  }

  for (const image of createdImages) {
    if (config.matching.applySceneLabels) {
      await Image.setLabels(image, sceneLabels);
    }
    await Image.setActors(image, sceneActors);
    await indexImages([image]);
  }

  return scene;
}
