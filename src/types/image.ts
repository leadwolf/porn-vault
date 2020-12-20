import Vibrant from "node-vibrant";

import { actorCollection, imageCollection } from "../database";
import { unlinkAsync } from "../utils/fs/async";
import { generateHash } from "../utils/hash";
import * as logger from "../utils/logger";
import Actor from "./actor";
import ActorReference from "./actor_reference";
import Label from "./label";

export class ImageDimensions {
  width: number | null = null;
  height: number | null = null;
}

export class ImageMeta {
  size: number | null = null;
  dimensions = new ImageDimensions();
}

export default class Image {
  _id: string;
  name: string;
  path: string | null = null;
  thumbPath: string | null = null;
  scene: string | null = null;
  addedOn = +new Date();
  favorite = false;
  bookmark: number | null = null;
  rating = 0;
  customFields: Record<string, boolean | string | number | string[] | null> = {};
  meta = new ImageMeta();
  actors?: string[];
  studio: string | null = null;
  hash: string | null = null;
  color: string | null = null;

  static async extractColor(image: Image): Promise<void> {
    if (!image.path) return;

    const palette = await Vibrant.from(image.path).getPalette();

    const color =
      palette.DarkVibrant?.getHex() ||
      palette.DarkMuted?.getHex() ||
      palette.Vibrant?.getHex() ||
      palette.Vibrant?.getHex();

    if (color) {
      image.color = color;
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      imageCollection.upsert(image._id, image).catch(() => {});
    }
  }

  static color(image: Image): string | null {
    if (!image.path) return null;
    if (image.color) return image.color;

    if (image.path) {
      Image.extractColor(image).catch((err: Error) => {
        logger.error("Image color extraction failed");
        logger.log(err);
        logger.error(image.path, err.message);
      });
    }

    return null;
  }

  static async remove(image: Image): Promise<void> {
    await imageCollection.remove(image._id);
    try {
      if (image.path) {
        await unlinkAsync(image.path);
      }
      if (image.thumbPath) {
        await unlinkAsync(image.thumbPath);
      }
    } catch (error) {
      logger.warn(`Could not delete source file for image ${image._id}`);
    }
  }

  static async filterStudio(studioId: string): Promise<void> {
    for (const image of await Image.getAll()) {
      if (image.studio === studioId) {
        image.studio = null;
        await imageCollection.upsert(image._id, image);
      }
    }
  }

  static async filterScene(sceneId: string): Promise<void> {
    for (const image of await Image.getAll()) {
      if (image.scene === sceneId) {
        image.scene = null;
        await imageCollection.upsert(image._id, image);
      }
    }
  }

  static async getByScene(id: string): Promise<Image[]> {
    return imageCollection.query("scene-index", id);
  }

  static async getById(_id: string): Promise<Image | null> {
    return imageCollection.get(_id);
  }

  static async getBulk(_ids: string[]): Promise<Image[]> {
    return imageCollection.getBulk(_ids);
  }

  static async getAll(): Promise<Image[]> {
    return imageCollection.getAll();
  }

  static async getActors(image: Image): Promise<Actor[]> {
    const references = await ActorReference.getByItem(image._id);
    return (await actorCollection.getBulk(references.map((r) => r.actor)))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  static async setActors(image: Image, actorIds: string[]): Promise<void> {
    return Actor.setForItem(image._id, actorIds, "image");
  }

  static async addActors(image: Image, actorIds: string[]): Promise<void> {
    return Actor.addForItem(image._id, actorIds, "image");
  }

  static async setLabels(image: Image, labelIds: string[]): Promise<void> {
    return Label.setForItem(image._id, labelIds, "image");
  }

  static async getLabels(image: Image): Promise<Label[]> {
    return Label.getForItem(image._id);
  }

  static async getImageByPath(path: string): Promise<Image | undefined> {
    return (await imageCollection.query("path-index", encodeURIComponent(path)))[0] as
      | Image
      | undefined;
  }

  constructor(name: string) {
    this._id = `im_${generateHash()}`;
    this.name = name.trim();
  }
}
