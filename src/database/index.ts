import { existsSync } from "fs";
import mkdirp from "mkdirp";
import ora from "ora";

import args from "../args";
import { convertCrossReferences } from "../compat";
import { unlinkAsync } from "../fs/async";
import { absolutifyPaths, bookmarksToTimestamp } from "../integrity";
import * as logger from "../logger";
import { ISceneProcessingItem } from "../queue/processing";
import Actor from "../types/actor";
import ActorReference from "../types/actor_reference";
import CustomField from "../types/custom_field";
import Image from "../types/image";
import Label from "../types/label";
import LabelledItem from "../types/labelled_item";
import Marker from "../types/marker";
import Movie from "../types/movie";
import MovieScene from "../types/movie_scene";
import Scene from "../types/scene";
import Studio from "../types/studio";
import Trailer from "../types/trailer";
import { libraryPath } from "../types/utility";
import SceneView from "../types/watch";
import { Izzy } from "./internal/index";

mkdirp.sync("backups/");
mkdirp.sync("tmp/");

export let sceneCollection!: Izzy.Collection<Scene>;
export let trailerCollection!: Izzy.Collection<Trailer>;
export let imageCollection!: Izzy.Collection<Image>;
export let actorCollection!: Izzy.Collection<Actor>;
export let movieCollection!: Izzy.Collection<Movie>;
export let labelledItemCollection!: Izzy.Collection<LabelledItem>;
export let movieSceneCollection!: Izzy.Collection<MovieScene>;
export let actorReferenceCollection!: Izzy.Collection<ActorReference>;
// export let markerReferenceCollection!: Izzy.Collection<MarkerReference>;
export let viewCollection!: Izzy.Collection<SceneView>;
export let labelCollection!: Izzy.Collection<Label>;
export let customFieldCollection!: Izzy.Collection<CustomField>;
export let markerCollection!: Izzy.Collection<Marker>;
export let studioCollection!: Izzy.Collection<Studio>;
export let processingCollection!: Izzy.Collection<ISceneProcessingItem>;

