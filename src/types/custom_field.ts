import { customFieldCollection } from "../database";
import { generateHash } from "../utils/hash";

export enum CustomFieldType {
  NUMBER = "NUMBER",
  STRING = "STRING",
  BOOLEAN = "BOOLEAN",
  SINGLE_SELECT = "SINGLE_SELECT",
  MULTI_SELECT = "MULTI_SELECT",
}

export enum CustomFieldTarget {
  SCENES = "SCENES",
  ACTORS = "ACTORS",
  MOVIES = "MOVIES",
  IMAGES = "IMAGES",
  STUDIOS = "STUDIOS",
  ALBUMS = "ALBUMS",
}

export default class CustomField {
  _id: string;
  name: string;
  values: string[] | null = [];
  type: CustomFieldType;
  target: CustomFieldTarget;
  unit = null as string | null;

  constructor(name: string, target: CustomFieldTarget, type: CustomFieldType) {
    this._id = `cf_${generateHash()}`;
    this.name = name;
    this.type = type;
    this.target = target;
  }

  static async find(name: string): Promise<CustomField | undefined> {
    name = name.toLowerCase().trim();
    const allFields = await CustomField.getAll();
    return allFields.find((field) => field.name === name);
  }

  static async remove(_id: string): Promise<void> {
    await customFieldCollection.remove(_id);
  }

  static async getById(_id: string): Promise<CustomField | null> {
    return customFieldCollection.get(_id);
  }

  static async getBulk(_ids: string[]): Promise<CustomField[]> {
    return customFieldCollection.getBulk(_ids);
  }

  static async getAll(): Promise<CustomField[]> {
    const fields = await customFieldCollection.getAll();
    return fields.sort((a, b) => a.name.localeCompare(b.name));
  }
}
