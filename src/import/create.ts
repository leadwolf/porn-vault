import { existsSync } from "fs";
import { Dictionary, isBoolean, isNumber } from "../utils/types";

import args from "../args";
import * as database from "../database/index";
import {
  actorCollection,
  actorReferenceCollection,
  customFieldCollection,
  imageCollection,
  // markerReferenceCollection,
  labelCollection,
  markerCollection,
  studioCollection,
} from "../database/index";
import { stripStr } from "../extractor";
import * as logger from "../utils/logger";
import { onActorCreate } from "../plugins/events/actor";
import { onMovieCreate } from "../plugins/events/movie";
import { onSceneCreate } from "../plugins/events/scene";
import Actor from "../types/actor";
import ActorReference from "../types/actor_reference";
import CustomField, { CustomFieldTarget } from "../types/custom_field";
import Image from "../types/image";
import Label from "../types/label";
import Marker from "../types/marker";
import Movie from "../types/movie";
import Scene from "../types/scene";
import Studio from "../types/studio";
import { isString } from "./schemas/common";
import {
  IImportedActor,
  IImportedCustomField,
  IImportedLabel,
  IImportedMarker,
  IImportedMovie,
  IImportedScene,
  IImportedStudio,
} from "./types";
import { inspect } from "util";
import { onStudioCreate } from "../plugins/events/studio";

export interface ICreateOptions {
  scenes?: Dictionary<IImportedScene>;
  actors?: Dictionary<IImportedActor>;
  labels?: Dictionary<IImportedLabel>;
  movies?: Dictionary<IImportedMovie>;
  studios?: Dictionary<IImportedStudio>;
  customFields?: Dictionary<IImportedCustomField>;
  markers?: Dictionary<IImportedMarker>;
}

function normalizeCustomFields(
  ids: Dictionary<string>,
  newlyCreated: Dictionary<{ _id: string }>
): Dictionary<string> {
  const fieldIds = Object.keys(ids);

  const newFields = {} as Dictionary<string>;
  for (const fieldId of fieldIds) {
    const value = ids[fieldId];
    // Newly created field
    if (newlyCreated[fieldId] !== undefined) newFields[newlyCreated[fieldId]._id] = value;
    // Already existing field
    else newFields[fieldId] = value;
  }

  return newFields;
}

function normalizeCreatedObjects(
  ids: string[],
  newlyCreated: Dictionary<{ _id: string }>
): string[] {
  return ids.map((str) => {
    // Newly created object, get database ID instead
    if (newlyCreated[str] !== undefined) return newlyCreated[str]._id;
    // Already in database, just return ID
    return str;
  });
}

