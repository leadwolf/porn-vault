import { sceneCollection, studioCollection } from "../database";
import { stripStr } from "../extractor";
import { updateScenes } from "../search/scene";
import { mapAsync } from "../utils/async";
import { generateHash } from "../utils/hash";
import * as logger from "../utils/logger";
import { createObjectSet } from "../utils/misc";
import Actor from "./actor";
import Label from "./label";
import Movie from "./movie";
import Scene from "./scene";

export default class Studio {
  _id: string;
  name: string;
  description: string | null = null;
  thumbnail: string | null = null;
  addedOn: number = +new Date();
  favorite = false;
  bookmark: number | null = null;
  parent: string | null = null;
  aliases?: string[];

  constructor(name: string) {
    this._id = "st_" + generateHash();
    this.name = name;
  }

  static async remove(studioId: string): Promise<void> {
    await studioCollection.remove(studioId);
  }

  static async filterStudio(studioId: string): Promise<void> {
    for (const studio of await Studio.getSubStudios(studioId)) {
      studio.parent = null;
      await studioCollection.upsert(studio._id, studio);
    }
  }

  static async getById(_id: string): Promise<Studio | null> {
    return studioCollection.get(_id);
  }

  static async getBulk(_ids: string[]): Promise<Studio[]> {
    return studioCollection.getBulk(_ids);
  }

  static async getAll(): Promise<Studio[]> {
    return studioCollection.getAll();
  }

  static async getScenes(studio: Studio): Promise<Scene[]> {
    const scenes = await Scene.getByStudio(studio._id);
    const subStudios = await Studio.getSubStudios(studio._id);

    const scenesOfSubStudios = (
      await Promise.all(subStudios.map((child) => Studio.getScenes(child)))
    ).flat();

    return scenes.concat(scenesOfSubStudios);
  }

  static async getMovies(studio: Studio): Promise<Movie[]> {
    const movies = await Movie.getByStudio(studio._id);

    const moviesOfSubStudios = (
      await Promise.all(
        (await Studio.getSubStudios(studio._id)).map((child) => Studio.getMovies(child))
      )
    ).flat();

    return movies.concat(moviesOfSubStudios);
  }

  static async getSubStudios(studioId: string): Promise<Studio[]> {
    return studioCollection.query("parent-index", studioId);
  }

  static async getActors(studio: Studio): Promise<Actor[]> {
    const scenes = await Studio.getScenes(studio);
    const actorIds = [
      ...new Set((await mapAsync(scenes, Scene.getActors)).flat().map((a) => a._id)),
    ];
    return await Actor.getBulk(actorIds);
  }

  static async setLabels(studio: Studio, labelIds: string[]): Promise<void> {
    return Label.setForItem(studio._id, labelIds, "studio");
  }

  static async getLabels(studio: Studio): Promise<Label[]> {
    return Label.getForItem(studio._id);
  }

  static async inferLabels(studio: Studio): Promise<Label[]> {
    const scenes = await Studio.getScenes(studio);
    const labels = (await mapAsync(scenes, Scene.getLabels)).flat();
    return createObjectSet(labels, "_id");
  }

  static async attachToExistingScenes(studio: Studio): Promise<void> {
    for (const scene of await Scene.getAll()) {
      const perms = stripStr(scene.path || scene.name);

      if (scene.studio === null && perms.includes(stripStr(studio.name))) {
        scene.studio = studio._id;
        await sceneCollection.upsert(scene._id, scene);
        await updateScenes([scene]);
        logger.log(`Updated scene ${scene._id}`);
      }
    }
  }
}