export async function loadStores(): Promise<void> {
  const crossReferencePath = libraryPath("cross_references.db");
  if (existsSync(crossReferencePath)) {
    logger.message("Making DB compatible...");
    await convertCrossReferences();
    await unlinkAsync(crossReferencePath);
  }

  try {
    mkdirp.sync(libraryPath("images/"));
    mkdirp.sync(libraryPath("thumbnails/")); // generated screenshots
    mkdirp.sync(libraryPath("thumbnails/markers")); // generated marker thumbnails
    mkdirp.sync(libraryPath("previews/"));
    mkdirp.sync(libraryPath("trailers/"));
  } catch (err) {
    const _err = <Error>err;
    logger.error(_err.message);
  }

  if (!args["ignore-integrity"]) {
    const compatLoader = ora("Making .db files compatible (if needed)").start();

    await bookmarksToTimestamp(libraryPath("scenes.db"));
    await bookmarksToTimestamp(libraryPath("actors.db"));
    await bookmarksToTimestamp(libraryPath("images.db"));
    await bookmarksToTimestamp(libraryPath("movies.db"));
    await bookmarksToTimestamp(libraryPath("studios.db"));
    await bookmarksToTimestamp(libraryPath("markers.db"));

    await absolutifyPaths(libraryPath("scenes.db"));
    await absolutifyPaths(libraryPath("images.db"));

    compatLoader.succeed();
  } else {
    logger.message("Skipping bookmark integrity");
  }

  const dbLoader = ora("Loading DB...").start();

  customFieldCollection = await Izzy.createCollection(
    "custom_fields",
    libraryPath("custom_fields.db"),
    []
  );

  labelCollection = await Izzy.createCollection("labels", libraryPath("labels.db"), []);

  viewCollection = await Izzy.createCollection("scene_views", libraryPath("scene_views.db"), [
    {
      key: "scene",
      name: "scene-index",
    },
  ]);

  /* markerReferenceCollection = await Izzy.createCollection(
    "marker-references",
    libraryPath("marker_references.db"),
    [
      {
        name: "marker-index",
        key: "marker",
      },
      {
        name: "scene-index",
        key: "scene",
      },
    ]
  ); */

  actorReferenceCollection = await Izzy.createCollection(
    "actor-references",
    libraryPath("actor_references.db"),
    [
      {
        name: "actor-index",
        key: "actor",
      },
      {
        name: "item-index",
        key: "item",
      },
      {
        name: "type-index",
        key: "type",
      },
    ]
  );

  movieSceneCollection = await Izzy.createCollection(
    "movie-scenes",
    libraryPath("movie_scenes.db"),
    [
      {
        name: "movie-index",
        key: "movie",
      },
      {
        name: "scene-index",
        key: "scene",
      },
    ]
  );

  labelledItemCollection = await Izzy.createCollection(
    "labelled-items",
    libraryPath("labelled_items.db"),
    [
      {
        name: "label-index",
        key: "label",
      },
      {
        name: "item-index",
        key: "item",
      },
      {
        name: "type-index",
        key: "type",
      },
    ]
  );

  imageCollection = await Izzy.createCollection("images", libraryPath("images.db"), [
    {
      name: "scene-index",
      key: "scene",
    },
    {
      name: "studio-index",
      key: "studio",
    },
    {
      name: "path-index",
      key: "path",
    },
  ]);

  sceneCollection = await Izzy.createCollection("scenes", libraryPath("scenes.db"), [
    {
      name: "studio-index",
      key: "studio",
    },
    {
      name: "path-index",
      key: "path",
    },
    {
      name: "preview-index",
      key: "preview",
    },
  ]);

  trailerCollection = await Izzy.createCollection("trailers", libraryPath("trailers.db"), [
    {
      name: "scene-index",
      key: "scene",
    },
  ]);

  actorCollection = await Izzy.createCollection("actors", libraryPath("actors.db"));

  movieCollection = await Izzy.createCollection("movies", libraryPath("movies.db"), [
    {
      name: "studio-index",
      key: "studio",
    },
  ]);

  markerCollection = await Izzy.createCollection("markers", libraryPath("markers.db"), [
    {
      name: "scene-index",
      key: "scene",
    },
  ]);

  studioCollection = await Izzy.createCollection("studios", libraryPath("studios.db"), [
    {
      key: "parent",
      name: "parent-index",
    },
  ]);

  processingCollection = await Izzy.createCollection(
    "processing",
    libraryPath("processing.db"),
    []
  );

  logger.log("Created Izzy collections");

  if (!args["skip-compaction"]) {
    const compactLoader = ora("Compacting DB...").start();
    await sceneCollection.compact();
    await imageCollection.compact();
    await labelledItemCollection.compact();
    await movieSceneCollection.compact();
    await actorReferenceCollection.compact();
    // await markerReferenceCollection.compact();
    await actorCollection.compact();
    await movieCollection.compact();
    await viewCollection.compact();
    await labelCollection.compact();
    await customFieldCollection.compact();
    await markerCollection.compact();
    await studioCollection.compact();
    await processingCollection.compact();
    compactLoader.succeed("Compacted DB");
  } else {
    logger.message("Skipping compaction");
  }

  dbLoader.succeed();

  if (!args["ignore-integrity"]) {
    const integrityLoader = ora("Checking database integrity. This might take a minute...").start();

    await Scene.checkIntegrity();
    await Actor.checkIntegrity();
    await Label.checkIntegrity();
    await Image.checkIntegrity();
    await Studio.checkIntegrity();
    await Movie.checkIntegrity();
    await Marker.checkIntegrity();
    integrityLoader.succeed("Integrity check done.");
  } else {
    logger.message("Skipping integrity checks");
  }
}