export async function createFromFileData(opts: ICreateOptions): Promise<void> {
  const createdLabels = {} as Dictionary<Label>;
  const createdFields = {} as Dictionary<CustomField>;
  const createdActors = {} as Dictionary<Actor>;
  const createdScenes = {} as Dictionary<Scene>;
  const createdMovies = {} as Dictionary<Movie>;
  const createdStudios = {} as Dictionary<Studio>;
  const createdMarkers = {} as Dictionary<Marker>;

  if (opts.labels) {
    for (const labelId in opts.labels) {
      const labelToCreate = opts.labels[labelId];

      const label = new Label(labelToCreate.name, labelToCreate.aliases || []);

      if (args["commit-import"]) {
        for (const scene of await Scene.getAll()) {
          const perms = stripStr(scene.path || scene.name);
          if (
            perms.includes(stripStr(label.name)) ||
            label.aliases.some((alias) => perms.includes(stripStr(alias)))
          ) {
            const labels = (await Scene.getLabels(scene)).map((l) => l._id);
            labels.push(label._id);
            await Scene.setLabels(scene, labels);
            logger.log(`Updated labels of ${scene._id}.`);
          }
        }
        await labelCollection.upsert(label._id, label);
      }
      createdLabels[labelId] = label;
    }
  }

  if (opts.customFields) {
    for (const fieldId in opts.customFields) {
      const fieldToCreate = opts.customFields[fieldId];

      const field = new CustomField(
        fieldToCreate.name,
        CustomFieldTarget.ACTORS,
        fieldToCreate.type
      );

      field.values = [...new Set(fieldToCreate.values || [])];

      if (args["commit-import"]) await customFieldCollection.upsert(field._id, field);
      createdFields[fieldId] = field;
    }
  }

  if (opts.studios) {
    for (const studioId in opts.studios) {
      const studioToCreate = opts.studios[studioId];

      let studio = new Studio(studioToCreate.name);

      let labels = [] as string[];

      if (isNumber(studioToCreate.bookmark)) studio.bookmark = studioToCreate.bookmark;

      if (isBoolean(studioToCreate.favorite)) studio.favorite = studioToCreate.favorite;

      if (studioToCreate.labels) {
        labels = normalizeCreatedObjects(studioToCreate.labels, createdLabels);
      }

      /* if (isNumber(studioToCreate.rating))
        studio.rating = <number>studioToCreate.rating; */

      if (studioToCreate.parent) studio.parent = studioToCreate.parent;

      if (studioToCreate.thumbnail) {
        const image = new Image(`${studio.name} (thumbnail)`);
        image.path = studioToCreate.thumbnail;
        studio.thumbnail = image._id;

        if (args["commit-import"])
          // await database.insert(database.store.images, image);
          await imageCollection.upsert(image._id, image);
      }

      if (studioToCreate.customFields) {
        studio.customFields = normalizeCustomFields(studioToCreate.customFields, createdFields);
      }

      try {
        studio = await onStudioCreate(studio, labels);
      } catch (error) {
        logger.error(error.message);
      }
      if (args["commit-import"]) {
        studio = await studioCollection.upsert(studio._id, studio);
        await Studio.setLabels(studio, labels);
      }
      createdStudios[studioId] = studio;
    }
  }

  if (opts.actors) {
    for (const actorId in opts.actors) {
      const actorToCreate = opts.actors[actorId];

      let actor = new Actor(actorToCreate.name, actorToCreate.aliases || []);

      if (isString(actorToCreate.nationality)) actor.nationality = actorToCreate.nationality;

      if (isNumber(actorToCreate.bookmark)) actor.bookmark = actorToCreate.bookmark;

      if (isBoolean(actorToCreate.favorite)) actor.favorite = actorToCreate.favorite;

      if (isNumber(actorToCreate.bornOn)) actor.bornOn = actorToCreate.bornOn;

      if (isNumber(actorToCreate.rating)) actor.rating = actorToCreate.rating;

      if (isString(actorToCreate.description)) actor.description = actorToCreate.description;

      if (actorToCreate.thumbnail) {
        const image = new Image(`${actor.name} (thumbnail)`);
        image.path = actorToCreate.thumbnail;
        actor.thumbnail = image._id;

        const reference = new ActorReference(image._id, actor._id, "image");

        if (args["commit-import"]) {
          await actorReferenceCollection.upsert(reference._id, reference);
          await imageCollection.upsert(image._id, image);
        }
      }

      let actorLabels = [] as string[];

      if (actorToCreate.labels) {
        actorLabels = normalizeCreatedObjects(actorToCreate.labels, createdLabels);
        if (args["commit-import"]) await Actor.setLabels(actor, actorLabels);
      }

      if (actorToCreate.customFields) {
        actor.customFields = normalizeCustomFields(actorToCreate.customFields, createdFields);
      }

      try {
        actor = await onActorCreate(actor, actorLabels);
      } catch (error) {
        logger.error(error.message);
      }

      if (args["commit-import"]) await actorCollection.upsert(actor._id, actor);
      createdActors[actorId] = actor;
    }
  }

  if (opts.scenes) {
    for (const sceneId in opts.scenes) {
      const sceneToCreate = opts.scenes[sceneId];

      let newScene = new Scene(sceneToCreate.name);
      logger.log(`Creating scene with id ${newScene._id}...`);

      // let thumbnail = null as string | null;
      let labels = [] as string[];
      let actors = [] as string[];
      // let customFields = {} as Dictionary<string>;

      if (sceneToCreate.thumbnail) {
        const image = new Image(`${sceneToCreate.name} (thumbnail)`);
        image.path = sceneToCreate.thumbnail;
        // thumbnail = image._id;

        if (args["commit-import"]) await imageCollection.upsert(image._id, image);
      }

      if (sceneToCreate.actors) {
        actors = normalizeCreatedObjects(sceneToCreate.actors, createdActors);
      }

      if (sceneToCreate.labels) {
        labels = normalizeCreatedObjects(sceneToCreate.labels, createdLabels);
      }

      if (sceneToCreate.customFields) {
        /* customFields = */ normalizeCustomFields(sceneToCreate.customFields, createdFields);
      }

      if (existsSync(sceneToCreate.path)) {
        try {
          newScene = await onSceneCreate(newScene, labels, actors);
        } catch (error) {
          logger.error(error.message);
        }
        if (args["commit-import"]) {
          newScene = await Scene.onImport(sceneToCreate.path, false);
          await Scene.setActors(newScene, actors);
          await Scene.setLabels(newScene, labels);
        }
        createdScenes[newScene._id] = newScene;
      } else {
        logger.error(`${sceneToCreate.path} not found`);
      }
    }
  }

  if (opts.movies) {
    for (const movieId in opts.movies) {
      const movieToCreate = opts.movies[movieId];

      let movie = new Movie(movieToCreate.name);

      if (isNumber(movieToCreate.bookmark)) movie.bookmark = movieToCreate.bookmark;

      if (isBoolean(movieToCreate.favorite)) movie.favorite = movieToCreate.favorite;

      if (isNumber(movieToCreate.releaseDate)) movie.releaseDate = movieToCreate.releaseDate;

      if (isNumber(movieToCreate.rating)) movie.rating = movieToCreate.rating;

      if (movieToCreate.studio) {
        movie.studio =
          normalizeCreatedObjects([movieToCreate.studio], createdStudios).pop() || null;
      }

      if (movieToCreate.frontCover) {
        const image = new Image(`${movie.name} (front cover)`);
        image.path = movieToCreate.frontCover;
        movie.frontCover = image._id;

        if (args["commit-import"]) await imageCollection.upsert(image._id, image);
      }

      if (movieToCreate.backCover) {
        const image = new Image(`${movie.name} (back cover)`);
        image.path = movieToCreate.backCover;
        movie.backCover = image._id;

        if (args["commit-import"]) await imageCollection.upsert(image._id, image);
      }

      if (movieToCreate.spineCover) {
        const image = new Image(`${movie.name} (spine cover)`);
        image.path = movieToCreate.spineCover;

        movie.spineCover = image._id;

        if (args["commit-import"]) await imageCollection.upsert(image._id, image);
      }

      let scenes = [] as string[];

      if (movieToCreate.scenes) {
        scenes = normalizeCreatedObjects(movieToCreate.scenes, createdScenes);
      }

      if (args["commit-import"]) {
        try {
          movie = await onMovieCreate(movie);
        } catch (error) {
          logger.error(error.message);
        }
        await Movie.setScenes(movie, scenes);
        await database.movieCollection.upsert(movie._id, movie);
      }
      createdMovies[movieId] = movie;
    }
  }

  if (opts.markers) {
    for (const markerId in opts.markers) {
      const markerToCreate = opts.markers[markerId];

      const marker = new Marker(markerToCreate.name, markerToCreate.scene, markerToCreate.time);

      if (isNumber(markerToCreate.bookmark)) marker.bookmark = markerToCreate.bookmark;

      if (isBoolean(markerToCreate.favorite)) marker.favorite = markerToCreate.favorite;

      if (isNumber(markerToCreate.rating)) marker.rating = markerToCreate.rating;

      let labels = [] as string[];

      if (markerToCreate.labels) {
        labels = normalizeCreatedObjects(markerToCreate.labels, createdLabels);
      }

      if (args["commit-import"]) {
        await Marker.setLabels(marker, labels);

        /* const reference = new MarkerReference(
          markerToCreate.scene,
          marker._id,
          "marker"
        );
        await markerReferenceCollection.upsert(reference._id, reference); */

        await markerCollection.upsert(marker._id, marker);
      }
      createdMarkers[markerId] = marker;
    }
  }

  if (!args["commit-import"]) {
    console.log(
      inspect(
        {
          createdMarkers,
          createdFields,
          createdLabels,
          createdScenes,
          createdActors,
          createdMovies,
          createdStudios,
        },
        true,
        null
      )
    );
    logger.message("Run with --commit-import to actually import stuff.");
  }
}
